/**
 * @fileoverview **PlotImageSource** — 将矢量标绘（点、线、面、矩形、圆、扇形、文字、箭头等）渲染为
 * 与 `ImageOverlayPlugin` 兼容的按瓦片 RGBA 纹理。
 *
 * ## 架构角色
 * - 继承 {@link RegionImageSource} → {@link DataCache}：对每个归一化地理范围 `tokens = [minX,minY,maxX,maxY]`
 *   维护 `lock` / `release` / `get` 缓存，与 {@link GeoJSONImageSource} 同属「区域图像源」一族。
 * - **不**自带 HTTP 拉片逻辑；纹理完全在本地由 WebGL 离屏绘制生成。
 *
 * ## 与 ImageOverlayPlugin 的协作
 * 1. 插件在瓦片加载后根据 mesh 的地理范围计算 `range`，调用 `overlay.lockTexture(range, tile)`。
 * 2. 内部转为对本类 `lock(...tokens)` → 首次命中时异步执行 `fetchItem(tokens)`。
 * 3. `fetchItem` 把当前瓦片内可见图元打包为浮点数据纹理，绑定到 SDF 材质，渲染到 **独立** `WebGLRenderTarget`，
 *    返回 `rt.texture`（并在 `texture._parentRT` 上挂回 RT 引用，供 `disposeItem` / `redraw` 使用）。
 * 4. 插件把该纹理赋给地形材质的 overlay 层；`hasContent` 用于跳过完全无图元的瓦片以省显存与算力。
 *
 * ## `shapes` 约定（由业务层注入）
 * - 类型：`Map< id, shapeObject >`。
 * - `shapeObject` 至少包含：
 *   - `category`：`point` | `line` | `polygon` | `rectangle` | `circle` | `sector` | `text` | `arrow`
 *   - `options`：各图元样式与几何（`points`、`visible`、颜色、线宽、半径、文字内容等）。
 * - **箭头**（`arrow`）对象须实现 `generateCoords()` → `[[lon,lat], ...]` 多边形顶点（度），与示例工程 `PlotArrow` 一致。
 *
 * ## WebGLRenderer 与运行环境
 * - 构造选项 `renderer` 或稍后 `setRenderer(renderer)` **必须**指向与主场景相同的 `WebGLRenderer`（共享 GL 上下文）。
 * - 标签使用 `document.createElement('canvas')` 栅格化，需在浏览器 DOM 环境运行。
 *
 * ## `redraw()` 语义（重要）
 * 标绘数据变更后应调用 `redraw()`（通常经 `PlotOverlay.redraw` 转发）。
 * 实现上对 `DataCache` 中**已有**条目调用 `forEachItem`，在**原** `WebGLRenderTarget` 上重新执行 SDF pass。
 * **禁止**在 `redraw` 中 `dispose()` 整个缓存：插件仍持有旧 `Texture` 引用，销毁后会导致整层叠加空白（与 GeoJSON 的
 * 原地重绘策略一致）。
 *
 * ## 坐标与单位
 * - 图元几何与 `uTileBounds` 均为 **WGS84 度数**（经度、纬度）。
 * - `strokeWidth` 等在 CPU 侧按「屏幕像素近似」换算为度数：`pxDeg = 瓦片经度跨度 / resolution`。
 * - 圆、椭圆、扇形用经纬方向不同半径补偿纬度缩放；文字 footprint 用经验常数 `LABEL_M_PER_PX` 映射 atlas 像素到地面范围。
 *
 * @module images/sources/PlotImageSource
 */

import {
	Color,
	DataTexture,
	FloatType,
	RGBAFormat,
	NearestFilter,
	LinearSRGBColorSpace,
	WebGLRenderTarget,
	ShaderMaterial,
	PlaneGeometry,
	Mesh,
	Scene,
	OrthographicCamera,
	CanvasTexture,
	LinearFilter,
	MathUtils,
	GLSL3,
	Vector4,
} from 'three';

import { RegionImageSource } from '../RegionImageSource.js';
import { ProjectionScheme } from '../../utils/ProjectionScheme.js';
import { TILE_SDF_VERTEX, TILE_SDF_FRAGMENT } from './TileSdfShader.js';

/** @type {Color} 保存/恢复 renderer 清屏色时的临时变量 */
const _clearColor = new Color();

const DEG2RAD = MathUtils.DEG2RAD;
const RAD2DEG = MathUtils.RAD2DEG;

/** 标签图集边长（像素）。所有文字打在同一张 atlas 上，避免每字一张纹理。 */
const LABEL_ATLAS_SIZE = 2048;

/**
 * 标绘矢量 → 按瓦片 SDF 纹理的数据源。
 *
 * @extends RegionImageSource
 */
export class PlotImageSource extends RegionImageSource {

	/**
	 * @param {object} [options={}]
	 * @param {number} [options.resolution=512] 每个瓦片纹理边长（正方形）。
	 * @param {import('three').WebGLRenderer | null} [options.renderer=null] 离屏绘制用的 WebGL 渲染器；可稍后 `setRenderer`。
	 */
	constructor( options = {} ) {

		super();
		/** @type {number} 瓦片纹理分辨率（宽=高） */
		this.resolution = options.resolution || 512;
		/** @type {ProjectionScheme} 归一化坐标 ↔ 经纬弧度/度数 */
		this.projection = new ProjectionScheme();
		/**
		 * 业务层持有的标绘集合。键为数值 id，值为带 `category` / `options` 的描述对象。
		 * @type {Map<number, object>}
		 */
		this.shapes = new Map();
		/**
		 * 所有可见图元的外包矩形 [minLon, minLat, maxLon, maxLat]（度），无图元时为 `null`。
		 * @type {number[] | null}
		 */
		this.contentBounds = null;

		/** @type {import('three').WebGLRenderer | null} */
		this._renderer = options.renderer || null;
		this._rt = null;
		/** @type {Scene | null} */
		this._sdfScene = null;
		/** @type {OrthographicCamera | null} */
		this._sdfCamera = null;
		/** @type {ShaderMaterial | null} */
		this._sdfMaterial = null;
		/** SDF 四边形场景是否已构建 */
		this._gpuReady = false;

		// ── 标签 atlas：2D Canvas → CanvasTexture，片元 type 4 按 UV 采样 ──
		this._labelCanvas = document.createElement( 'canvas' );
		this._labelCanvas.width = LABEL_ATLAS_SIZE;
		this._labelCanvas.height = LABEL_ATLAS_SIZE;
		this._labelAtlasTex = new CanvasTexture( this._labelCanvas );
		this._labelAtlasTex.flipY = false;
		this._labelAtlasTex.minFilter = LinearFilter;
		this._labelAtlasTex.magFilter = LinearFilter;
		/** @type {Map<number, { halfWDeg: number, halfHDeg: number, u0: number, v0: number, u1: number, v1: number }>} */
		this._labelTiles = new Map();

	}

	/**
	 * 初始化：合并包围盒、构建标签图集、懒创建 GPU 资源。
	 * @returns {Promise<void>}
	 */
	async init() {

		this._updateBounds();
		this._initGPU();

	}

	/**
	 * 若构造时未传入 renderer，在注册进 `ImageOverlayPlugin` 之前必须调用。
	 * @param {import('three').WebGLRenderer} renderer
	 */
	setRenderer( renderer ) {

		this._renderer = renderer;

	}

	/**
	 * 给定插件传入的**归一化**瓦片范围，判断是否与当前 `contentBounds`（度）相交。
	 * 用于避免对空白区域分配 RT。
	 *
	 * @param {number} minX
	 * @param {number} minY
	 * @param {number} maxX
	 * @param {number} maxY
	 * @returns {boolean}
	 */
	hasContent( minX, minY, maxX, maxY ) {

		if ( ! this.contentBounds || this.shapes.size === 0 ) return false;

		const { projection } = this;
		const tileBounds = [
			projection.convertNormalizedToLongitude( minX ) * RAD2DEG,
			projection.convertNormalizedToLatitude( minY ) * RAD2DEG,
			projection.convertNormalizedToLongitude( maxX ) * RAD2DEG,
			projection.convertNormalizedToLatitude( maxY ) * RAD2DEG,
		];
		return _boundsIntersect( tileBounds, this.contentBounds );

	}

	/**
	 * DataCache 在首次 `lock` 时调用：生成该瓦片的叠加纹理。
	 *
	 * @param {number[]} tokens `[minX, minY, maxX, maxY]` 归一化坐标
	 * @returns {Promise<import('three').Texture>}
	 */
	async fetchItem( tokens ) {

		if ( ! this._gpuReady ) this._initGPU();

		const [ minX, minY, maxX, maxY ] = tokens;
		const { projection, resolution } = this;

		const minLonDeg = projection.convertNormalizedToLongitude( minX ) * RAD2DEG;
		const minLatDeg = projection.convertNormalizedToLatitude( minY ) * RAD2DEG;
		const maxLonDeg = projection.convertNormalizedToLongitude( maxX ) * RAD2DEG;
		const maxLatDeg = projection.convertNormalizedToLatitude( maxY ) * RAD2DEG;
		const tileBounds = [ minLonDeg, minLatDeg, maxLonDeg, maxLatDeg ];

		const shapeDataTex = this._buildShapeDataForTile( tileBounds );
		if ( ! shapeDataTex ) return this._createEmptyTexture();

		const u = this._sdfMaterial.uniforms;
		u.uTileBounds.value.set( minLonDeg, minLatDeg, maxLonDeg, maxLatDeg );
		u.uResolution.value = resolution;
		u.tShapeData.value = shapeDataTex;
		u.tLabelAtlas.value = this._labelAtlasTex;

		// 每瓦片独立 RT：返回其 color attachment，避免 readPixels
		const rt = new WebGLRenderTarget( resolution, resolution, {
			depthBuffer: false,
			stencilBuffer: false,
		} );

		const renderer = this._renderer;
		const prevRT = renderer.getRenderTarget();
		const prevClear = renderer.getClearColor( _clearColor );
		const prevAlpha = renderer.getClearAlpha();

		renderer.setRenderTarget( rt );
		renderer.setClearColor( 0x000000, 0 );
		renderer.clear();
		renderer.render( this._sdfScene, this._sdfCamera );

		renderer.setClearColor( prevClear, prevAlpha );
		renderer.setRenderTarget( prevRT );

		shapeDataTex.dispose();

		const tex = rt.texture;
		tex._parentRT = rt;
		return tex;

	}

	/**
	 * @param {import('three').Texture} texture
	 */
	disposeItem( texture ) {

		if ( texture._parentRT ) {

			texture._parentRT.dispose();

		} else {

			texture.dispose();

		}

	}

	/**
	 * `hasContent` 为真但瓦片内无矢量时返回的 1×1 透明占位纹理。
	 * @returns {import('three').DataTexture}
	 */
	_createEmptyTexture() {

		const data = new Uint8Array( 4 );
		const tex = new DataTexture( data, 1, 1 );
		tex.needsUpdate = true;
		return tex;

	}

	/**
	 * 标绘数据变更后调用：更新包围盒与标签图集，并对**已缓存**瓦片原地重绘。
	 */
	redraw() {

		this._updateBounds();

		this.forEachItem( ( texture, args ) => {

			this._rerenderItem( texture, args );

		} );

	}

	/**
	 * 在已有 `WebGLRenderTarget` 上重新执行 SDF pass（`redraw` 路径）。
	 * @param {import('three').Texture} texture
	 * @param {number[]} tokens 与 `fetchItem` 相同的归一化 tokens
	 */
	_rerenderItem( texture, tokens ) {

		const rt = texture._parentRT;
		if ( ! rt || ! this._gpuReady ) return;

		const [ minX, minY, maxX, maxY ] = tokens;
		const { projection, resolution } = this;

		const minLonDeg = projection.convertNormalizedToLongitude( minX ) * RAD2DEG;
		const minLatDeg = projection.convertNormalizedToLatitude( minY ) * RAD2DEG;
		const maxLonDeg = projection.convertNormalizedToLongitude( maxX ) * RAD2DEG;
		const maxLatDeg = projection.convertNormalizedToLatitude( maxY ) * RAD2DEG;
		const tileBounds = [ minLonDeg, minLatDeg, maxLonDeg, maxLatDeg ];

		const shapeDataTex = this._buildShapeDataForTile( tileBounds );

		const u = this._sdfMaterial.uniforms;
		u.uTileBounds.value.set( minLonDeg, minLatDeg, maxLonDeg, maxLatDeg );
		u.uResolution.value = resolution;
		u.tShapeData.value = shapeDataTex;
		u.tLabelAtlas.value = this._labelAtlasTex;

		const renderer = this._renderer;
		const prevRT = renderer.getRenderTarget();
		const prevClear = renderer.getClearColor( _clearColor );
		const prevAlpha = renderer.getClearAlpha();

		renderer.setRenderTarget( rt );
		renderer.setClearColor( 0x000000, 0 );
		renderer.clear();

		if ( shapeDataTex ) {

			renderer.render( this._sdfScene, this._sdfCamera );
			shapeDataTex.dispose();

		}

		renderer.setClearColor( prevClear, prevAlpha );
		renderer.setRenderTarget( prevRT );

	}

	/**
	 * 创建 SDF 全屏 pass：单 Quad + {@link TILE_SDF_FRAGMENT}。
	 */
	_initGPU() {

		if ( ! this._renderer ) return;

		const res = this.resolution;

		this._sdfMaterial = new ShaderMaterial( {
			glslVersion: GLSL3,
			uniforms: {
				uTileBounds: { value: new Vector4() },
				uResolution: { value: res },
				tShapeData: { value: null },
				tLabelAtlas: { value: this._labelAtlasTex },
			},
			vertexShader: TILE_SDF_VERTEX,
			fragmentShader: TILE_SDF_FRAGMENT,
			depthWrite: false,
			depthTest: false,
			transparent: true,
		} );

		const quad = new Mesh( new PlaneGeometry( 2, 2 ), this._sdfMaterial );
		this._sdfCamera = new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this._sdfScene = new Scene();
		this._sdfScene.add( quad );

		this._gpuReady = true;

	}

	/**
	 * 将 `tileBounds`（度）内相交的图元编码为 1D Float32 纹理，格式与 `TileSdfShader` 中 `readF` 一致。
	 *
	 * 每图元块：`type`, `totalFloats`, `fillRGBA×4`, `strokeRGBA×4`, `strokeWidthDeg`, `opacity`, 然后类型相关字段……
	 *
	 * @param {number[]} tileBounds [minLon, minLat, maxLon, maxLat] 度
	 * @returns {import('three').DataTexture | null} 无图元时返回 `null`（调用方清空 RT）
	 */
	_buildShapeDataForTile( tileBounds ) {

		const midLat = ( tileBounds[ 1 ] + tileBounds[ 3 ] ) / 2;
		const metersPerDegLon = 111320 * Math.cos( midLat * DEG2RAD );
		const metersPerDegLat = 111320;

		const pxDeg = ( tileBounds[ 2 ] - tileBounds[ 0 ] ) / this.resolution;

		let shapeCount = 0;
		const arr = [ 0 ];

		for ( const [ id, shape ] of this.shapes ) {

			const opts = shape.options;
			if ( opts.visible === false ) continue;

			const shapeBounds = this._getShapeBounds( shape );
			if ( ! shapeBounds || ! _boundsIntersect( shapeBounds, tileBounds ) ) continue;

			const fill = _parseColor( opts.fillColor );
			const stroke = _parseColor( opts.strokeColor );

			const fillOp = opts.fillOpacity !== undefined ? opts.fillOpacity / 100 : 1;
			const strokeOp = opts.strokeOpacity !== undefined ? opts.strokeOpacity / 100 : 1;
			fill[ 3 ] *= fillOp;
			stroke[ 3 ] *= strokeOp;

			const swDeg = ( opts.strokeWidth || 0 ) * pxDeg;
			const op = 1.0;
			const pts = opts.points || [];
			const cat = shape.category;

			if ( cat === 'point' ) {

				if ( pts.length === 0 ) continue;
				const hsLon = ( opts.size || 0 ) / 2 / metersPerDegLon;
				const hsLat = ( opts.size || 0 ) / 2 / metersPerDegLat;
				const ps = opts.pointStyle === 'square' ? 1 : 0;
				arr.push( 6, 17, ...fill, ...stroke, swDeg, op, pts[ 0 ][ 0 ], pts[ 0 ][ 1 ], hsLon, hsLat, ps );
				shapeCount ++;

			} else if ( cat === 'line' ) {

				const vc = pts.length;
				if ( vc < 2 ) continue;
				const hwDeg = ( opts.strokeWidth || 3 ) * pxDeg / 2;
				const sa = _arrowInt( opts.startArrowStyle );
				const ea = _arrowInt( opts.endArrowStyle );
				const aszDeg = ( opts.arrowSize || 0 ) * pxDeg;
				const total = 17 + vc * 2;

				const lineColor = _parseColor( opts.strokeColor || opts.fillColor || '#ffffff' );
				lineColor[ 3 ] *= strokeOp;

				arr.push( 3, total, lineColor[ 0 ], lineColor[ 1 ], lineColor[ 2 ], lineColor[ 3 ], 0, 0, 0, 0, 0, op, vc, hwDeg, sa, ea, aszDeg );
				for ( const c of pts ) arr.push( c[ 0 ], c[ 1 ] );
				shapeCount ++;

			} else if ( cat === 'polygon' ) {

				const vc = pts.length;
				if ( vc < 3 ) continue;
				const total = 13 + vc * 2;
				arr.push( 2, total, ...fill, ...stroke, swDeg, op, vc );
				for ( const c of pts ) arr.push( c[ 0 ], c[ 1 ] );
				shapeCount ++;

			} else if ( cat === 'rectangle' ) {

				if ( pts.length === 0 ) continue;
				const hwDeg = ( opts.width || 0 ) / 2 / metersPerDegLon;
				const hhDeg = ( opts.height || 0 ) / 2 / metersPerDegLat;
				arr.push( 0, 16, ...fill, ...stroke, swDeg, op, pts[ 0 ][ 0 ], pts[ 0 ][ 1 ], hwDeg, hhDeg );
				shapeCount ++;

			} else if ( cat === 'circle' ) {

				if ( pts.length === 0 ) continue;
				const rLon = ( opts.radius || 0 ) / metersPerDegLon;
				const rLat = ( opts.radius || 0 ) / metersPerDegLat;
				arr.push( 1, 16, ...fill, ...stroke, swDeg, op, pts[ 0 ][ 0 ], pts[ 0 ][ 1 ], rLon, rLat );
				shapeCount ++;

			} else if ( cat === 'sector' ) {

				if ( pts.length === 0 ) continue;
				const rLon = ( opts.radius || 0 ) / metersPerDegLon;
				const rLat = ( opts.radius || 0 ) / metersPerDegLat;
				arr.push( 5, 18, ...fill, ...stroke, swDeg, op,
					pts[ 0 ][ 0 ], pts[ 0 ][ 1 ], rLon, rLat,
					( opts.startAngle || 0 ) * DEG2RAD,
					( opts.sectorAngle || 0 ) * DEG2RAD );
				shapeCount ++;

			} else if ( cat === 'text' ) {

				if ( pts.length === 0 ) continue;
				const tile = this._labelTiles.get( id );
				if ( ! tile ) continue;
				arr.push( 4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, op,
					pts[ 0 ][ 0 ], pts[ 0 ][ 1 ], tile.halfWDeg, tile.halfHDeg,
					tile.u0, tile.v0, tile.u1, tile.v1 );
				shapeCount ++;

			} else if ( cat === 'arrow' ) {

				const verts = shape.generateCoords();
				const vc = verts.length;
				if ( vc < 3 ) continue;
				const total = 13 + vc * 2;
				arr.push( 2, total, ...fill, ...stroke, swDeg, op, vc );
				for ( const c of verts ) arr.push( c[ 0 ], c[ 1 ] );
				shapeCount ++;

			}

		}

		arr[ 0 ] = shapeCount;

		const data = new Float32Array( arr );
		const texWidth = Math.ceil( data.length / 4 );
		const padded = new Float32Array( texWidth * 4 );
		padded.set( data );

		const tex = new DataTexture( padded, texWidth, 1, RGBAFormat, FloatType );
		tex.minFilter = NearestFilter;
		tex.magFilter = NearestFilter;
		tex.colorSpace = LinearSRGBColorSpace;
		tex.needsUpdate = true;
		return tex;

	}

	/**
	 * 遍历 `shapes` 中文本项，在共享 canvas 上排版并写入 `_labelTiles`（半宽/半高/UV）。
	 * `LABEL_M_PER_PX` 将像素尺度映射到地面度数，与 `hasContent` 中文字包围盒估算同一量级。
	 */
	_buildLabelAtlas() {

		this._labelTiles.clear();
		const ctx = this._labelCanvas.getContext( '2d' );
		ctx.clearRect( 0, 0, LABEL_ATLAS_SIZE, LABEL_ATLAS_SIZE );

		let cursorX = 0, cursorY = 0, rowH = 0;
		const LABEL_M_PER_PX = 10;

		for ( const [ id, shape ] of this.shapes ) {

			if ( shape.category !== 'text' ) continue;
			const opts = shape.options;

			const fontSize = opts.fontSize || 48;
			const font = fontSize + 'px sans-serif';
			const pad = ( opts.strokeWidth || 4 ) + 6;

			ctx.font = font;
			const metrics = ctx.measureText( opts.content || '' );
			const tw = Math.ceil( metrics.width + pad * 2 );
			const th = Math.ceil( fontSize * 1.4 + pad * 2 );

			if ( cursorX + tw > LABEL_ATLAS_SIZE ) {

				cursorX = 0;
				cursorY += rowH;
				rowH = 0;

			}

			if ( cursorY + th > LABEL_ATLAS_SIZE ) break;

			const tx = cursorX, ty = cursorY;
			const cx = tx + tw / 2, cy = ty + th / 2;

			ctx.font = font;
			ctx.textAlign = opts.textAlign || 'center';
			ctx.textBaseline = 'middle';

			if ( opts.strokeColor && ( opts.strokeWidth || 0 ) > 0 ) {

				ctx.strokeStyle = opts.strokeColor;
				ctx.lineWidth = opts.strokeWidth || 4;
				ctx.strokeText( opts.content || '', cx, cy );

			}

			ctx.fillStyle = opts.fontColor || opts.fillColor || '#ffffff';
			ctx.globalAlpha = 1;
			ctx.fillText( opts.content || '', cx, cy );

			const cLat = ( opts.points && opts.points[ 0 ] ) ? opts.points[ 0 ][ 1 ] : 0;
			const metersPerDegLon = 111320 * Math.cos( cLat * DEG2RAD );
			const metersPerDegLat = 111320;

			this._labelTiles.set( id, {
				halfWDeg: tw * LABEL_M_PER_PX / metersPerDegLon / 2,
				halfHDeg: th * LABEL_M_PER_PX / metersPerDegLat / 2,
				u0: tx / LABEL_ATLAS_SIZE, v0: ty / LABEL_ATLAS_SIZE,
				u1: ( tx + tw ) / LABEL_ATLAS_SIZE, v1: ( ty + th ) / LABEL_ATLAS_SIZE,
			} );

			cursorX += tw;
			if ( th > rowH ) rowH = th;

		}

		this._labelAtlasTex.needsUpdate = true;

	}

	/**
	 * 根据当前 `shapes` 重算 `contentBounds` 并刷新标签图集。
	 */
	_updateBounds() {

		let minLon = Infinity, minLat = Infinity;
		let maxLon = - Infinity, maxLat = - Infinity;
		let hasAny = false;

		for ( const shape of this.shapes.values() ) {

			if ( shape.options.visible === false ) continue;
			const bounds = this._getShapeBounds( shape );
			if ( ! bounds ) continue;

			minLon = Math.min( minLon, bounds[ 0 ] );
			minLat = Math.min( minLat, bounds[ 1 ] );
			maxLon = Math.max( maxLon, bounds[ 2 ] );
			maxLat = Math.max( maxLat, bounds[ 3 ] );
			hasAny = true;

		}

		this.contentBounds = hasAny ? [ minLon, minLat, maxLon, maxLat ] : null;

		this._buildLabelAtlas();

	}

	/**
	 * 单图元外包盒（度），用于剔除与瓦片不相交的图元。
	 * @param {object} shape
	 * @returns {number[] | null} [minLon, minLat, maxLon, maxLat]
	 */
	_getShapeBounds( shape ) {

		const pts = shape.options.points;
		if ( ! pts || pts.length === 0 ) return null;

		let minLon = Infinity, minLat = Infinity;
		let maxLon = - Infinity, maxLat = - Infinity;

		for ( const [ lon, lat ] of pts ) {

			minLon = Math.min( minLon, lon );
			maxLon = Math.max( maxLon, lon );
			minLat = Math.min( minLat, lat );
			maxLat = Math.max( maxLat, lat );

		}

		const cat = shape.category;
		if ( cat === 'circle' || cat === 'sector' ) {

			const r = shape.options.radius || 0;
			const dLon = r / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = r / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		} else if ( cat === 'rectangle' ) {

			const dLon = ( shape.options.width || 0 ) / 2 / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = ( shape.options.height || 0 ) / 2 / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		} else if ( cat === 'point' ) {

			const sz = ( shape.options.size || 0 ) / 2;
			const dLon = sz / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = sz / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		} else if ( cat === 'text' ) {

			const fontSize = shape.options.fontSize || 48;
			const content = shape.options.content || '';
			const textH = fontSize * 10;
			const textW = textH * content.length * 0.7;
			const dLon = textW / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = textH / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		}

		const sw = shape.options.strokeWidth || 0;
		if ( sw > 0 ) {

			const pad = sw * 0.001;
			minLon -= pad; maxLon += pad;
			minLat -= pad; maxLat += pad;

		}

		return [ minLon, minLat, maxLon, maxLat ];

	}

}

// ═══════════════════════════════════════════════════════════════════════════
// 模块内工具函数（不导出）
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @param {string | undefined} color
 * @returns {[number, number, number, number]} RGBA 线性 0..1
 */
function _parseColor( color ) {

	if ( ! color || color === 'transparent' ) return [ 0, 0, 0, 0 ];

	if ( typeof color === 'string' && color.startsWith( '#' ) ) {

		let hex = color.slice( 1 );
		if ( hex.length === 3 ) hex = hex[ 0 ] + hex[ 0 ] + hex[ 1 ] + hex[ 1 ] + hex[ 2 ] + hex[ 2 ];
		return [
			parseInt( hex.slice( 0, 2 ), 16 ) / 255,
			parseInt( hex.slice( 2, 4 ), 16 ) / 255,
			parseInt( hex.slice( 4, 6 ), 16 ) / 255,
			1.0,
		];

	}

	return [ 1, 1, 1, 1 ];

}

/**
 * @param {string | null | undefined} style
 * @returns {number} 与片元 `arrowSdf` 中分支对应
 */
function _arrowInt( style ) {

	if ( ! style ) return 0;
	return { 'filled': 1, 'open': 2, 'filledDiamond': 3, 'openDiamond': 4, 'filledCircle': 5, 'openCircle': 6, 'bar': 7 }[ style ] || 0;

}

/**
 * 两个轴对齐矩形是否相交（度坐标）。
 * @param {number[]} a [minLon, minLat, maxLon, maxLat]
 * @param {number[]} b
 */
function _boundsIntersect( a, b ) {

	if ( ! a || ! b ) return false;
	return ! ( a[ 2 ] < b[ 0 ] || a[ 0 ] > b[ 2 ] || a[ 3 ] < b[ 1 ] || a[ 1 ] > b[ 3 ] );

}
