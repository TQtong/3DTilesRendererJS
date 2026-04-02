/**
 * touchGround.js — GroundDecalManager 测试/演示页面
 *
 * RTT 方案：标绘图形通过 PlotOverlay 渲染到瓦片纹理上，
 * 不需要 decals.render()，ImageOverlayPlugin 自动处理渲染。
 */
import { GlobeControls, TilesRenderer } from 'um-3d-tiles-renderer';
import { CesiumIonAuthPlugin, QuantizedMeshPlugin, GLTFExtensionsPlugin, ImageOverlayPlugin, CesiumIonOverlay } from 'um-3d-tiles-renderer/plugins';
import {
	Scene,
	WebGLRenderer,
	PerspectiveCamera,
	DataTexture,
	EquirectangularReflectionMapping,
	Raycaster,
	Vector2,
	Vector3,
	MathUtils,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { GroundDecalManager } from './GroundDecalManager.js';

let camera, controls, scene, renderer, tiles, imageryOverlay;
let decals;

const raycaster = new Raycaster();
const mouse = new Vector2();
const _hitPoint = new Vector3();

const shapeIds = {
	pointId: null,
	lineId: null,
	polygonId: null,
	rectId: null,
	sectorId: null,
	circleId: null,
	textId: null,
	arrowId: null,
};

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

	if ( shapeIds.pointId == null ) return;
	decals.setStyle( shapeIds.pointId, {
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

	if ( shapeIds.lineId == null ) return;
	decals.setStyle( shapeIds.lineId, {
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

	if ( shapeIds.polygonId == null ) return;
	decals.setStyle( shapeIds.polygonId, {
		fillColor: S.polyFillColor,
		fillOpacity: S.polyFillOpacity,
		strokeColor: S.polyStrokeColor,
		strokeWidth: S.polyStrokeWidth,
		strokeOpacity: S.polyStrokeOpacity,
		visible: S.polyVisible,
	} );

}

function applyRect() {

	if ( shapeIds.rectId == null ) return;
	decals.setStyle( shapeIds.rectId, {
		fillColor: S.rectFillColor,
		fillOpacity: S.rectFillOpacity,
		strokeColor: S.rectStrokeColor,
		strokeWidth: S.rectStrokeWidth,
		strokeOpacity: S.rectStrokeOpacity,
		visible: S.rectVisible,
	} );

}

function applySector() {

	if ( shapeIds.sectorId == null ) return;
	decals.setStyle( shapeIds.sectorId, {
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

	if ( shapeIds.circleId == null ) return;
	decals.setStyle( shapeIds.circleId, {
		fillColor: S.circleFillColor,
		fillOpacity: S.circleFillOpacity,
		strokeColor: S.circleStrokeColor,
		strokeWidth: S.circleStrokeWidth,
		strokeOpacity: S.circleStrokeOpacity,
		visible: S.circleVisible,
	} );

}

function applyText() {

	if ( shapeIds.textId == null ) return;
	decals.setStyle( shapeIds.textId, {
		content: S.textContent,
		fontColor: S.textFontColor,
		fontSize: S.textFontSize,
		strokeColor: S.textStrokeColor,
		strokeWidth: S.textStrokeWidth,
		visible: S.textVisible,
	} );

}

function applyArrow() {

	if ( shapeIds.arrowId == null ) return;
	decals.setStyle( shapeIds.arrowId, {
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

// ────────────────────── shape factory helpers ──────────────────────

function addDemoPoint() {

	return decals.addPoint( {
		points: [[ 120, 30 ]],
		size: S.pointSize, pointStyle: S.pointStyle,
		fillColor: S.pointFillColor, fillOpacity: S.pointFillOpacity,
		strokeColor: S.pointStrokeColor, strokeWidth: S.pointStrokeWidth, strokeOpacity: S.pointStrokeOpacity,
		visible: S.pointVisible,
	} );

}

function addDemoLine() {

	return decals.addLine( {
		points: [[ 100.50, 22.85 ], [ 100.60, 22.90 ], [ 100.70, 22.87 ], [ 100.80, 22.92 ], [ 100.90, 22.88 ]],
		strokeColor: S.lineStrokeColor, strokeWidth: S.lineStrokeWidth, strokeOpacity: S.lineStrokeOpacity,
		startArrowStyle: null, endArrowStyle: 'filled', arrowSize: S.lineArrowSize,
		visible: S.lineVisible,
	} );

}

function addDemoPolygon() {

	return decals.addPolygon( {
		points: [[ 100.60, 22.60 ], [ 100.70, 22.55 ], [ 100.75, 22.65 ], [ 100.68, 22.70 ], [ 100.58, 22.67 ]],
		fillColor: S.polyFillColor, fillOpacity: S.polyFillOpacity,
		strokeColor: S.polyStrokeColor, strokeWidth: S.polyStrokeWidth, strokeOpacity: S.polyStrokeOpacity,
		visible: S.polyVisible,
	} );

}

function addDemoRectangle() {

	return decals.addRectangle( {
		points: [[ 100.848518, 22.732947 ]],
		width: 20000, height: 20000,
		fillColor: S.rectFillColor, fillOpacity: S.rectFillOpacity,
		strokeColor: S.rectStrokeColor, strokeWidth: S.rectStrokeWidth, strokeOpacity: S.rectStrokeOpacity,
		visible: S.rectVisible,
	} );

}

function addDemoSector() {

	return decals.addSector( {
		points: [[ 100.85, 22.65 ]],
		radius: S.sectorRadius, startAngle: S.sectorStartAngle, sectorAngle: S.sectorAngle,
		fillColor: S.sectorFillColor, fillOpacity: S.sectorFillOpacity,
		strokeColor: S.sectorStrokeColor, strokeWidth: S.sectorStrokeWidth, strokeOpacity: S.sectorStrokeOpacity,
		visible: S.sectorVisible,
	} );

}

function addDemoCircle() {

	return decals.addCircle( {
		points: [[ 100.95, 22.80 ]],
		radius: 8000,
		fillColor: S.circleFillColor, fillOpacity: S.circleFillOpacity,
		strokeColor: S.circleStrokeColor, strokeWidth: S.circleStrokeWidth, strokeOpacity: S.circleStrokeOpacity,
		visible: S.circleVisible,
	} );

}

function addDemoText() {

	return decals.addText( {
		points: [[ 100.848518, 22.732947 ]],
		content: S.textContent, fontColor: S.textFontColor, fontSize: S.textFontSize,
		strokeColor: S.textStrokeColor, strokeWidth: S.textStrokeWidth,
		visible: S.textVisible,
	} );

}

function addDemoArrow() {

	return decals.addArrow( {
		points: [[ 100.50, 22.70 ], [ 100.60, 22.78 ], [ 100.75, 22.60 ]],
		arrowType: S.arrowType, headSize: S.arrowHeadSize,
		fillColor: S.arrowFillColor, fillOpacity: S.arrowFillOpacity,
		strokeColor: S.arrowStrokeColor, strokeWidth: S.arrowStrokeWidth, strokeOpacity: S.arrowStrokeOpacity,
		visible: S.arrowVisible,
	} );

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

	shapeIds.pointId = addDemoPoint();
	shapeIds.lineId = addDemoLine();
	shapeIds.polygonId = addDemoPolygon();
	shapeIds.rectId = addDemoRectangle();
	shapeIds.sectorId = addDemoSector();
	shapeIds.circleId = addDemoCircle();
	shapeIds.textId = addDemoText();
	shapeIds.arrowId = addDemoArrow();

	reinstantiateTiles();

	onWindowResize();
	window.addEventListener( 'resize', onWindowResize, false );

	// ── 点击拾取经纬度 ──
	setupCoordPicker();

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

	// ── Delete / Re-add ──
	const deleteFolder = gui.addFolder( 'Delete & Re-add' );

	const shapeEntries = [
		{ label: 'Point', idKey: 'pointId', addFn: () => addDemoPoint(), folders: [ ptF ] },
		{ label: 'Line', idKey: 'lineId', addFn: () => addDemoLine(), folders: [ lnF ] },
		{ label: 'Polygon', idKey: 'polygonId', addFn: () => addDemoPolygon(), folders: [ pgF ] },
		{ label: 'Rectangle', idKey: 'rectId', addFn: () => addDemoRectangle(), folders: [ rcF ] },
		{ label: 'Sector', idKey: 'sectorId', addFn: () => addDemoSector(), folders: [ scF ] },
		{ label: 'Circle', idKey: 'circleId', addFn: () => addDemoCircle(), folders: [ ciF ] },
		{ label: 'Text', idKey: 'textId', addFn: () => addDemoText(), folders: [ txF ] },
		{ label: 'Arrow', idKey: 'arrowId', addFn: () => addDemoArrow(), folders: [ arF ] },
	];

	for ( const entry of shapeEntries ) {

		const actions = { delete: null, add: null };

		actions.delete = () => {

			const id = shapeIds[ entry.idKey ];
			if ( id == null ) return;
			decals.remove( id );
			shapeIds[ entry.idKey ] = null;
			entry.folders.forEach( f => f.hide() );

		};

		actions.add = () => {

			if ( shapeIds[ entry.idKey ] != null ) return;
			shapeIds[ entry.idKey ] = entry.addFn();
			entry.folders.forEach( f => f.show() );

		};

		deleteFolder.add( actions, 'delete' ).name( 'Delete ' + entry.label );
		deleteFolder.add( actions, 'add' ).name( 'Re-add ' + entry.label );

	}

	deleteFolder.add( { clearAll: () => {

		decals.clear();
		for ( const key in shapeIds ) shapeIds[ key ] = null;
		shapeEntries.forEach( e => e.folders.forEach( f => f.hide() ) );

	} }, 'clearAll' ).name( 'Clear All' );

	deleteFolder.add( { reAddAll: () => {

		for ( const entry of shapeEntries ) {

			if ( shapeIds[ entry.idKey ] == null ) {

				shapeIds[ entry.idKey ] = entry.addFn();
				entry.folders.forEach( f => f.show() );

			}

		}

	} }, 'reAddAll' ).name( 'Re-add All' );

}

// ────────────────────── 点击拾取经纬度 ──────────────────────

function setupCoordPicker() {

	const tooltip = document.createElement( 'div' );
	Object.assign( tooltip.style, {
		position: 'fixed',
		padding: '6px 12px',
		background: 'rgba(0, 0, 0, 0.75)',
		color: '#fff',
		fontSize: '13px',
		fontFamily: 'monospace',
		borderRadius: '4px',
		pointerEvents: 'none',
		opacity: '0',
		transition: 'opacity 0.2s',
		zIndex: '9999',
		whiteSpace: 'nowrap',
	} );
	document.body.appendChild( tooltip );

	let fadeTimer = null;
	const startPos = new Vector2();
	const endPos = new Vector2();

	renderer.domElement.addEventListener( 'pointerdown', e => {

		startPos.set( e.clientX, e.clientY );

	} );

	renderer.domElement.addEventListener( 'pointerup', e => {

		endPos.set( e.clientX, e.clientY );
		if ( startPos.distanceTo( endPos ) > 3 ) return;

		if ( ! tiles ) return;

		const rect = renderer.domElement.getBoundingClientRect();
		mouse.x = ( ( e.clientX - rect.left ) / rect.width ) * 2 - 1;
		mouse.y = - ( ( e.clientY - rect.top ) / rect.height ) * 2 + 1;

		raycaster.setFromCamera( mouse, camera );
		raycaster.firstHitOnly = true;

		const hits = raycaster.intersectObject( tiles.group, true );
		if ( hits.length === 0 ) return;

		// 射线交点在世界坐标系中，需要逆变换回 ECEF 坐标系
		_hitPoint.copy( hits[ 0 ].point )
			.applyMatrix4( tiles.group.matrixWorld.clone().invert() );

		const cart = {};
		tiles.ellipsoid.getPositionToCartographic( _hitPoint, cart );

		const lat = ( cart.lat * MathUtils.RAD2DEG ).toFixed( 6 );
		const lon = ( cart.lon * MathUtils.RAD2DEG ).toFixed( 6 );

		tooltip.textContent = `Lat: ${ lat }°  Lon: ${ lon }°`;
		tooltip.style.left = ( e.clientX + 14 ) + 'px';
		tooltip.style.top = ( e.clientY - 30 ) + 'px';
		tooltip.style.opacity = '1';

		console.log( `Clicked: lat=${ lat }, lon=${ lon }` );

		if ( fadeTimer ) clearTimeout( fadeTimer );
		fadeTimer = setTimeout( () => {

			tooltip.style.opacity = '0';

		}, 3000 );

	} );

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
