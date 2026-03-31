/**
 * touchGround.js — GroundDecalManager 测试/演示页面
 *
 * RTT 方案：标绘图形通过 PlotOverlay 渲染到瓦片纹理上，
 * 不需要 decals.render()，ImageOverlayPlugin 自动处理渲染。
 */
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
import { GroundDecalManager } from './plot/index.js';

let camera, controls, scene, renderer, tiles, imageryOverlay;
let decals;
let pointId, lineId, polygonId, rectId, sectorId, circleId, textId, arrowId;

const apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI1MDA4MTA3YS1mZDNmLTQyYzMtYjg3Ny1jN2EzNWNkNzBhNzYiLCJpZCI6MTE0MDgzLCJpYXQiOjE3NzA0NTY5NjZ9.ky7zHUKW9YVxb1LB6jW0PLdv0I9pPIFDdytlLcPUb-Y';

const params = {
	ionAssetId: '1',
	ionAccessToken: apiKey,
	reload: reinstantiateTiles,
};

const S = {
	globalOpacity: 1.0,

	pointStyle: 'circle',
	pointSize: 2000,
	pointFillColor: '#3B82F6',
	pointFillOpacity: 80,
	pointStrokeColor: '#1D4ED8',
	pointStrokeWidth: 2,
	pointStrokeOpacity: 100,
	pointVisible: true,

	lineStrokeColor: '#ff00ff',
	lineStrokeWidth: 8,
	lineStrokeOpacity: 90,
	lineStartArrow: 'none',
	lineEndArrow: 'filled',
	lineArrowSize: 20,
	lineVisible: true,

	polyFillColor: '#3B82F6',
	polyFillOpacity: 40,
	polyStrokeColor: '#1D4ED8',
	polyStrokeWidth: 4,
	polyStrokeOpacity: 100,
	polyVisible: true,

	rectFillColor: '#22c55e',
	rectFillOpacity: 60,
	rectStrokeColor: '#15803d',
	rectStrokeWidth: 2,
	rectStrokeOpacity: 100,
	rectVisible: true,

	sectorFillColor: '#f59e0b',
	sectorFillOpacity: 50,
	sectorStrokeColor: '#b45309',
	sectorStrokeWidth: 3,
	sectorStrokeOpacity: 100,
	sectorRadius: 8000,
	sectorStartAngle: 0,
	sectorAngle: 90,
	sectorVisible: true,

	circleFillColor: '#ef4444',
	circleFillOpacity: 50,
	circleStrokeColor: '#ffff00',
	circleStrokeWidth: 6,
	circleStrokeOpacity: 100,
	circleVisible: true,

	arrowType: 'fine',
	arrowFillColor: '#3B82F6',
	arrowFillOpacity: 60,
	arrowStrokeColor: '#1D4ED8',
	arrowStrokeWidth: 2,
	arrowStrokeOpacity: 100,
	arrowHeadSize: 16,
	arrowVisible: true,

	textContent: '思茅区',
	textFontColor: '#ffffff',
	textFontSize: 64,
	textStrokeColor: '#000000',
	textStrokeWidth: 5,
	textVisible: true,
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

	imageryOverlay = new CesiumIonOverlay( {
		assetId: '3',
		apiToken: params.ionAccessToken,
		opacity: 1.0,
		color: '#ffffff',
	} );

	// 标绘 overlay 和底图 overlay 一起注册（标绘在底图之上）
	tiles.registerPlugin( new ImageOverlayPlugin( {
		renderer,
		overlays: [ imageryOverlay, decals.overlay ],
	} ) );

	tiles.group.rotation.x = - Math.PI / 2;

	setupTiles();

	if ( controls && controls.setEllipsoid ) {

		controls.setEllipsoid( tiles.ellipsoid, tiles.group );

	}

}

// ────────────────────── apply helpers ──────────────────────

function applyPoint() {

	decals.setStyle( pointId, {
		fillColor: S.pointFillColor,
		fillOpacity: S.pointFillOpacity,
		strokeColor: S.pointStrokeColor,
		strokeWidth: S.pointStrokeWidth,
		strokeOpacity: S.pointStrokeOpacity,
		pointStyle: S.pointStyle,
		size: S.pointSize,
		visible: S.pointVisible,
	} );

}

function applyLine() {

	decals.setStyle( lineId, {
		strokeColor: S.lineStrokeColor,
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
		fillColor: S.polyFillColor,
		fillOpacity: S.polyFillOpacity,
		strokeColor: S.polyStrokeColor,
		strokeWidth: S.polyStrokeWidth,
		strokeOpacity: S.polyStrokeOpacity,
		visible: S.polyVisible,
	} );

}

function applyRect() {

	decals.setStyle( rectId, {
		fillColor: S.rectFillColor,
		fillOpacity: S.rectFillOpacity,
		strokeColor: S.rectStrokeColor,
		strokeWidth: S.rectStrokeWidth,
		strokeOpacity: S.rectStrokeOpacity,
		visible: S.rectVisible,
	} );

}

function applySector() {

	decals.setStyle( sectorId, {
		fillColor: S.sectorFillColor,
		fillOpacity: S.sectorFillOpacity,
		strokeColor: S.sectorStrokeColor,
		strokeWidth: S.sectorStrokeWidth,
		strokeOpacity: S.sectorStrokeOpacity,
		radius: S.sectorRadius,
		startAngle: S.sectorStartAngle,
		sectorAngle: S.sectorAngle,
		visible: S.sectorVisible,
	} );

}

function applyCircle() {

	decals.setStyle( circleId, {
		fillColor: S.circleFillColor,
		fillOpacity: S.circleFillOpacity,
		strokeColor: S.circleStrokeColor,
		strokeWidth: S.circleStrokeWidth,
		strokeOpacity: S.circleStrokeOpacity,
		visible: S.circleVisible,
	} );

}

function applyText() {

	decals.setStyle( textId, {
		content: S.textContent,
		fontColor: S.textFontColor,
		fontSize: S.textFontSize,
		strokeColor: S.textStrokeColor,
		strokeWidth: S.textStrokeWidth,
		visible: S.textVisible,
	} );

}

function applyArrow() {

	decals.setStyle( arrowId, {
		fillColor: S.arrowFillColor,
		fillOpacity: S.arrowFillOpacity,
		strokeColor: S.arrowStrokeColor,
		strokeWidth: S.arrowStrokeWidth,
		strokeOpacity: S.arrowStrokeOpacity,
		arrowType: S.arrowType,
		headSize: S.arrowHeadSize,
		visible: S.arrowVisible,
	} );

}

// ────────────────────── GUI helpers ──────────────────────

function addFillControls( folder, prefix, apply ) {

	folder.addColor( S, prefix + 'FillColor' ).name( 'Fill' ).onChange( apply );
	folder.add( S, prefix + 'FillOpacity', 0, 100, 1 ).name( 'Fill Opacity' ).onChange( apply );

}

function addStrokeControls( folder, prefix, apply, maxW = 20 ) {

	folder.addColor( S, prefix + 'StrokeColor' ).name( 'Stroke' ).onChange( apply );
	folder.add( S, prefix + 'StrokeWidth', 0, maxW, 1 ).name( 'Stroke Width' ).onChange( apply );
	folder.add( S, prefix + 'StrokeOpacity', 0, 100, 1 ).name( 'Stroke Opacity' ).onChange( apply );

}

function addVisibleToggle( folder, prefix, apply ) {

	folder.add( S, prefix + 'Visible' ).name( 'Visible' ).onChange( apply );

}

// ────────────────────── init ──────────────────────

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

	camera = new PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 160000000 );
	camera.position.set( 2620409, 0, - 6249816 );
	camera.lookAt( 0, 0, 0 );

	controls = new GlobeControls( scene, camera, renderer.domElement );
	controls.enableDamping = true;

	// ── 创建标绘 ──
	decals = new GroundDecalManager( { renderer } );

	pointId = decals.addPoint( {
		points: [[ 120, 30 ]],
		size: S.pointSize,
		pointStyle: S.pointStyle,
		fillColor: S.pointFillColor,
		fillOpacity: S.pointFillOpacity,
		strokeColor: S.pointStrokeColor,
		strokeWidth: S.pointStrokeWidth,
		strokeOpacity: S.pointStrokeOpacity,
		visible: S.pointVisible,
	} );

	lineId = decals.addLine( {
		points: [[ 100.50, 22.85 ], [ 100.60, 22.90 ], [ 100.70, 22.87 ], [ 100.80, 22.92 ], [ 100.90, 22.88 ]],
		strokeColor: S.lineStrokeColor, strokeWidth: S.lineStrokeWidth, strokeOpacity: S.lineStrokeOpacity,
		startArrowStyle: null, endArrowStyle: 'filled', arrowSize: S.lineArrowSize,
		visible: S.lineVisible,
	} );

	polygonId = decals.addPolygon( {
		points: [[ 100.60, 22.60 ], [ 100.70, 22.55 ], [ 100.75, 22.65 ], [ 100.68, 22.70 ], [ 100.58, 22.67 ]],
		fillColor: S.polyFillColor, fillOpacity: S.polyFillOpacity,
		strokeColor: S.polyStrokeColor, strokeWidth: S.polyStrokeWidth, strokeOpacity: S.polyStrokeOpacity,
		visible: S.polyVisible,
	} );

	rectId = decals.addRectangle( {
		points: [[ 100.848518, 22.732947 ]],
		width: 20000, height: 20000,
		fillColor: S.rectFillColor, fillOpacity: S.rectFillOpacity,
		strokeColor: S.rectStrokeColor, strokeWidth: S.rectStrokeWidth, strokeOpacity: S.rectStrokeOpacity,
		visible: S.rectVisible,
	} );

	sectorId = decals.addSector( {
		points: [[ 100.85, 22.65 ]],
		radius: S.sectorRadius, startAngle: S.sectorStartAngle, sectorAngle: S.sectorAngle,
		fillColor: S.sectorFillColor, fillOpacity: S.sectorFillOpacity,
		strokeColor: S.sectorStrokeColor, strokeWidth: S.sectorStrokeWidth, strokeOpacity: S.sectorStrokeOpacity,
		visible: S.sectorVisible,
	} );

	circleId = decals.addCircle( {
		points: [[ 100.95, 22.80 ]],
		radius: 8000,
		fillColor: S.circleFillColor, fillOpacity: S.circleFillOpacity,
		strokeColor: S.circleStrokeColor, strokeWidth: S.circleStrokeWidth, strokeOpacity: S.circleStrokeOpacity,
		visible: S.circleVisible,
	} );

	textId = decals.addText( {
		points: [[ 100.848518, 22.732947 ]],
		content: S.textContent, fontColor: S.textFontColor, fontSize: S.textFontSize,
		strokeColor: S.textStrokeColor, strokeWidth: S.textStrokeWidth,
		visible: S.textVisible,
	} );

	arrowId = decals.addArrow( {
		points: [[ 100.50, 22.70 ], [ 100.60, 22.78 ], [ 100.75, 22.60 ]],
		arrowType: S.arrowType, headSize: S.arrowHeadSize,
		fillColor: S.arrowFillColor, fillOpacity: S.arrowFillOpacity,
		strokeColor: S.arrowStrokeColor, strokeWidth: S.arrowStrokeWidth, strokeOpacity: S.arrowStrokeOpacity,
		visible: S.arrowVisible,
	} );

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

	const ptF = gui.addFolder( 'Point' );
	ptF.add( S, 'pointStyle', [ 'circle', 'square' ] ).name( 'Style' ).onChange( applyPoint );
	ptF.add( S, 'pointSize', 100, 10000, 100 ).name( 'Size (m)' ).onChange( applyPoint );
	addFillControls( ptF, 'point', applyPoint );
	addStrokeControls( ptF, 'point', applyPoint );
	addVisibleToggle( ptF, 'point', applyPoint );

	const arrowOpts = [ 'none', 'filled', 'open', 'filledDiamond', 'openDiamond', 'filledCircle', 'openCircle', 'bar' ];
	const lnF = gui.addFolder( 'Line' );
	addStrokeControls( lnF, 'line', applyLine, 30 );
	lnF.add( S, 'lineStartArrow', arrowOpts ).name( 'Start Arrow' ).onChange( applyLine );
	lnF.add( S, 'lineEndArrow', arrowOpts ).name( 'End Arrow' ).onChange( applyLine );
	lnF.add( S, 'lineArrowSize', 5, 60, 1 ).name( 'Arrow Size' ).onChange( applyLine );
	addVisibleToggle( lnF, 'line', applyLine );

	const pgF = gui.addFolder( 'Polygon' );
	addFillControls( pgF, 'poly', applyPoly );
	addStrokeControls( pgF, 'poly', applyPoly );
	addVisibleToggle( pgF, 'poly', applyPoly );

	const rcF = gui.addFolder( 'Rectangle' );
	addFillControls( rcF, 'rect', applyRect );
	addStrokeControls( rcF, 'rect', applyRect );
	addVisibleToggle( rcF, 'rect', applyRect );

	const scF = gui.addFolder( 'Sector' );
	addFillControls( scF, 'sector', applySector );
	addStrokeControls( scF, 'sector', applySector );
	scF.add( S, 'sectorRadius', 500, 30000, 500 ).name( 'Radius (m)' ).onChange( applySector );
	scF.add( S, 'sectorStartAngle', 0, 360, 1 ).name( 'Start Angle' ).onChange( applySector );
	scF.add( S, 'sectorAngle', 1, 360, 1 ).name( 'Sector Angle' ).onChange( applySector );
	addVisibleToggle( scF, 'sector', applySector );

	const ciF = gui.addFolder( 'Circle' );
	addFillControls( ciF, 'circle', applyCircle );
	addStrokeControls( ciF, 'circle', applyCircle );
	addVisibleToggle( ciF, 'circle', applyCircle );

	const txF = gui.addFolder( 'Text' );
	txF.add( S, 'textContent' ).name( 'Content' ).onFinishChange( applyText );
	txF.addColor( S, 'textFontColor' ).name( 'Font Color' ).onChange( applyText );
	txF.add( S, 'textFontSize', 16, 128, 4 ).name( 'Font Size' ).onChange( applyText );
	txF.addColor( S, 'textStrokeColor' ).name( 'Outline' ).onChange( applyText );
	txF.add( S, 'textStrokeWidth', 0, 15, 1 ).name( 'Outline Width' ).onChange( applyText );
	addVisibleToggle( txF, 'text', applyText );

	const arF = gui.addFolder( 'Arrow' );
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

}

function animate() {

	requestAnimationFrame( animate );

	if ( ! tiles ) return;

	controls.update();

	tiles.setCamera( camera );
	tiles.setResolutionFromRenderer( camera, renderer );

	camera.updateMatrixWorld();
	tiles.update();

	renderer.render( scene, camera );

}
