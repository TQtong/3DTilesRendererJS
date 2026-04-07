/**
 * @fileoverview **PlotSdfPlugin** — 在瓦片材质中逐屏幕像素实时求值 SDF，
 * 替代 PlotOverlay 的预烘焙 RTT 方案，彻底消除放大后像素化问题。
 *
 * 使用方式：
 * ```js
 * const plotPlugin = new PlotSdfPlugin({ shapes });
 * tiles.registerPlugin( plotPlugin );
 *
 * // 修改 shapes 后调用 redraw
 * plotPlugin.redraw();
 * ```
 *
 * @module plugins/PlotSdfPlugin
 */

import {
	Vector2,
	Vector3,
	BufferAttribute,
	DataTexture,
	FloatType,
	RGBAFormat,
	NearestFilter,
	LinearSRGBColorSpace,
	CanvasTexture,
	LinearFilter,
	MathUtils,
} from 'three';

import { PLOT_SDF_FUNCTIONS, PLOT_SDF_EVALUATE } from './images/sources/plot/TileSdfShader.js';
import { buildShapeData, boundsIntersect } from './images/sources/plot/buildShapeData.js';

const DEG2RAD = MathUtils.DEG2RAD;
const RAD2DEG = MathUtils.RAD2DEG;

const _vec = /* @__PURE__ */ new Vector3();
const _cart = {};

const PLOT_UNIFORMS = Symbol( 'PLOT_SDF_UNIFORMS' );
const LABEL_ATLAS_SIZE = 4096;
const LABEL_M_PER_PX = 3;
const LABEL_RENDER_SCALE = 4;

export class PlotSdfPlugin {

	constructor( options = {} ) {

		this.name = 'PLOT_SDF_PLUGIN';
		this.priority = 10;

		this.shapes = options.shapes || new Map();
		this.opacity = options.opacity ?? 1.0;
		this.contentBounds = null;

		this._tileData = new Map();
		this._emptyDataTex = null;

		this._labelCanvas = null;
		this._labelAtlasTex = null;
		this._labelTiles = new Map();

		this.tiles = null;

	}

	init( tiles ) {

		this.tiles = tiles;

		this._labelCanvas = document.createElement( 'canvas' );
		this._labelCanvas.width = LABEL_ATLAS_SIZE;
		this._labelCanvas.height = LABEL_ATLAS_SIZE;
		this._labelAtlasTex = new CanvasTexture( this._labelCanvas );
		this._labelAtlasTex.flipY = false;
		this._labelAtlasTex.minFilter = LinearFilter;
		this._labelAtlasTex.magFilter = LinearFilter;

		this._emptyDataTex = this._createEmptyDataTex();

		this._updateBounds();

		tiles.forEachLoadedModel( ( scene, tile ) => {

			this._processTile( scene, tile );

		} );

	}

	processTileModel( scene, tile ) {

		this._processTile( scene, tile );

	}

	disposeTile( tile ) {

		const info = this._tileData.get( tile );
		if ( info ) {

			if ( info.shapeDataTex ) info.shapeDataTex.dispose();
			this._tileData.delete( tile );

		}

	}

	dispose() {

		this._tileData.forEach( ( info ) => {

			if ( info.shapeDataTex ) info.shapeDataTex.dispose();

		} );
		this._tileData.clear();

		if ( this._emptyDataTex ) this._emptyDataTex.dispose();
		if ( this._labelAtlasTex ) this._labelAtlasTex.dispose();

	}

	redraw() {

		this._updateBounds();

		this._tileData.forEach( ( info, tile ) => {

			this._updateTileShapeData( tile, info );

		} );

	}

	// ── Internal ──

	_processTile( scene, tile ) {

		const { tiles } = this;
		if ( ! tiles ) return;

		const ellipsoid = tiles.ellipsoid;
		if ( ! ellipsoid ) return;

		// Detach from parent so matrixWorld is purely tile-internal (ECEF)
		const origParent = scene.parent;
		scene.parent = null;
		scene.updateMatrixWorld( true );

		const meshes = [];
		scene.traverse( c => {

			if ( c.isMesh && c.geometry ) meshes.push( c );

		} );

		scene.parent = origParent;

		if ( meshes.length === 0 ) return;

		const info = { meshes: [], shapeDataTex: null, bounds: null, refLonLat: null };

		// Pass 1: compute absolute lon/lat per vertex, accumulate bounds
		for ( const mesh of meshes ) {

			const geom = mesh.geometry;
			const posAttr = geom.getAttribute( 'position' );
			if ( ! posAttr ) continue;

			const lonLatArray = new Float32Array( posAttr.count * 2 );

			let minLon = Infinity, minLat = Infinity;
			let maxLon = - Infinity, maxLat = - Infinity;

			const meshToEcef = mesh.matrixWorld;

			for ( let i = 0; i < posAttr.count; i ++ ) {

				_vec.fromBufferAttribute( posAttr, i ).applyMatrix4( meshToEcef );
				ellipsoid.getPositionToCartographic( _vec, _cart );

				const lonDeg = _cart.lon * RAD2DEG;
				const latDeg = _cart.lat * RAD2DEG;

				lonLatArray[ i * 2 ] = lonDeg;
				lonLatArray[ i * 2 + 1 ] = latDeg;

				minLon = Math.min( minLon, lonDeg );
				maxLon = Math.max( maxLon, lonDeg );
				minLat = Math.min( minLat, latDeg );
				maxLat = Math.max( maxLat, latDeg );

			}

			const attr = new BufferAttribute( lonLatArray, 2 );
			geom.setAttribute( 'a_plotLonLat', attr );

			this._wrapMaterial( mesh );

			info.meshes.push( mesh );
			info.bounds = info.bounds
				? [
					Math.min( info.bounds[ 0 ], minLon ),
					Math.min( info.bounds[ 1 ], minLat ),
					Math.max( info.bounds[ 2 ], maxLon ),
					Math.max( info.bounds[ 3 ], maxLat ),
				]
				: [ minLon, minLat, maxLon, maxLat ];

		}

		// Pass 2: RTC — subtract tile center so vertex attributes are small deltas (float32 safe)
		if ( info.bounds ) {

			const refLon = ( info.bounds[ 0 ] + info.bounds[ 2 ] ) / 2;
			const refLat = ( info.bounds[ 1 ] + info.bounds[ 3 ] ) / 2;
			info.refLonLat = [ refLon, refLat ];

			for ( const mesh of info.meshes ) {

				const arr = mesh.geometry.getAttribute( 'a_plotLonLat' ).array;
				for ( let i = 0; i < arr.length; i += 2 ) {

					arr[ i ] -= refLon;
					arr[ i + 1 ] -= refLat;

				}

				mesh.geometry.getAttribute( 'a_plotLonLat' ).needsUpdate = true;

			}

		}

		this._tileData.set( tile, info );
		this._updateTileShapeData( tile, info );

	}

	_wrapMaterial( mesh ) {

		const material = mesh.material;
		if ( material[ PLOT_UNIFORMS ] ) return;

		// Shared uniform objects: created now, referenced by onBeforeCompile later,
		// updatable at any time via _setShapeDataOnMeshes.
		const plotUniforms = {
			plotShapeData: { value: this._emptyDataTex },
			plotLabelAtlas: { value: this._labelAtlasTex },
			plotOpacity: { value: this.opacity },
			plotViewHeight: { value: 1.0 },
			plotProjA: { value: 0.0 },
			plotProjB: { value: 0.0 },
			plotProjScale: { value: 1.0 },
		};

		material[ PLOT_UNIFORMS ] = plotUniforms;

		const _sz = new Vector2();
		const prevOnBeforeRender = mesh.onBeforeRender;
		mesh.onBeforeRender = ( renderer, _scene, camera ) => {

			if ( prevOnBeforeRender ) prevOnBeforeRender.call( mesh, renderer, _scene, camera );
			plotUniforms.plotViewHeight.value = renderer.getDrawingBufferSize( _sz ).y;
			const e = camera.projectionMatrix.elements;
			plotUniforms.plotProjA.value = e[ 10 ];
			plotUniforms.plotProjB.value = e[ 14 ];
			plotUniforms.plotProjScale.value = e[ 5 ];

		};

		const previousOnBeforeCompile = material.onBeforeCompile;

		material.onBeforeCompile = ( shader ) => {

			if ( previousOnBeforeCompile ) {

				previousOnBeforeCompile( shader );

			}

			shader.uniforms = { ...shader.uniforms, ...plotUniforms };

			shader.vertexShader = shader.vertexShader
				.replace( /void main\(\s*\)\s*\{/, value => /* glsl */ `
					attribute vec2 a_plotLonLat;
					varying vec2 v_plotLonLat;
					${ value }
						v_plotLonLat = a_plotLonLat;
				` );

			shader.fragmentShader = shader.fragmentShader
				.replace( /void main\(/, value => /* glsl */ `
					uniform sampler2D plotShapeData;
					uniform sampler2D plotLabelAtlas;
					uniform float plotOpacity;
					uniform float plotViewHeight;
					uniform float plotProjA;
					uniform float plotProjB;
					uniform float plotProjScale;
					varying vec2 v_plotLonLat;

					float plotReadF( int i ) {
						int pi = i / 4;
						vec4 t = texelFetch( plotShapeData, ivec2( pi, 0 ), 0 );
						int c = i - pi * 4;
						return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w;
					}

					${ PLOT_SDF_FUNCTIONS }

					${ value }
				` )
				.replace( /#include <alphamap_fragment>/, value => /* glsl */ `
					if ( plotOpacity > 0.001 ) {
						${ PLOT_SDF_EVALUATE }
					}
					${ value }
				` );

		};

		material.needsUpdate = true;

	}

	_updateTileShapeData( tile, info ) {

		if ( ! info || ! info.bounds ) return;

		const bounds = info.bounds;

		if ( info.shapeDataTex ) {

			info.shapeDataTex.dispose();
			info.shapeDataTex = null;

		}

		if ( ! this.contentBounds || ! boundsIntersect( this.contentBounds, bounds ) ) {

			this._setShapeDataOnMeshes( info, null );
			return;

		}

		const tex = buildShapeData( this.shapes, bounds, {
			screenSpace: true,
			getShapeBounds: ( shape ) => this._getShapeBounds( shape ),
			labelTiles: this._labelTiles,
			refLonLat: info.refLonLat,
		} );

		info.shapeDataTex = tex;
		this._setShapeDataOnMeshes( info, tex );

	}

	_setShapeDataOnMeshes( info, tex ) {

		const dataTex = tex || this._emptyDataTex;

		for ( const mesh of info.meshes ) {

			const uniforms = mesh.material[ PLOT_UNIFORMS ];
			if ( uniforms ) {

				uniforms.plotShapeData.value = dataTex;
				uniforms.plotLabelAtlas.value = this._labelAtlasTex;
				uniforms.plotOpacity.value = this.opacity;

			}

		}

	}

	_createEmptyDataTex() {

		const data = new Float32Array( 4 );
		const tex = new DataTexture( data, 1, 1, RGBAFormat, FloatType );
		tex.minFilter = NearestFilter;
		tex.magFilter = NearestFilter;
		tex.colorSpace = LinearSRGBColorSpace;
		tex.needsUpdate = true;
		return tex;

	}

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

		} else if ( cat === 'point' ) {

			const sz = ( shape.options.size || 0 ) / 2;
			const dLon = sz / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = sz / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		} else if ( cat === 'text' ) {

			const fontSize = shape.options.fontSize || 48;
			const content = shape.options.content || '';
			const textH = ( fontSize * 1.4 + 20 ) * LABEL_M_PER_PX;
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

	_buildLabelAtlas() {

		if ( ! this._labelCanvas ) return;

		this._labelTiles.clear();
		const ctx = this._labelCanvas.getContext( '2d' );
		ctx.clearRect( 0, 0, LABEL_ATLAS_SIZE, LABEL_ATLAS_SIZE );

		let cursorX = 0, cursorY = 0, rowH = 0;

		for ( const [ id, shape ] of this.shapes ) {

			if ( shape.category !== 'text' ) continue;
			const opts = shape.options;

			const fontSize = opts.fontSize || 48;
			let S = LABEL_RENDER_SCALE;
			let renderSize = fontSize * S;
			let strokeW = ( opts.strokeWidth || 4 ) * S;
			let pad = strokeW + 6 * S;

			ctx.font = renderSize + 'px sans-serif';
			let metrics = ctx.measureText( opts.content || '' );
			let tw = Math.ceil( metrics.width + pad * 2 );
			let th = Math.ceil( renderSize * 1.4 + pad * 2 );

			// Per-shape clamp: if either dimension exceeds the atlas, scale S down so it fits.
			if ( tw > LABEL_ATLAS_SIZE || th > LABEL_ATLAS_SIZE ) {

				const ratio = Math.min( ( LABEL_ATLAS_SIZE - 1 ) / tw, ( LABEL_ATLAS_SIZE - 1 ) / th );
				S = Math.max( 0.1, S * ratio );
				renderSize = fontSize * S;
				strokeW = ( opts.strokeWidth || 4 ) * S;
				pad = strokeW + 6 * S;
				ctx.font = renderSize + 'px sans-serif';
				metrics = ctx.measureText( opts.content || '' );
				tw = Math.ceil( metrics.width + pad * 2 );
				th = Math.ceil( renderSize * 1.4 + pad * 2 );

			}

			const font = renderSize + 'px sans-serif';
			const mPerCanvasPx = LABEL_M_PER_PX / S;

			if ( cursorX + tw > LABEL_ATLAS_SIZE ) {

				cursorX = 0;
				cursorY += rowH;
				rowH = 0;

			}

			if ( cursorY + th > LABEL_ATLAS_SIZE ) break;

			const tx = cursorX, ty = cursorY;
			const cy = ty + th / 2;
			const align = opts.textAlign || 'center';

			// Anchor x must match textAlign so the text stays inside the tile rect.
			let ax;
			if ( align === 'left' ) ax = tx + pad;
			else if ( align === 'right' ) ax = tx + tw - pad;
			else ax = tx + tw / 2;

			ctx.font = font;
			ctx.textAlign = align;
			ctx.textBaseline = 'middle';

			if ( opts.fillColor ) {

				ctx.globalAlpha = opts.fillOpacity !== undefined ? opts.fillOpacity / 100 : 1;
				ctx.fillStyle = opts.fillColor;
				ctx.fillRect( tx, ty, tw, th );

			}

			ctx.globalAlpha = 1;

			if ( opts.strokeColor && ( opts.strokeWidth || 0 ) > 0 ) {

				ctx.strokeStyle = opts.strokeColor;
				ctx.lineWidth = strokeW;
				ctx.strokeText( opts.content || '', ax, cy );

			}

			ctx.fillStyle = opts.fontColor || '#ffffff';
			ctx.fillText( opts.content || '', ax, cy );

			const cLat = ( opts.points && opts.points[ 0 ] ) ? opts.points[ 0 ][ 1 ] : 0;
			const metersPerDegLon = 111320 * Math.cos( cLat * DEG2RAD );
			const metersPerDegLat = 111320;

			this._labelTiles.set( id, {
				halfWDeg: tw * mPerCanvasPx / metersPerDegLon / 2,
				halfHDeg: th * mPerCanvasPx / metersPerDegLat / 2,
				u0: tx / LABEL_ATLAS_SIZE, v0: ty / LABEL_ATLAS_SIZE,
				u1: ( tx + tw ) / LABEL_ATLAS_SIZE, v1: ( ty + th ) / LABEL_ATLAS_SIZE,
			} );

			cursorX += tw;
			if ( th > rowH ) rowH = th;

		}

		if ( this._labelAtlasTex ) this._labelAtlasTex.needsUpdate = true;

	}

}
