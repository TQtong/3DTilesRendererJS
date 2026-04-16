import {
	Color,
	DataTexture,
	WebGLRenderTarget,
	ShaderMaterial,
	PlaneGeometry,
	Mesh,
	Scene,
	OrthographicCamera,
	CanvasTexture,
	LinearFilter,
	GLSL3,
	Vector4,
} from 'three';

import { RegionImageSource } from '../RegionImageSource.js';
import { ProjectionScheme } from '../../utils/ProjectionScheme.js';
import { TILE_SDF_VERTEX, TILE_SDF_FRAGMENT } from './TileSdfShader.js';
import { buildShapeData, boundsIntersect } from './buildShapeData.js';
import { buildTextAtlas, getPlotShapeBounds } from './TextBoxLayout.js';

const _clearColor = new Color();
const RAD2DEG = 180 / Math.PI;
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
		return boundsIntersect( tileBounds, this.contentBounds );

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
		this.forEachItem( ( texture, args ) => {

			this._rerenderItem( texture, args );

		} );

	}

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

	_initGPU() {

		if ( ! this._renderer ) return;

		this._sdfMaterial = new ShaderMaterial( {
			glslVersion: GLSL3,
			uniforms: {
				uTileBounds: { value: new Vector4() },
				uResolution: { value: this.resolution },
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

	_buildShapeDataForTile( tileBounds ) {

		return buildShapeData( this.shapes, tileBounds, {
			screenSpace: false,
			resolution: this.resolution,
			getShapeBounds: shape => getPlotShapeBounds( shape, this._labelTiles ),
			labelTiles: this._labelTiles,
		} );

	}

	_buildLabelAtlas() {

		this._labelTiles = buildTextAtlas( this._labelCanvas, this.shapes, {
			atlasSize: LABEL_ATLAS_SIZE,
			metersPerPixel: 10,
			renderScale: 1,
		} );
		this._labelAtlasTex.needsUpdate = true;

	}

	_updateBounds() {

		this._buildLabelAtlas();

		let minLon = Infinity;
		let minLat = Infinity;
		let maxLon = - Infinity;
		let maxLat = - Infinity;
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

	}

	_getShapeBounds( shape ) {

		return getPlotShapeBounds( shape, this._labelTiles );

	}

}
