/**
 * GroundDecalManager.js — 地面标绘管理器
 *
 * 渲染流程（Stencil Volume + SDF 混合管线）：
 *   1. 渲染场景到默认帧缓冲（地形填充深度缓冲）
 *   2. 为每个图形的包围体执行模板写入（背面增/正面减）
 *      → 模板缓冲标记了地形表面在包围体内的像素
 *   3. 渲染场景到 depthRT（获取颜色+深度纹理用于 SDF 合成）
 *   4. 全屏 SDF 合成 pass（带模板测试 stencil != 0）
 *      → 仅在模板标记的像素上运行 SDF 计算
 *      → 完全不需要 fwidth(depth) 过滤，从根本上消除倾斜视角裁剪
 *
 * 每个图形独立 ENU 坐标系，互不耦合。
 * strokeWidth / arrowSize 以像素值传入 shader，用 fwidth 逐像素转米。
 */

import { PlotPoint } from './PlotPoint.js';
import { PlotLine } from './PlotLine.js';
import { PlotPolygon } from './PlotPolygon.js';
import { PlotRectangle } from './PlotRectangle.js';
import { PlotCircle } from './PlotCircle.js';
import { PlotSector } from './PlotSector.js';
import { PlotLabel } from './PlotLabel.js';
import { PlotArrow } from './PlotArrow.js';

import { DECAL_VERTEX, DECAL_FRAGMENT } from './shaders.js';
import { parseColorToRGBA, resolveOpacity } from './colorUtils.js';
import { lonLatToMeters, DEG2RAD, LABEL_ATLAS } from './coordUtils.js';
import { buildBoundingVolume, writeStencil } from './StencilVolume.js';

import {
	Scene,
	WebGLRenderTarget,
	DepthTexture,
	ShaderMaterial,
	PlaneGeometry,
	Mesh,
	OrthographicCamera,
	Matrix4,
	Vector3,
	DataTexture,
	CanvasTexture,
	FloatType,
	RGBAFormat,
	NearestFilter,
	LinearFilter,
	LinearSRGBColorSpace,
	NotEqualStencilFunc,
	ZeroStencilOp,
	GLSL3,
} from 'three';

const LABEL_M_PER_PX = 10;

const _sCenter = new Vector3();
const _sEast = new Vector3();
const _sNorth = new Vector3();
const _sUp = new Vector3();

export class GroundDecalManager {

	constructor( renderer, globalOptions = {} ) {

		this._renderer = renderer;
		this._items = new Map();
		this._dataDirty = true;
		this._globalOpacity = globalOptions.opacity ?? 1.0;

		this._centerECEF = new Vector3();
		this._east = new Vector3();
		this._north = new Vector3();
		this._up = new Vector3();
		this._centerLatRad = 0;
		this._centerLonRad = 0;
		this._ellipsoid = null;
		this._tilesGroup = null;

		this._viewToECEF = new Matrix4();

		this._shapeDataTex = null;
		this._shapeDataTexWidth = 1;

		// 模板体积：每个图形的包围体 Mesh
		this._volumeMeshes = [];
		this._stencilScene = new Scene();

		this._labelCanvas = document.createElement( 'canvas' );
		this._labelCanvas.width = LABEL_ATLAS;
		this._labelCanvas.height = LABEL_ATLAS;
		this._labelAtlasTex = new CanvasTexture( this._labelCanvas );
		this._labelAtlasTex.flipY = false;
		this._labelAtlasTex.minFilter = LinearFilter;
		this._labelAtlasTex.magFilter = LinearFilter;

		this._depthRT = null;
		this._compositeScene = null;
		this._compositeCamera = null;
		this._compositeMaterial = null;

		this._initGPU();

	}

	// ═══════════════════════════════════════════
	// 图形创建
	// ═══════════════════════════════════════════

	addPoint( options ) {

		const shape = new PlotPoint( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	addLine( options ) {

		const shape = new PlotLine( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	addPolygon( options ) {

		const shape = new PlotPolygon( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	addRectangle( options ) {

		const shape = new PlotRectangle( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	addCircle( options ) {

		const shape = new PlotCircle( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	addSector( options ) {

		const shape = new PlotSector( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	addText( options ) {

		const shape = new PlotLabel( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	addArrow( options ) {

		const shape = new PlotArrow( options );
		this._items.set( shape.id, shape );
		this._dataDirty = true;
		return shape.id;

	}

	remove( id ) {

		if ( this._items.delete( id ) ) this._dataDirty = true;

	}

	clear() {

		this._items.clear();
		this._dataDirty = true;

	}

	// ═══════════════════════════════════════════
	// 查询与修改
	// ═══════════════════════════════════════════

	getItem( id ) {

		const shape = this._items.get( id );
		return shape ? shape.getSnapshot() : null;

	}

	setStyle( id, patch ) {

		const shape = this._items.get( id );
		if ( ! shape ) return;
		shape.update( patch );
		this._dataDirty = true;

	}

	setCenter( id, center ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points || shape.options.points.length === 0 ) return;
		if ( center.lon !== undefined ) shape.options.points[ 0 ][ 0 ] = center.lon;
		if ( center.lat !== undefined ) shape.options.points[ 0 ][ 1 ] = center.lat;
		this._dataDirty = true;

	}

	setCoords( id, coords ) {

		const shape = this._items.get( id );
		if ( ! shape ) return;
		shape.options.points = coords.map( c => [ ...c ] );
		this._dataDirty = true;

	}

	setCoord( id, index, coord ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		if ( index < 0 || index >= shape.options.points.length ) return;
		if ( coord[ 0 ] !== undefined ) shape.options.points[ index ][ 0 ] = coord[ 0 ];
		if ( coord[ 1 ] !== undefined ) shape.options.points[ index ][ 1 ] = coord[ 1 ];
		this._dataDirty = true;

	}

	insertCoord( id, index, coord ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		const idx = Math.max( 0, Math.min( index, shape.options.points.length ) );
		shape.options.points.splice( idx, 0, [ ...coord ] );
		this._dataDirty = true;

	}

	removeCoord( id, index ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		if ( index < 0 || index >= shape.options.points.length ) return;
		const minVerts = shape.category === 'polygon' ? 3 : 2;
		if ( shape.options.points.length <= minVerts ) return;
		shape.options.points.splice( index, 1 );
		this._dataDirty = true;

	}

	translateCoords( id, dLon, dLat ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		for ( const p of shape.options.points ) {

			p[ 0 ] += dLon; p[ 1 ] += dLat;

		}

		this._dataDirty = true;

	}

	setText( id, text ) {

		const shape = this._items.get( id );
		if ( ! shape || shape.category !== 'text' ) return;
		shape.options.content = text;
		this._dataDirty = true;

	}

	setGlobalOpacity( opacity ) {

		this._globalOpacity = opacity;

	}

	getCoordCount( id ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return 0;
		return shape.options.points.length;

	}

	findNearestCoord( id, lon, lat ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points || shape.options.points.length === 0 ) return - 1;
		let bestIdx = 0, bestDist = Infinity;
		for ( let i = 0; i < shape.options.points.length; i ++ ) {

			const dLon = shape.options.points[ i ][ 0 ] - lon;
			const dLat = shape.options.points[ i ][ 1 ] - lat;
			const d = dLon * dLon + dLat * dLat;
			if ( d < bestDist ) {

				bestDist = d; bestIdx = i;

			}

		}

		return bestIdx;

	}

	// ═══════════════════════════════════════════
	// 生命周期
	// ═══════════════════════════════════════════

	setEllipsoid( ellipsoid, tilesGroup ) {

		this._ellipsoid = ellipsoid;
		this._tilesGroup = tilesGroup;
		this._dataDirty = true;

	}

	resize( w, h ) {

		if ( ! this._depthRT ) return;
		this._depthRT.setSize( w * window.devicePixelRatio, h * window.devicePixelRatio );

	}

	/**
	 * 每帧渲染入口 — Stencil Volume + SDF 混合管线
	 *
	 * Step 1: 渲染场景到默认帧缓冲（地形填充深度+颜色缓冲）
	 * Step 2: 模板写入 — 每个图形的包围体标记地形表面像素
	 * Step 3: 渲染场景到 depthRT（SDF shader 需要深度纹理做位置重建）
	 * Step 4: 全屏 SDF 合成（带模板测试 != 0），仅处理模板标记的像素
	 */
	render( scene, camera, tilesGroup ) {

		if ( this._items.size === 0 || ! this._ellipsoid ) return;
		if ( this._dataDirty ) this._rebuildShapeData();

		const renderer = this._renderer;
		const gl = renderer.getContext();

		// Step 1: 渲染场景到默认帧缓冲（深度缓冲用于模板体积测试）
		renderer.render( scene, camera );

		// Step 2: 模板写入
		const autoClear = renderer.autoClear;
		renderer.autoClear = false;

		for ( const vol of this._volumeMeshes ) {

			writeStencil( renderer, vol, this._stencilScene, camera );

		}

		// Step 3: 渲染场景到 depthRT（SDF 位置重建用）
		renderer.setRenderTarget( this._depthRT );
		renderer.clear();
		renderer.render( scene, camera );
		renderer.setRenderTarget( null );

		// Step 4: 全屏 SDF 合成（带模板测试）
		this._viewToECEF.multiplyMatrices( tilesGroup.matrixWorldInverse, camera.matrixWorld );
		const el = this._viewToECEF.elements;
		const ox = el[ 12 ] - this._centerECEF.x;
		const oy = el[ 13 ] - this._centerECEF.y;
		const oz = el[ 14 ] - this._centerECEF.z;

		const u = this._compositeMaterial.uniforms;
		u.tColor.value = this._depthRT.texture;
		u.tDepth.value = this._depthRT.depthTexture;
		u.tShapeData.value = this._shapeDataTex;
		u.tLabelAtlas.value = this._labelAtlasTex;
		u.uInvProjection.value.copy( camera.projectionMatrixInverse );
		u.uViewToECEF.value.copy( this._viewToECEF );
		u.uOffsetHigh.value.set( Math.fround( ox ), Math.fround( oy ), Math.fround( oz ) );
		u.uOffsetLow.value.set( ox - Math.fround( ox ), oy - Math.fround( oy ), oz - Math.fround( oz ) );
		u.uEast.value.copy( this._east );
		u.uNorth.value.copy( this._north );
		u.uGlobalOpacity.value = this._globalOpacity;

		renderer.render( this._compositeScene, this._compositeCamera );

		// 清除模板缓冲
		gl.clear( gl.STENCIL_BUFFER_BIT );

		renderer.autoClear = autoClear;

	}

	dispose() {

		if ( this._depthRT ) this._depthRT.dispose();
		if ( this._shapeDataTex ) this._shapeDataTex.dispose();
		if ( this._labelAtlasTex ) this._labelAtlasTex.dispose();
		if ( this._compositeMaterial ) this._compositeMaterial.dispose();
		for ( const vol of this._volumeMeshes ) vol.geometry.dispose();

	}

	// ═══════════════════════════════════════════
	// 私有方法
	// ═══════════════════════════════════════════

	_initGPU() {

		const w = window.innerWidth * window.devicePixelRatio;
		const h = window.innerHeight * window.devicePixelRatio;

		this._depthRT = new WebGLRenderTarget( w, h, {
			depthTexture: new DepthTexture( w, h ),
		} );

		const emptyData = new Float32Array( 4 );
		this._shapeDataTex = new DataTexture( emptyData, 1, 1, RGBAFormat, FloatType );
		this._shapeDataTex.minFilter = NearestFilter;
		this._shapeDataTex.magFilter = NearestFilter;
		this._shapeDataTex.colorSpace = LinearSRGBColorSpace;
		this._shapeDataTex.needsUpdate = true;

		this._compositeMaterial = new ShaderMaterial( {
			glslVersion: GLSL3,
			uniforms: {
				tColor: { value: null },
				tDepth: { value: null },
				tShapeData: { value: this._shapeDataTex },
				tLabelAtlas: { value: this._labelAtlasTex },
				uInvProjection: { value: new Matrix4() },
				uViewToECEF: { value: new Matrix4() },
				uOffsetHigh: { value: new Vector3() },
				uOffsetLow: { value: new Vector3() },
				uEast: { value: new Vector3() },
				uNorth: { value: new Vector3() },
				uGlobalOpacity: { value: 1.0 },
			},
			vertexShader: DECAL_VERTEX,
			fragmentShader: DECAL_FRAGMENT,
			depthWrite: false,
			depthTest: false,
			transparent: true,
			// 模板测试：仅处理 stencil != 0 的像素
			stencilWrite: true,
			stencilFunc: NotEqualStencilFunc,
			stencilRef: 0,
			stencilFail: ZeroStencilOp,
			stencilZFail: ZeroStencilOp,
			stencilZPass: ZeroStencilOp,
		} );

		const quad = new Mesh( new PlaneGeometry( 2, 2 ), this._compositeMaterial );
		quad.frustumCulled = false;
		this._compositeCamera = new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this._compositeScene = new Scene();
		this._compositeScene.add( quad );

	}

	_getShapeCenter( shape ) {

		const pts = shape.options.points || [];
		if ( pts.length === 0 ) return [ 0, 0 ];

		const cat = shape.category;
		if ( cat === 'point' || cat === 'rectangle' || cat === 'circle' || cat === 'sector' || cat === 'text' ) {

			return [ pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] ];

		}

		let lonSum = 0, latSum = 0;
		for ( const p of pts ) {

			lonSum += p[ 0 ]; latSum += p[ 1 ];

		}

		return [ lonSum / pts.length, latSum / pts.length ];

	}

	_packHeader( arr, typeId, total, fill, stroke, swPx, op, shape ) {

		const [ cLon, cLat ] = this._getShapeCenter( shape );

		this._ellipsoid.getCartographicToPosition( cLat * DEG2RAD, cLon * DEG2RAD, 0, _sCenter );
		this._ellipsoid.getEastNorthUpAxes( cLat * DEG2RAD, cLon * DEG2RAD, _sEast, _sNorth, _sUp );

		const coffX = _sCenter.x - this._centerECEF.x;
		const coffY = _sCenter.y - this._centerECEF.y;
		const coffZ = _sCenter.z - this._centerECEF.z;

		arr.push(
			typeId, total,
			fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
			stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
			swPx, op,
			coffX, coffY, coffZ,
			_sEast.x, _sEast.y, _sEast.z,
			_sNorth.x, _sNorth.y, _sNorth.z
		);

		const centerLonRad = cLon * DEG2RAD;
		const centerLatRad = cLat * DEG2RAD;
		const ellipsoid = this._ellipsoid;
		const east = _sEast.clone();
		const north = _sNorth.clone();
		const center = _sCenter.clone();

		return {
			toLocal: ( lon, lat ) => lonLatToMeters( lon, lat, centerLonRad, centerLatRad, ellipsoid, east, north, center ),
		};

	}

	_rebuildShapeData() {

		this._dataDirty = false;
		if ( this._items.size === 0 || ! this._ellipsoid ) return;

		this._computeCenter();

		const labelTiles = this._buildLabelAtlas( LABEL_M_PER_PX );

		// 清理旧的包围体
		for ( const vol of this._volumeMeshes ) vol.geometry.dispose();
		this._volumeMeshes = [];

		let shapeCount = 0;
		const arr = [ 0 ];
		const opBuf = [ 1, 1 ];

		for ( const [ id, shape ] of this._items ) {

			const opts = shape.options;
			if ( opts.visible === false ) continue;

			const fill = parseColorToRGBA( opts.fillColor );
			const stroke = parseColorToRGBA( opts.strokeColor );

			resolveOpacity( opts, opBuf );
			fill[ 3 ] *= opBuf[ 0 ];
			stroke[ 3 ] *= opBuf[ 1 ];

			const swPx = opts.strokeWidth || 0;
			const op = 1.0;
			const pts = opts.points || [];

			// 为该图形生成模板包围体
			const extPts = shape.getExtentPoints();
			const padding = ( swPx + 10 ) * 100;
			if ( extPts.length > 0 && this._tilesGroup ) {

				const vol = buildBoundingVolume( extPts, padding, this._ellipsoid, this._tilesGroup.matrixWorld );
				if ( vol ) this._volumeMeshes.push( vol );

			}

			if ( shape.category === 'point' ) {

				if ( pts.length === 0 ) continue;
				const halfSize = ( opts.size || 0 ) / 2;
				const ps = opts.pointStyle === 'square' ? 1 : 0;
				this._packHeader( arr, 6, 23, fill, stroke, swPx, op, shape );
				arr.push( halfSize, ps );
				shapeCount ++;

			} else if ( shape.category === 'line' ) {

				const vc = pts.length;
				if ( vc < 2 ) continue;
				const hwPx = ( opts.strokeWidth || 3 ) / 2;
				const sa = this._arrowStyleToInt( opts.startArrowStyle );
				const ea = this._arrowStyleToInt( opts.endArrowStyle );
				const aszPx = opts.arrowSize || 0;
				const total = 26 + vc * 2;
				const lineColor = parseColorToRGBA( opts.strokeColor || opts.fillColor || '#ffffff' );
				lineColor[ 3 ] *= opBuf[ 1 ];
				const { toLocal } = this._packHeader( arr, 3, total, lineColor, [ 0, 0, 0, 0 ], 0, op, shape );
				arr.push( vc, hwPx, sa, ea, aszPx );
				for ( const c of pts ) {

					const m = toLocal( c[ 0 ], c[ 1 ] );
					arr.push( m.e, m.n );

				}

				shapeCount ++;

			} else if ( shape.category === 'polygon' ) {

				const vc = pts.length;
				if ( vc < 3 ) continue;
				const total = 22 + vc * 2;
				const { toLocal } = this._packHeader( arr, 2, total, fill, stroke, swPx, op, shape );
				arr.push( vc );
				for ( const c of pts ) {

					const m = toLocal( c[ 0 ], c[ 1 ] );
					arr.push( m.e, m.n );

				}

				shapeCount ++;

			} else if ( shape.category === 'rectangle' ) {

				if ( pts.length === 0 ) continue;
				const hw = ( opts.width || 0 ) / 2;
				const hh = ( opts.height || 0 ) / 2;
				this._packHeader( arr, 0, 23, fill, stroke, swPx, op, shape );
				arr.push( hw, hh );
				shapeCount ++;

			} else if ( shape.category === 'circle' ) {

				if ( pts.length === 0 ) continue;
				this._packHeader( arr, 1, 22, fill, stroke, swPx, op, shape );
				arr.push( opts.radius || 0 );
				shapeCount ++;

			} else if ( shape.category === 'sector' ) {

				if ( pts.length === 0 ) continue;
				this._packHeader( arr, 5, 24, fill, stroke, swPx, op, shape );
				arr.push( opts.radius || 0, ( opts.startAngle || 0 ) * DEG2RAD, ( opts.sectorAngle || 0 ) * DEG2RAD );
				shapeCount ++;

			} else if ( shape.category === 'text' ) {

				if ( pts.length === 0 ) continue;
				const tile = labelTiles.get( id );
				if ( ! tile ) continue;
				this._packHeader( arr, 4, 27, [ 0, 0, 0, 0 ], [ 0, 0, 0, 0 ], 0, op, shape );
				arr.push( tile.halfW, tile.halfH, tile.u0, tile.v0, tile.u1, tile.v1 );
				shapeCount ++;

			} else if ( shape.category === 'arrow' ) {

				const verts = shape.generateCoords();
				const vc = verts.length;
				if ( vc < 3 ) continue;
				const total = 22 + vc * 2;
				const { toLocal } = this._packHeader( arr, 2, total, fill, stroke, swPx, op, shape );
				arr.push( vc );
				for ( const c of verts ) {

					const m = toLocal( c[ 0 ], c[ 1 ] );
					arr.push( m.e, m.n );

				}

				shapeCount ++;

			}

		}

		arr[ 0 ] = shapeCount;

		const data = new Float32Array( arr );
		const texWidth = Math.ceil( data.length / 4 );
		const padded = new Float32Array( texWidth * 4 );
		padded.set( data );

		if ( this._shapeDataTex ) this._shapeDataTex.dispose();
		this._shapeDataTex = new DataTexture( padded, texWidth, 1, RGBAFormat, FloatType );
		this._shapeDataTex.minFilter = NearestFilter;
		this._shapeDataTex.magFilter = NearestFilter;
		this._shapeDataTex.colorSpace = LinearSRGBColorSpace;
		this._shapeDataTex.needsUpdate = true;
		this._shapeDataTexWidth = texWidth;

	}

	_computeCenter() {

		let lonSum = 0, latSum = 0, count = 0;
		for ( const shape of this._items.values() ) {

			for ( const [ lon, lat ] of shape.getCenterPoints() ) {

				lonSum += lon; latSum += lat; count ++;

			}

		}

		if ( count === 0 ) return;

		this._centerLonRad = ( lonSum / count ) * DEG2RAD;
		this._centerLatRad = ( latSum / count ) * DEG2RAD;

		this._ellipsoid.getCartographicToPosition( this._centerLatRad, this._centerLonRad, 0, this._centerECEF );
		this._ellipsoid.getEastNorthUpAxes( this._centerLatRad, this._centerLonRad, this._east, this._north, this._up );

	}

	_arrowStyleToInt( style ) {

		if ( ! style ) return 0;
		return { 'filled': 1, 'open': 2, 'filledDiamond': 3, 'openDiamond': 4, 'filledCircle': 5, 'openCircle': 6, 'bar': 7 }[ style ] || 0;

	}

	_buildLabelAtlas( mPerPx ) {

		const tiles = new Map();
		const ctx = this._labelCanvas.getContext( '2d' );
		ctx.clearRect( 0, 0, LABEL_ATLAS, LABEL_ATLAS );

		let cursorX = 0, cursorY = 0, rowH = 0;

		for ( const [ id, shape ] of this._items ) {

			if ( shape.category !== 'text' ) continue;
			const opts = shape.options;

			const fontSize = opts.fontSize || 48;
			const font = fontSize + 'px sans-serif';
			const pad = ( opts.strokeWidth || 4 ) + 6;

			ctx.font = font;
			const metrics = ctx.measureText( opts.content || '' );
			const tw = Math.ceil( metrics.width + pad * 2 );
			const th = Math.ceil( fontSize * 1.4 + pad * 2 );

			if ( cursorX + tw > LABEL_ATLAS ) {

				cursorX = 0; cursorY += rowH; rowH = 0;

			}

			if ( cursorY + th > LABEL_ATLAS ) break;

			const tx = cursorX, ty = cursorY;
			const cx = tx + tw / 2, cy = ty + th / 2;

			ctx.font = font;
			ctx.textAlign = opts.textAlign || 'center';
			ctx.textBaseline = 'middle';

			if ( opts.strokeColor ) {

				ctx.strokeStyle = opts.strokeColor;
				ctx.lineWidth = opts.strokeWidth || 4;
				ctx.strokeText( opts.content || '', cx, cy );

			}

			ctx.fillStyle = opts.fontColor || opts.fillColor || '#ffffff';
			ctx.globalAlpha = 1;
			ctx.fillText( opts.content || '', cx, cy );

			tiles.set( id, {
				halfW: tw * mPerPx / 2,
				halfH: th * mPerPx / 2,
				u0: tx / LABEL_ATLAS, v0: ty / LABEL_ATLAS,
				u1: ( tx + tw ) / LABEL_ATLAS, v1: ( ty + th ) / LABEL_ATLAS,
			} );

			cursorX += tw;
			if ( th > rowH ) rowH = th;

		}

		this._labelAtlasTex.needsUpdate = true;
		return tiles;

	}

}
