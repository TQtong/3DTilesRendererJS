import { GlobeControls, TilesRenderer } from '3d-tiles-renderer';
import { CesiumIonAuthPlugin, QuantizedMeshPlugin, GLTFExtensionsPlugin, ImageOverlayPlugin, CesiumIonOverlay } from '3d-tiles-renderer/plugins';
import {
	Scene,
	WebGLRenderer,
	PerspectiveCamera,
	DataTexture,
	EquirectangularReflectionMapping,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GroundDecalManager } from './GroundDecalManager.js';

let camera, controls, scene, renderer, tiles, imageryOverlay;
let decals;
let pointId, polylineId, polygonId, rectId, sectorId, circleId, labelId, arrowPlotId;

const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1MDA4MTA3YS1mZDNmLTQyYzMtYjg3Ny1jN2EzNWNkNzBhNzYiLCJpZCI6MTE0MDgzLCJpYXQiOjE3NzA0NTY5NjZ9.ky7zHUKW9YVxb1LB6jW0PLdv0I9pPIFDdytlLcPUb-Y';

const params = {
	ionAssetId: '1',
	ionAccessToken: apiKey,
	reload: reinstantiateTiles,
};

// ── Style parameters matching store plot types ──

const S = {
	globalOpacity: 1.0,

	// Point
	pointStyle: 'circle',
	pointSize: 2000,
	pointFill: '#3B82F6',
	pointFillOpacity: 80,
	pointStroke: '#1D4ED8',
	pointStrokeWidth: 2,
	pointStrokeOpacity: 100,
	pointVisible: true,

	// Line (polyline)
	lineStroke: '#ff00ff',
	lineStrokeWidth: 8,
	lineStrokeOpacity: 90,
	lineStartArrow: 'none',
	lineEndArrow: 'filled',
	lineArrowSize: 20,
	lineVisible: true,

	// Polygon
	polyFill: '#3B82F6',
	polyFillOpacity: 40,
	polyStroke: '#1D4ED8',
	polyStrokeWidth: 4,
	polyStrokeOpacity: 100,
	polyVisible: true,

	// Rectangle
	rectFill: '#22c55e',
	rectFillOpacity: 60,
	rectStroke: '#15803d',
	rectStrokeWidth: 2,
	rectStrokeOpacity: 100,
	rectVisible: true,

	// Sector
	sectorFill: '#f59e0b',
	sectorFillOpacity: 50,
	sectorStroke: '#b45309',
	sectorStrokeWidth: 3,
	sectorStrokeOpacity: 100,
	sectorRadius: 8000,
	sectorStartAngle: 0,
	sectorAngle: 90,
	sectorVisible: true,

	// Circle
	circleFill: '#ef4444',
	circleFillOpacity: 50,
	circleStroke: '#ffff00',
	circleStrokeWidth: 6,
	circleStrokeOpacity: 100,
	circleVisible: true,

	// Arrow Plot
	arrowType: 'fine',
	arrowFill: '#3B82F6',
	arrowFillOpacity: 60,
	arrowStroke: '#1D4ED8',
	arrowStrokeWidth: 2,
	arrowStrokeOpacity: 100,
	arrowHeadSize: 16,
	arrowVisible: true,

	// Label
	labelText: '思茅区',
	labelFill: '#ffffff',
	labelStroke: '#000000',
	labelStrokeWidth: 5,
	labelFontSize: 64,
	labelVisible: true,
};

init();
animate();

// ────────────────────── tiles ──────────────────────

function setupTiles() {

	tiles.fetchOptions.mode = 'cors';
	tiles.registerPlugin( new GLTFExtensionsPlugin( {
		dracoLoader: new DRACOLoader().setDecoderPath( 'https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/' )
	} ) );

	scene.add( tiles.group );

}

function reinstantiateTiles() {

	if ( tiles ) {

		scene.remove( tiles.group );
		tiles.dispose();
		tiles = null;

	}

	localStorage.setItem( 'ionApiKey', params.ionAccessToken );

	tiles = new TilesRenderer();

	tiles.registerPlugin( new CesiumIonAuthPlugin( {
		apiToken: params.ionAccessToken,
		assetId: params.ionAssetId,
		autoRefreshToken: true,
		assetTypeHandler: ( type, tiles ) => {

			if ( type === 'TERRAIN' && tiles.getPluginByName( 'QUANTIZED_MESH_PLUGIN' ) === null ) {

				tiles.registerPlugin( new QuantizedMeshPlugin( {
					useRecommendedSettings: true,
				} ) );

			}

		}
	} ) );

	tiles.registerPlugin( new ImageOverlayPlugin( {
		renderer,
		overlays: [],
	} ) );

	imageryOverlay = new CesiumIonOverlay( {
		assetId: '3813',
		apiToken: params.ionAccessToken,
		opacity: 1.0,
		color: '#ffffff',
	} );

	tiles.group.rotation.x = - Math.PI / 2;

	setupTiles();

	if ( controls && controls.setEllipsoid ) {

		controls.setEllipsoid( tiles.ellipsoid, tiles.group );

	}

	if ( decals ) {

		decals.setEllipsoid( tiles.ellipsoid, tiles.group );

	}

}

// ────────────────────── style apply helpers ──────────────────────

function applyPoint() {

	decals.setStyle( pointId, {
		fill: S.pointFill,
		fillOpacity: S.pointFillOpacity,
		stroke: S.pointStroke,
		strokeWidth: S.pointStrokeWidth,
		strokeOpacity: S.pointStrokeOpacity,
		pointStyle: S.pointStyle,
		visible: S.pointVisible,
	} );
	decals.setSize( pointId, S.pointSize );

}

function applyLine() {

	decals.setStyle( polylineId, {
		stroke: S.lineStroke,
		strokeWidth: S.lineStrokeWidth,
		strokeOpacity: S.lineStrokeOpacity,
		startArrowStyle: S.lineStartArrow === 'none' ? null : S.lineStartArrow,
		endArrowStyle: S.lineEndArrow === 'none' ? null : S.lineEndArrow,
		arrowSize: S.lineArrowSize,
		visible: S.lineVisible,
	} );

}

function applyPoly() {

	decals.setStyle( polygonId, {
		fill: S.polyFill,
		fillOpacity: S.polyFillOpacity,
		stroke: S.polyStroke,
		strokeWidth: S.polyStrokeWidth,
		strokeOpacity: S.polyStrokeOpacity,
		visible: S.polyVisible,
	} );

}

function applyRect() {

	decals.setStyle( rectId, {
		fill: S.rectFill,
		fillOpacity: S.rectFillOpacity,
		stroke: S.rectStroke,
		strokeWidth: S.rectStrokeWidth,
		strokeOpacity: S.rectStrokeOpacity,
		visible: S.rectVisible,
	} );

}

function applySector() {

	decals.setStyle( sectorId, {
		fill: S.sectorFill,
		fillOpacity: S.sectorFillOpacity,
		stroke: S.sectorStroke,
		strokeWidth: S.sectorStrokeWidth,
		strokeOpacity: S.sectorStrokeOpacity,
		visible: S.sectorVisible,
	} );
	decals.setSize( sectorId, {
		radius: S.sectorRadius,
		startAngle: S.sectorStartAngle,
		sectorAngle: S.sectorAngle,
	} );

}

function applyCircle() {

	decals.setStyle( circleId, {
		fill: S.circleFill,
		fillOpacity: S.circleFillOpacity,
		stroke: S.circleStroke,
		strokeWidth: S.circleStrokeWidth,
		strokeOpacity: S.circleStrokeOpacity,
		visible: S.circleVisible,
	} );

}

function applyLabel() {

	decals.setText( labelId, S.labelText );
	decals.setStyle( labelId, {
		fill: S.labelFill,
		stroke: S.labelStroke,
		strokeWidth: S.labelStrokeWidth,
		font: S.labelFontSize + 'px sans-serif',
		visible: S.labelVisible,
	} );

}

function applyArrow() {

	decals.setStyle( arrowPlotId, {
		fill: S.arrowFill,
		fillOpacity: S.arrowFillOpacity,
		stroke: S.arrowStroke,
		strokeWidth: S.arrowStrokeWidth,
		strokeOpacity: S.arrowStrokeOpacity,
		arrowType: S.arrowType,
		headSize: S.arrowHeadSize,
		visible: S.arrowVisible,
	} );

}

// ────────────────────── GUI builder helpers ──────────────────────

function addFillControls( folder, prefix, apply ) {

	folder.addColor( S, prefix + 'Fill' ).name( 'Fill' ).onChange( apply );
	folder.add( S, prefix + 'FillOpacity', 0, 100, 1 ).name( 'Fill Opacity' ).onChange( apply );

}

function addStrokeControls( folder, prefix, apply, maxW = 20 ) {

	folder.addColor( S, prefix + 'Stroke' ).name( 'Stroke' ).onChange( apply );
	folder.add( S, prefix + 'StrokeWidth', 0, maxW, 1 ).name( 'Stroke Width' ).onChange( apply );
	folder.add( S, prefix + 'StrokeOpacity', 0, 100, 1 ).name( 'Stroke Opacity' ).onChange( apply );

}

function addVisibleToggle( folder, prefix, apply ) {

	folder.add( S, prefix + 'Visible' ).name( 'Visible' ).onChange( apply );

}

// ────────────────────── init / resize / animate ──────────────────────

function init() {

	scene = new Scene();

	const env = new DataTexture( new Uint8Array( 64 * 64 * 4 ).fill( 255 ), 64, 64 );
	env.mapping = EquirectangularReflectionMapping;
	env.needsUpdate = true;
	scene.environment = env;

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setClearColor( 0x151c1f );

	document.body.appendChild( renderer.domElement );
	renderer.domElement.tabIndex = 1;

	camera = new PerspectiveCamera(
		60,
		window.innerWidth / window.innerHeight,
		1,
		160000000
	);
	camera.position.set( 2620409, 0, - 6249816 );
	camera.lookAt( 0, 0, 0 );

	controls = new GlobeControls( scene, camera, renderer.domElement );
	controls.enableDamping = true;

	// ── Create decals ──
	decals = new GroundDecalManager( renderer );

	pointId = decals.addPoint(
		{ lon: 100.75, lat: 22.75 },
		S.pointSize,
		{ fill: S.pointFill, fillOpacity: S.pointFillOpacity, stroke: S.pointStroke, strokeWidth: S.pointStrokeWidth, strokeOpacity: S.pointStrokeOpacity, pointStyle: S.pointStyle }
	);

	polylineId = decals.addPolyline(
		[[ 100.50, 22.85 ], [ 100.60, 22.90 ], [ 100.70, 22.87 ], [ 100.80, 22.92 ], [ 100.90, 22.88 ]],
		{ stroke: S.lineStroke, strokeWidth: S.lineStrokeWidth, strokeOpacity: S.lineStrokeOpacity, startArrowStyle: null, endArrowStyle: 'filled', arrowSize: S.lineArrowSize }
	);

	polygonId = decals.addPolygon(
		[[ 100.60, 22.60 ], [ 100.70, 22.55 ], [ 100.75, 22.65 ], [ 100.68, 22.70 ], [ 100.58, 22.67 ]],
		{ fill: S.polyFill, fillOpacity: S.polyFillOpacity, stroke: S.polyStroke, strokeWidth: S.polyStrokeWidth, strokeOpacity: S.polyStrokeOpacity }
	);

	rectId = decals.addRect(
		{ lon: 100.848518, lat: 22.732947 },
		{ w: 20000, h: 20000 },
		{ fill: S.rectFill, fillOpacity: S.rectFillOpacity, stroke: S.rectStroke, strokeWidth: S.rectStrokeWidth, strokeOpacity: S.rectStrokeOpacity }
	);

	sectorId = decals.addSector(
		{ lon: 100.85, lat: 22.65 },
		S.sectorRadius, S.sectorStartAngle, S.sectorAngle,
		{ fill: S.sectorFill, fillOpacity: S.sectorFillOpacity, stroke: S.sectorStroke, strokeWidth: S.sectorStrokeWidth, strokeOpacity: S.sectorStrokeOpacity }
	);

	circleId = decals.addCircle(
		{ lon: 100.95, lat: 22.80 },
		8000,
		{ fill: S.circleFill, fillOpacity: S.circleFillOpacity, stroke: S.circleStroke, strokeWidth: S.circleStrokeWidth, strokeOpacity: S.circleStrokeOpacity }
	);

	labelId = decals.addLabel(
		{ lon: 100.848518, lat: 22.732947 },
		S.labelText,
		{ font: S.labelFontSize + 'px sans-serif', fill: S.labelFill, stroke: S.labelStroke, strokeWidth: S.labelStrokeWidth }
	);

	arrowPlotId = decals.addArrowPlot(
		[[ 100.50, 22.70 ], [ 100.60, 22.78 ], [ 100.75, 22.60 ]],
		{ fill: S.arrowFill, fillOpacity: S.arrowFillOpacity, stroke: S.arrowStroke, strokeWidth: S.arrowStrokeWidth, strokeOpacity: S.arrowStrokeOpacity, arrowType: S.arrowType, headSize: S.arrowHeadSize }
	);

	reinstantiateTiles();

	onWindowResize();
	window.addEventListener( 'resize', onWindowResize, false );

	// ── GUI ──
	const gui = new GUI();
	gui.width = 300;

	const ionFolder = gui.addFolder( 'Ion' );
	ionFolder.add( params, 'ionAssetId' );
	ionFolder.add( params, 'ionAccessToken' );
	ionFolder.add( params, 'reload' );

	const globalFolder = gui.addFolder( 'Global' );
	globalFolder.add( S, 'globalOpacity', 0, 1, 0.05 ).name( 'Opacity' ).onChange( v => decals.setGlobalOpacity( v ) );

	// Point
	const ptF = gui.addFolder( 'Point' );
	ptF.add( S, 'pointStyle', [ 'circle', 'square' ] ).name( 'Style' ).onChange( applyPoint );
	ptF.add( S, 'pointSize', 100, 10000, 100 ).name( 'Size (m)' ).onChange( applyPoint );
	addFillControls( ptF, 'point', applyPoint );
	addStrokeControls( ptF, 'point', applyPoint );
	addVisibleToggle( ptF, 'point', applyPoint );

	// Line
	const arrowOpts = [ 'none', 'filled', 'open', 'filledDiamond', 'openDiamond', 'filledCircle', 'openCircle', 'bar' ];
	const lnF = gui.addFolder( 'Line' );
	addStrokeControls( lnF, 'line', applyLine, 30 );
	lnF.add( S, 'lineStartArrow', arrowOpts ).name( 'Start Arrow' ).onChange( applyLine );
	lnF.add( S, 'lineEndArrow', arrowOpts ).name( 'End Arrow' ).onChange( applyLine );
	lnF.add( S, 'lineArrowSize', 5, 60, 1 ).name( 'Arrow Size' ).onChange( applyLine );
	addVisibleToggle( lnF, 'line', applyLine );

	// Polygon
	const pgF = gui.addFolder( 'Polygon' );
	addFillControls( pgF, 'poly', applyPoly );
	addStrokeControls( pgF, 'poly', applyPoly );
	addVisibleToggle( pgF, 'poly', applyPoly );

	// Rectangle
	const rcF = gui.addFolder( 'Rectangle' );
	addFillControls( rcF, 'rect', applyRect );
	addStrokeControls( rcF, 'rect', applyRect );
	addVisibleToggle( rcF, 'rect', applyRect );

	// Sector
	const scF = gui.addFolder( 'Sector' );
	addFillControls( scF, 'sector', applySector );
	addStrokeControls( scF, 'sector', applySector );
	scF.add( S, 'sectorRadius', 500, 30000, 500 ).name( 'Radius (m)' ).onChange( applySector );
	scF.add( S, 'sectorStartAngle', 0, 360, 1 ).name( 'Start Angle' ).onChange( applySector );
	scF.add( S, 'sectorAngle', 1, 360, 1 ).name( 'Sector Angle' ).onChange( applySector );
	addVisibleToggle( scF, 'sector', applySector );

	// Circle
	const ciF = gui.addFolder( 'Circle' );
	addFillControls( ciF, 'circle', applyCircle );
	addStrokeControls( ciF, 'circle', applyCircle );
	addVisibleToggle( ciF, 'circle', applyCircle );

	// Label
	const laF = gui.addFolder( 'Label' );
	laF.add( S, 'labelText' ).name( 'Text' ).onFinishChange( applyLabel );
	laF.addColor( S, 'labelFill' ).name( 'Color' ).onChange( applyLabel );
	laF.addColor( S, 'labelStroke' ).name( 'Outline' ).onChange( applyLabel );
	laF.add( S, 'labelStrokeWidth', 0, 15, 1 ).name( 'Outline Width' ).onChange( applyLabel );
	laF.add( S, 'labelFontSize', 16, 128, 4 ).name( 'Font Size' ).onChange( applyLabel );
	addVisibleToggle( laF, 'label', applyLabel );

	// Arrow Plot
	const arF = gui.addFolder( 'Arrow Plot' );
	arF.add( S, 'arrowType', [ 'fine', 'curved', 'attack', 'straight' ] ).name( 'Type' ).onChange( applyArrow );
	addFillControls( arF, 'arrow', applyArrow );
	addStrokeControls( arF, 'arrow', applyArrow );
	arF.add( S, 'arrowHeadSize', 1, 50, 1 ).name( 'Head Size' ).onChange( applyArrow );
	addVisibleToggle( arF, 'arrow', applyArrow );

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

	if ( decals ) decals.resize( window.innerWidth, window.innerHeight );

}

function animate() {

	requestAnimationFrame( animate );

	if ( ! tiles ) return;

	controls.update();

	tiles.setCamera( camera );
	tiles.setResolutionFromRenderer( camera, renderer );

	camera.updateMatrixWorld();
	tiles.update();

	if ( imageryOverlay ) {

		imageryOverlay.opacity = 1.0;

	}

	decals.render( scene, camera, tiles.group );

}
