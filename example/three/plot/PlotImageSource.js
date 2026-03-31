/**
 * PlotImageSource.js — 标绘图形 SDF 渲染源
 *
 * 使用 WebGLRenderTarget + SDF ShaderMaterial 将标绘图形渲染到 per-tile 纹理上。
 * 继承 RegionImageSource（DataCache），支持 lock/release/get 缓存机制。
 *
 * 核心流程：
 *   1. ImageOverlayPlugin 调用 hasContent(range) 判断该瓦片是否有图形
 *   2. 调用 lock(range) → fetchItem(tokens) → SDF 渲染到 WebGLRenderTarget → 拷贝纹理
 *   3. 数据变化时调用 redraw() 重新渲染所有已缓存的瓦片
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

const _clearColor = new Color();
import { RegionImageSource } from '../../../../src/three/plugins/images/sources/RegionImageSource.js';
import { ProjectionScheme } from '../../../../src/three/plugins/images/utils/ProjectionScheme.js';
import { TILE_SDF_VERTEX, TILE_SDF_FRAGMENT } from './TileSdfShader.js';

const DEG2RAD = MathUtils.DEG2RAD;
const RAD2DEG = MathUtils.RAD2DEG;

const LABEL_ATLAS_SIZE = 2048;

export class PlotImageSource extends RegionImageSource {

	constructor( options = {} ) {

		super();
		this.resolution = options.resolution || 512;
		this.projection = new ProjectionScheme();
		this.shapes = new Map();
		this.contentBounds = null;

		this._renderer = options.renderer || null;
		this._rt = null;
		this._sdfScene = null;
		this._sdfCamera = null;
		this._sdfMaterial = null;
		this._gpuReady = false;

		// 标签 atlas
		this._labelCanvas = document.createElement( 'canvas' );
		this._labelCanvas.width = LABEL_ATLAS_SIZE;
		this._labelCanvas.height = LABEL_ATLAS_SIZE;
		this._labelAtlasTex = new CanvasTexture( this._labelCanvas );
		this._labelAtlasTex.flipY = false;
		this._labelAtlasTex.minFilter = LinearFilter;
		this._labelAtlasTex.magFilter = LinearFilter;
		this._labelTiles = new Map();

	}

	async init() {

		this._updateBounds();
		this._initGPU();

	}

	setRenderer( renderer ) {

		this._renderer = renderer;

	}

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

		// 每个瓦片独立的 RT → 返回其 texture 避免 readPixels 拷贝
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

	disposeItem( texture ) {

		if ( texture._parentRT ) {

			texture._parentRT.dispose();

		} else {

			texture.dispose();

		}

	}

	_createEmptyTexture() {

		const data = new Uint8Array( 4 );
		const tex = new DataTexture( data, 1, 1 );
		tex.needsUpdate = true;
		return tex;

	}

	redraw() {

		this._updateBounds();
		this._buildLabelAtlas();

		// 清除缓存，强制 plugin 重新请求所有瓦片纹理
		this.dispose();

	}

	// ═══════════════════════════════════════════
	// GPU 初始化
	// ═══════════════════════════════════════════

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

	// ═══════════════════════════════════════════
	// 图形数据打包
	// ═══════════════════════════════════════════

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

	// ═══════════════════════════════════════════
	// 标签 atlas
	// ═══════════════════════════════════════════

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

			if ( cursorX + tw > LABEL_ATLAS_SIZE ) { cursorX = 0; cursorY += rowH; rowH = 0; }
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

	// ═══════════════════════════════════════════
	// 包围盒
	// ═══════════════════════════════════════════

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

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

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

function _arrowInt( style ) {

	if ( ! style ) return 0;
	return { 'filled': 1, 'open': 2, 'filledDiamond': 3, 'openDiamond': 4, 'filledCircle': 5, 'openCircle': 6, 'bar': 7 }[ style ] || 0;

}

function _boundsIntersect( a, b ) {

	if ( ! a || ! b ) return false;
	return ! ( a[ 2 ] < b[ 0 ] || a[ 0 ] > b[ 2 ] || a[ 3 ] < b[ 1 ] || a[ 1 ] > b[ 3 ] );

}
