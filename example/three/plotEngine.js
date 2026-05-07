import {
	GlobeControls,
	TilesRenderer,
} from 'um-3d-tiles-renderer';
import { WGS84_ELLIPSOID } from 'um-3d-tiles-renderer/three';
import {
	CesiumIonAuthPlugin,
	CesiumIonOverlay,
	GLTFExtensionsPlugin,
	ImageOverlayPlugin,
	QuantizedMeshPlugin,
} from 'um-3d-tiles-renderer/plugins';
import { PlotEngine, PlotEditor } from 'um-plot-engine';
import {
	AmbientLight,
	AxesHelper,
	Box3,
	DirectionalLight,
	DoubleSide,
	GridHelper,
	Group,
	Matrix4,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Quaternion,
	Scene,
	Vector3,
	WebGLRenderer,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let camera, controls, renderer, scene;
let tiles, modelTiles, plotEngine, plotEditor, localTarget, localTargetVisuals;
let editorStatusController = null;
let editorUndoController = null;
let editorRedoController = null;

const worldShapeIds = [];
const localShapeIds = [];
const terrainShapeIds = [];
const modelShapeIds = [];
const TERRAIN_TARGET_ID = 'terrain';
const SOONSPACE_TARGET_ID = 'sooncps-model';
const SOONSPACE_TILESET_URL = 'https://sooncps.xwbuilders.com/api/ugis-dataprocess/v1/model/taz4Wo8Q5/tileset.json';
const DEFAULT_ION_ACCESS_TOKEN = localStorage.getItem( 'ionApiKey' ) || import.meta.env?.VITE_ION_KEY || '';
const DEFAULT_SHAPE_HEIGHT = 500;
const LOCAL_TARGET_BASE_HEIGHT = 50;
const METERS_PER_DEG_LAT = 110540;
const SOONSPACE_LON_DEG = 110.425983;
const SOONSPACE_LAT_DEG = 32.993182;
const SOONSPACE_LON = SOONSPACE_LON_DEG * MathUtils.DEG2RAD;
const SOONSPACE_LAT = SOONSPACE_LAT_DEG * MathUtils.DEG2RAD;
const DEFAULT_DEMO_PLOT_COUNT = 100;
const DEMO_PLOT_BATCH_SIZE = 5000;
const DEMO_PLOT_LON_STEP = 0.0012;
const DEMO_PLOT_LAT_STEP = 0.0012;
const DEMO_PLOT_SIZE = 0.00042;
const DEMO_PLOT_STROKE_WIDTH = 0.00006;
const LOCAL_EDITOR_HANDLE_SIZE = 0.6;
const LOCAL_SURFACE_BOARD_SPAN = 72;
const CONDITIONAL_TILE_UPDATE_FRAMES = 45;
const SOONSPACE_POLYGON_STYLE = {
	fillColor: '#22d3ee',
	strokeColor: '#ecfeff',
	strokeWidth: 0,
	opacity: 0.55,
};
const DEMO_WORLD_PLOT_TYPES = [
	'point',
	'line',
	'polyline',
	'polygon',
	'rectangle',
	'circle',
	'sector',
	'arrow',
];
const DEMO_TILE_PLOT_TYPES = [
	'point',
	'polygon',
	'rectangle',
	'circle',
	'sector',
	'arrow',
];
const DEMO_SURFACE_PLOT_TYPES = [
	'polygon',
	'rectangle',
	'circle',
	'sector',
	'arrow',
];
const DEMO_PLOT_COLORS = [
	'#22d3ee',
	'#f97316',
	'#a78bfa',
	'#84cc16',
	'#f43f5e',
	'#38bdf8',
	'#facc15',
	'#fb7185',
];
const _beijingFrame = new Matrix4();
const _globeSceneFrame = new Matrix4().makeRotationX( - Math.PI / 2 );
const _groupInverse = new Matrix4();
const _tileBoundsMatrix = new Matrix4();
const _framePosition = new Vector3();
const _frameScale = new Vector3();
const _frameForward = new Vector3();
const _frameUp = new Vector3();
const _frameRight = new Vector3();
const _tileBoundsPoint = new Vector3();
const _frameQuaternion = new Quaternion();
const _moveRight = new Vector3();
const _moveForward = new Vector3();
const _tilesBounds = new Box3();
const _loadedSceneBounds = new Box3();
const _tilesCenter = new Vector3();
const _tilesSize = new Vector3();
const _loadedSceneCenter = new Vector3();
const _loadedSceneSize = new Vector3();
const _tileCartographic = {};
const _cartographicPosition = new Vector3();
const noopRaycast = () => {};
const _lastConditionalUpdateCameraMatrix = new Matrix4();

let localTargetPlacementState = 'auto-fallback';
let demoGenerationHandle = null;
let demoGenerationToken = 0;
let demoGenerationProgress = null;
let conditionalUpdateCameraInitialized = false;
let terrainConditionalUpdateFrames = CONDITIONAL_TILE_UPDATE_FRAMES;
let modelConditionalUpdateFrames = CONDITIONAL_TILE_UPDATE_FRAMES;

const params = {
	ionAssetId: '1',
	ionImageryAssetId: '3',
	ionAccessToken: DEFAULT_ION_ACCESS_TOKEN,
	showLocalBoard: true,
	showTerrain: true,
	showSoonModel: true,
	terrainVisible: true,
	soonModelVisible: true,
	localOpacity: 0.75,
	worldHeight: 300,
	demoPlotCount: DEFAULT_DEMO_PLOT_COUNT,
	demoMode: 'single',
	targetMode: 'world',
	reloadTerrain: reinstantiateTiles,
	reloadSoonModel: reinstantiateModelTiles,
	focusLocalBoard: frameLocalTarget,
	focusTerrain: frameTerrain,
	focusSoonModel: frameSoonModel,
	resetShapes,
	randomizeLocal: randomizeLocalShapes,
	editorEndEdit: () => plotEditor?.endEdit(),
	editorCancelEdit: () => plotEditor?.cancelEdit(),
	editorDeselect: () => plotEditor?.deselect(),
	editorUndo: () => plotEditor?.undo(),
	editorRedo: () => plotEditor?.redo(),
	editorStatus: 'idle',
};

// 单 polygon 演示模式下，记录由 addSingleEditDemoShape 创建的 shape id，
// 便于"高度滑块"直接更新该 shape 而无需重新创建
let _singleDemoShapeId = null;

const _clickState = {
	startX: 0,
	startY: 0,
	startTime: 0,
	pointerId: null,
};
const CLICK_MAX_MOVE_PX = 6;
const CLICK_MAX_MS = 400;

init();
animate();

function getIonAccessToken() {

	const token = `${ params.ionAccessToken ?? '' }`.trim();
	return token && token !== 'put-your-api-key-here' ? token : '';

}

function init() {

	renderer = new WebGLRenderer( {
		antialias: true,
		logarithmicDepthBuffer: true,
	} );
	renderer.setClearColor( 0x151c1f );
	document.body.appendChild( renderer.domElement );

	scene = new Scene();

	camera = new PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 160000000 );
	camera.position.set( 1150000, 3920000, 4980000 );
	camera.rotation.set( 0.381, 0.202, - 0.090 );

	const ambientLight = new AmbientLight( 0xffffff, 0.35 );
	const dirLight = new DirectionalLight( 0xffffff, 3 );
	dirLight.position.set( 1, 1, 1 );
	camera.add( ambientLight, dirLight, dirLight.target );
	scene.add( camera );

	controls = new GlobeControls( scene, camera, renderer.domElement, null );
	controls.enableDamping = true;

	setupPlotEngine();
	setupLocalTarget();
	reinstantiateTiles();
	reinstantiateModelTiles();
	resetShapes();
	setupGui();

	onWindowResize();
	window.addEventListener( 'resize', onWindowResize, false );

}

function createDracoLoader() {

	return new DRACOLoader().setDecoderPath( 'https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/' );

}

function getReferenceTilesRenderer() {

	return tiles || modelTiles || null;

}

function syncControlsEllipsoid() {

	const referenceTiles = getReferenceTilesRenderer();
	if ( referenceTiles ) {

		controls.setEllipsoid( referenceTiles.ellipsoid, referenceTiles.group );

	} else {

		controls.setEllipsoid( null, null );

	}

}

function updateTerrainVisibility() {

	if ( tiles ) {

		tiles.group.visible = params.terrainVisible;
		requestConditionalTilesUpdates();

	}

}

function updateSoonModelVisibility() {

	if ( modelTiles ) {

		modelTiles.group.visible = params.soonModelVisible;
		requestConditionalTilesUpdates();

	}

}

function requestConditionalTilesUpdates( frames = CONDITIONAL_TILE_UPDATE_FRAMES ) {

	terrainConditionalUpdateFrames = Math.max( terrainConditionalUpdateFrames, frames );
	modelConditionalUpdateFrames = Math.max( modelConditionalUpdateFrames, frames );

}

function hasMatrixChanged( left, right, epsilon = 1e-8 ) {

	const leftElements = left.elements;
	const rightElements = right.elements;
	for ( let index = 0; index < 16; index ++ ) {

		if ( Math.abs( leftElements[ index ] - rightElements[ index ] ) > epsilon ) return true;

	}

	return false;

}

function shouldUpdateExternalTiles( visible, forcedFrames, cameraChanged ) {

	if ( ! visible ) return false;
	if ( params.targetMode !== 'world' ) return true;
	return forcedFrames > 0 || cameraChanged;

}

function setupPlotEngine() {

	plotEngine = new PlotEngine( {
		tiledPipe: {
			rasterize: false,
		},
	} );
	scene.add( plotEngine.group );
	plotEngine.setMode( params.targetMode );
	plotEngine.start();

	setupPlotEditor();

}

function setupPlotEditor() {

	if ( plotEditor ) plotEditor.dispose();

	plotEditor = new PlotEditor( {
		plotEngine,
		camera,
		renderer,
		// 默认手柄大小（局部坐标单位）。在不同 attach 模式下需要按尺度调整：
		//  - local board (尺度 ~80m)：~0.6
		//  - world (lon/lat 弧度尺度)：~0.00015
		// 这里给一个保守值，由调用方在 beginEdit 后通过 setSizeScale 覆盖
		handleSizeScale: 0.6,
	} );

	plotEditor.addEventListener( 'history-change', refreshEditorGui );
	plotEditor.addEventListener( 'edit-begin', refreshEditorGui );
	plotEditor.addEventListener( 'edit-end', refreshEditorGui );
	plotEditor.addEventListener( 'edit-cancel', refreshEditorGui );
	plotEditor.addEventListener( 'selection-change', refreshEditorGui );

	attachShapePickListener();

}

// ── 点击拾取：把"点击空白处的 shape"翻译为"进入该 shape 的编辑会话" ──
//
// 仅当点击是真正的"短按"（按下与抬起位置接近、间隔短）才视为 click，
// 否则视作 GlobeControls 自己的拖拽，不打扰相机操作。
function attachShapePickListener() {

	const dom = renderer.domElement;
	dom.addEventListener( 'pointerdown', onShapePickPointerDown );
	dom.addEventListener( 'pointerup', onShapePickPointerUp );

}

function onShapePickPointerDown( event ) {

	if ( event.button !== 0 ) return;
	_clickState.startX = event.clientX;
	_clickState.startY = event.clientY;
	_clickState.startTime = performance.now?.() ?? Date.now();
	_clickState.pointerId = event.pointerId;

}

function onShapePickPointerUp( event ) {

	if ( event.button !== 0 ) return;
	if ( _clickState.pointerId !== event.pointerId ) return;
	const dx = event.clientX - _clickState.startX;
	const dy = event.clientY - _clickState.startY;
	const dt = ( performance.now?.() ?? Date.now() ) - _clickState.startTime;
	_clickState.pointerId = null;

	if ( Math.abs( dx ) > CLICK_MAX_MOVE_PX || Math.abs( dy ) > CLICK_MAX_MOVE_PX ) return;
	if ( dt > CLICK_MAX_MS ) return;

	// 编辑期间：让 DragController 自己处理 handle 命中；这里只在"无 handle 命中"
	// 的情况下做 shape pick。最容易的判定是：plotEditor 的 isEditing 状态没变，
	// 但其实更可靠的方式是直接尝试 pick——如果 hit 落在另一个 shape 上，则切换。
	if ( ! plotEditor ) return;
	const shapeId = plotEditor.pickShapeAt( event.clientX, event.clientY );
	if ( shapeId == null ) return;
	if ( plotEditor.editingShapeId === shapeId ) return;

	plotEditor.beginEdit( shapeId );
	const shape = plotEngine.shapeStore.get( shapeId );
	if ( shape ) {

		// 不同 attachment 的坐标尺度差异巨大，按尺度选择手柄大小：
		//  - world (lon/lat 弧度)：~0.00015
		//  - surface 上 local-board / 米尺度：~0.6
		plotEditor._session?.handleLayer?.setSizeScale?.( getEditorHandleSizeScale( shape ) );

	}

	refreshEditorGui();

}

function getEditorHandleSizeScale( shape ) {

	void shape;
	return LOCAL_EDITOR_HANDLE_SIZE;

}

function refreshEditorGui() {

	if ( ! plotEditor ) return;
	const editing = plotEditor.editingShapeId;
	const selected = plotEditor.selectedShapeId;
	if ( editing != null ) {

		params.editorStatus = `editing #${ editing }`;

	} else if ( selected != null ) {

		params.editorStatus = `selected #${ selected }`;

	} else {

		params.editorStatus = 'idle';

	}

	editorStatusController?.updateDisplay?.();
	editorUndoController?.updateDisplay?.();
	editorRedoController?.updateDisplay?.();

}


function setupLocalTarget() {

	localTarget = new Group();
	localTarget.name = 'PlotEngine.LocalBoardTarget';
	localTarget.visible = true;
	localTargetVisuals = new Group();
	localTargetVisuals.name = 'PlotEngine.LocalBoardVisuals';
	localTargetVisuals.visible = params.showLocalBoard;

	const board = new Mesh(
		new PlaneGeometry( 80, 80 ),
		new MeshBasicMaterial( {
			color: 0x0f172a,
			transparent: true,
			opacity: 0.55,
			side: DoubleSide,
		} ),
	);
	board.name = 'PlotEngine.LocalBoard';
	board.rotation.x = - Math.PI / 2;
	board.raycast = noopRaycast;

	const grid = new GridHelper( 80, 16, 0x60a5fa, 0x334155 );
	grid.raycast = noopRaycast;

	const axes = new AxesHelper( 12 );
	axes.raycast = noopRaycast;
	localTargetVisuals.add( board, grid, axes );
	localTarget.add( localTargetVisuals );
	scene.add( localTarget );
	placeLocalTargetAtSoonModel();

	plotEngine.attachObjectTarget( 'local-board', localTarget, {
		geoReference: { kind: 'local' },
	} );
	syncWorldGroupToLocalTarget();

}

function updateLocalBoardVisibility( value ) {

	if ( localTargetVisuals ) localTargetVisuals.visible = value;

}

function applyFrameToObject( object, matrix ) {

	matrix.decompose( object.position, object.quaternion, object.scale );
	object.updateMatrixWorld( true );

}

function placeObjectAtCartographicLocation( object, lat, lon, height, referenceTiles = null ) {

	WGS84_ELLIPSOID.getObjectFrame( lat, lon, height, 0, 0, 0, _beijingFrame );
	if ( referenceTiles ) {

		referenceTiles.group.updateMatrixWorld( true );
		_beijingFrame.premultiply( referenceTiles.group.matrixWorld );

	} else {

		_beijingFrame.premultiply( _globeSceneFrame );

	}

	applyFrameToObject( object, _beijingFrame );

}

function getTilesRendererBounds( tilesRenderer, target, loadedOnly = false ) {

	if ( ! tilesRenderer ) return false;

	const visibleTileEntries = [];
	collectVisibleLoadedTileEntries( tilesRenderer, visibleTileEntries );
	if ( visibleTileEntries.length > 0 ) {

		target.makeEmpty();
		const selectedEntries = selectDenseTileEntries( visibleTileEntries );
		for ( let index = 0; index < selectedEntries.length; index ++ ) {

			const entry = selectedEntries[ index ];
			if ( index === 0 ) {

				target.copy( entry.box );

			} else {

				target.union( entry.box );

			}

		}

		return true;

	}

	if ( loadedOnly ) return false;

	if ( tilesRenderer.getBoundingBox( target ) ) {

		tilesRenderer.group.updateMatrixWorld( true );
		target.applyMatrix4( tilesRenderer.group.matrixWorld );
		return true;

	}

	return false;

}

function getTilesRendererCartographicAnchor( tilesRenderer, loadedOnly = false ) {

	if ( ! tilesRenderer ) {

		return false;

	}

	const visibleTileEntries = [];
	collectVisibleLoadedTileEntries( tilesRenderer, visibleTileEntries );
	if ( visibleTileEntries.length > 0 ) {

		const selectedEntries = selectDenseTileEntries( visibleTileEntries );
		_tilesCenter.set( 0, 0, 0 );
		for ( const entry of selectedEntries ) {

			_tilesCenter.add( entry.center );

		}

		_tilesCenter.multiplyScalar( 1 / selectedEntries.length );

	} else {

		if ( loadedOnly || ! getTilesRendererBounds( tilesRenderer, _tilesBounds, false ) ) {

			return false;

		}

		_tilesBounds.getCenter( _tilesCenter );

	}

	_groupInverse.copy( tilesRenderer.group.matrixWorld ).invert();
	_tilesCenter.applyMatrix4( _groupInverse );
	tilesRenderer.ellipsoid.getPositionToCartographic( _tilesCenter, _tileCartographic );

	return Number.isFinite( _tileCartographic.lat ) && Number.isFinite( _tileCartographic.lon );

}

function collectVisibleLoadedTileEntries( tilesRenderer, entries ) {

	entries.length = 0;
	tilesRenderer.group.updateMatrixWorld( true );
	tilesRenderer.forEachLoadedModel( scene => {

		if ( scene.parent !== tilesRenderer.group ) return;

		scene.updateMatrixWorld( true );
		_loadedSceneBounds.setFromObject( scene );
		if ( _loadedSceneBounds.isEmpty() ) return;

		_loadedSceneBounds.getCenter( _loadedSceneCenter );
		_loadedSceneBounds.getSize( _loadedSceneSize );
		entries.push( {
			box: _loadedSceneBounds.clone(),
			center: _loadedSceneCenter.clone(),
			diagonal: _loadedSceneSize.length(),
		} );

	} );

	return entries;

}

function selectDenseTileEntries( entries ) {

	if ( entries.length <= 1 ) return entries;

	const sortedEntries = [ ...entries ].sort( ( a, b ) => a.diagonal - b.diagonal );
	const keepCount = entries.length < 6
		? Math.max( 1, Math.ceil( sortedEntries.length * 0.5 ) )
		: Math.max( 3, Math.ceil( sortedEntries.length * 0.35 ) );

	return sortedEntries.slice( 0, Math.min( keepCount, sortedEntries.length ) );

}

function tryPlaceLocalTargetFromTilesRenderer( tilesRenderer, loadedOnly = false ) {

	if ( ! localTarget || ! tilesRenderer || localTargetPlacementState === 'manual' ) {

		return false;

	}

	if ( ! getTilesRendererCartographicAnchor( tilesRenderer, loadedOnly ) ) {

		return false;

	}

	const anchorHeight = Number.isFinite( _tileCartographic.height ) ? _tileCartographic.height : 0;
	placeObjectAtCartographicLocation(
		localTarget,
		_tileCartographic.lat,
		_tileCartographic.lon,
		anchorHeight + LOCAL_TARGET_BASE_HEIGHT,
		tilesRenderer,
	);
	syncWorldGroupToLocalTarget();
	localTargetPlacementState = loadedOnly ? 'auto-loaded' : 'auto-root';

	return true;

}

function placeLocalTargetAtSoonModel() {

	if ( localTargetPlacementState === 'manual' ) {

		return;

	}

	placeObjectAtCartographicLocation( localTarget, SOONSPACE_LAT, SOONSPACE_LON, LOCAL_TARGET_BASE_HEIGHT, getReferenceTilesRenderer() );
	if ( localTargetPlacementState !== 'manual' ) {

		localTargetPlacementState = 'fixed-anchor';

	}

	syncWorldGroupToLocalTarget();

}

function syncWorldGroupToLocalTarget() {

	plotEngine.group.position.copy( localTarget.position );
	plotEngine.group.quaternion.copy( localTarget.quaternion );
	plotEngine.group.scale.copy( localTarget.scale );
	plotEngine.group.updateMatrixWorld( true );

}

function focusCamera( center, forward, up, right, distance ) {

	camera.position
		.copy( center )
		.addScaledVector( forward, distance )
		.addScaledVector( up, distance * 0.25 )
		.addScaledVector( right, distance * 0.1 );
	camera.up.copy( up );
	camera.lookAt( center );
	camera.updateMatrixWorld( true );

	controls.resetState();
	controls.pivotPoint.copy( center );
	controls.zoomPoint.copy( center );
	controls.zoomPointSet = true;
	controls.zoomDirectionSet = false;
	controls.needsUpdate = true;
	controls.update();

	renderer.render( scene, camera );

}

function frameCartographicLocation( lat, lon, height, distance ) {

	WGS84_ELLIPSOID.getObjectFrame( lat, lon, height, 0, 0, 0, _beijingFrame );
	const referenceTiles = getReferenceTilesRenderer();
	if ( referenceTiles ) {

		referenceTiles.group.updateMatrixWorld( true );
		_beijingFrame.premultiply( referenceTiles.group.matrixWorld );

	} else {

		_beijingFrame.premultiply( _globeSceneFrame );

	}

	_beijingFrame.decompose( _framePosition, _frameQuaternion, _frameScale );
	_frameForward.set( 0, 0, 1 ).applyQuaternion( _frameQuaternion ).normalize();
	_frameUp.set( 0, 1, 0 ).applyQuaternion( _frameQuaternion ).normalize();
	_frameRight.set( 1, 0, 0 ).applyQuaternion( _frameQuaternion ).normalize();

	focusCamera( _framePosition, _frameForward, _frameUp, _frameRight, distance );

}

function frameTerrain() {

	frameCartographicLocation( SOONSPACE_LAT, SOONSPACE_LON, DEFAULT_SHAPE_HEIGHT + 2000, 12000 );

}

function frameSoonModel() {

	if ( modelTiles && getTilesRendererBounds( modelTiles, _tilesBounds ) && getTilesRendererCartographicAnchor( modelTiles ) ) {

		_tilesBounds.getCenter( _framePosition );
		_tilesBounds.getSize( _tilesSize );

		WGS84_ELLIPSOID.getObjectFrame( _tileCartographic.lat, _tileCartographic.lon, _tileCartographic.height, 0, 0, 0, _beijingFrame );
		modelTiles.group.updateMatrixWorld( true );
		_beijingFrame.premultiply( modelTiles.group.matrixWorld );
		_beijingFrame.decompose( _tilesCenter, _frameQuaternion, _frameScale );

		_frameForward.set( 0, 0, 1 ).applyQuaternion( _frameQuaternion ).normalize();
		_frameUp.set( 0, 1, 0 ).applyQuaternion( _frameQuaternion ).normalize();
		_frameRight.set( 1, 0, 0 ).applyQuaternion( _frameQuaternion ).normalize();

		const distance = Math.max( _tilesSize.x, _tilesSize.y, _tilesSize.z, 300 ) * 2.4;
		focusCamera( _framePosition, _frameForward, _frameUp, _frameRight, distance );
		return;

	}

	frameCartographicLocation( SOONSPACE_LAT, SOONSPACE_LON, DEFAULT_SHAPE_HEIGHT + 2000, 18000 );

}

function syncLocalTargetToSoonModel() {

	const previousPlacementState = localTargetPlacementState;
	placeLocalTargetAtSoonModel();

	if (
		params.targetMode !== 'tiles' &&
		localTargetPlacementState !== 'manual' &&
		previousPlacementState !== localTargetPlacementState
	) {

		frameLocalTarget();

	}

}

function attachSoonModelListeners() {

	if ( ! modelTiles ) return;

	modelTiles.addEventListener( 'load-tileset', syncLocalTargetToSoonModel );
	modelTiles.addEventListener( 'tiles-load-end', syncLocalTargetToSoonModel );

}

function detachSoonModelListeners() {

	if ( ! modelTiles ) return;

	modelTiles.removeEventListener( 'load-tileset', syncLocalTargetToSoonModel );
	modelTiles.removeEventListener( 'tiles-load-end', syncLocalTargetToSoonModel );

}

function reinstantiateTiles() {

	const ionAccessToken = getIonAccessToken();

	if ( ionAccessToken ) {

		localStorage.setItem( 'ionApiKey', ionAccessToken );

	} else {

		localStorage.removeItem( 'ionApiKey' );

	}

	if ( tiles ) {

		plotEngine.detachTarget( TERRAIN_TARGET_ID );
		scene.remove( tiles.group );
		tiles.dispose();
		tiles = null;

	}

	if ( ! params.showTerrain || ! ionAccessToken ) {

		syncControlsEllipsoid();
		updateCredits();
		return;

	}

	tiles = new TilesRenderer();
	tiles.fetchOptions.mode = 'cors';
	tiles.registerPlugin( new GLTFExtensionsPlugin( {
		dracoLoader: createDracoLoader(),
	} ) );
	tiles.registerPlugin( new CesiumIonAuthPlugin( {
		apiToken: ionAccessToken,
		assetId: params.ionAssetId,
		autoRefreshToken: true,
		assetTypeHandler: ( type, renderer ) => {

			if ( type === 'TERRAIN' && renderer.getPluginByName( 'QUANTIZED_MESH_PLUGIN' ) === null ) {

				renderer.registerPlugin( new QuantizedMeshPlugin( {
					useRecommendedSettings: true,
				} ) );

			}

		},
	} ) );
	tiles.registerPlugin( new ImageOverlayPlugin( {
		renderer,
		overlays: [
			new CesiumIonOverlay( {
				assetId: params.ionImageryAssetId,
				apiToken: ionAccessToken,
			} ),
		],
		resolution: 512,
	} ) );

	tiles.group.rotation.x = - Math.PI / 2;
	tiles.group.visible = params.terrainVisible;
	scene.add( tiles.group );
	placeLocalTargetAtSoonModel();
	syncWorldGroupToLocalTarget();

	plotEngine.attachTilesRenderer( TERRAIN_TARGET_ID, tiles, {
		geoReference: { kind: 'cartographic' },
		getTileBounds: getCartographicTileBounds,
	} );

	tiles.setResolutionFromRenderer( camera, renderer );
	tiles.setCamera( camera );
	requestConditionalTilesUpdates();
	syncControlsEllipsoid();

}

function getCartographicTileBounds( tile, scene, target ) {

	const ellipsoid = target.tilesRenderer?.ellipsoid;
	const group = target.tilesRenderer?.group;
	if ( ! ellipsoid || ! group ) return null;

	group.updateMatrixWorld?.( true );
	scene.updateMatrixWorld?.( true );
	_groupInverse.copy( group.matrixWorld ).invert();

	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = - Infinity;
	let maxLat = - Infinity;
	let hasVertex = false;

	scene.traverse?.( child => {

		if ( ! child.isMesh || ! child.geometry ) return;

		const positionAttribute = child.geometry.getAttribute?.( 'position' );
		if ( ! positionAttribute ) return;

		child.updateMatrixWorld?.( true );
		_tileBoundsMatrix.copy( child.matrixWorld ).premultiply( _groupInverse );

		for ( let index = 0; index < positionAttribute.count; index ++ ) {

			_tileBoundsPoint.fromBufferAttribute( positionAttribute, index ).applyMatrix4( _tileBoundsMatrix );
			ellipsoid.getPositionToCartographic( _tileBoundsPoint, _tileCartographic );

			const lon = _tileCartographic.lon * MathUtils.RAD2DEG;
			const lat = _tileCartographic.lat * MathUtils.RAD2DEG;
			if ( ! Number.isFinite( lon ) || ! Number.isFinite( lat ) ) continue;

			hasVertex = true;
			minLon = Math.min( minLon, lon );
			minLat = Math.min( minLat, lat );
			maxLon = Math.max( maxLon, lon );
			maxLat = Math.max( maxLat, lat );

		}

	} );

	if ( ! hasVertex || ! Number.isFinite( minLon ) || ! Number.isFinite( minLat ) || ! Number.isFinite( maxLon ) || ! Number.isFinite( maxLat ) ) {

		return null;

	}

	return [ minLon, minLat, maxLon, maxLat ];

}

function reinstantiateModelTiles() {

	if ( modelTiles ) {

		detachSoonModelListeners();
		plotEngine.detachTarget( SOONSPACE_TARGET_ID );
		scene.remove( modelTiles.group );
		modelTiles.dispose();
		modelTiles = null;

	}

	if ( ! params.showSoonModel ) {

		syncControlsEllipsoid();
		updateCredits();
		return;

	}

	modelTiles = new TilesRenderer( SOONSPACE_TILESET_URL );
	localTargetPlacementState = 'auto-fallback';
	modelTiles.fetchOptions.mode = 'cors';
	modelTiles.registerPlugin( new GLTFExtensionsPlugin( {
		rtc: true,
		dracoLoader: createDracoLoader(),
	} ) );
	modelTiles.group.rotation.x = - Math.PI / 2;
	modelTiles.group.visible = params.soonModelVisible;
	scene.add( modelTiles.group );
	placeLocalTargetAtSoonModel();
	syncWorldGroupToLocalTarget();
	attachSoonModelListeners();

	plotEngine.attachTilesRenderer( SOONSPACE_TARGET_ID, modelTiles, {
		geoReference: { kind: 'cartographic' },
		getTileBounds: getCartographicTileBounds,
	} );

	modelTiles.setResolutionFromRenderer( camera, renderer );
	modelTiles.setCamera( camera );
	requestConditionalTilesUpdates();
	syncControlsEllipsoid();

}

function frameLocalTarget() {

	if ( ! localTarget ) return;

	localTarget.updateMatrixWorld( true );
	plotEngine.group.updateMatrixWorld( true );

	const box = new Box3().setFromObject( localTarget );
	const plotBox = new Box3().setFromObject( plotEngine.group );
	if ( ! plotBox.isEmpty() ) box.union( plotBox );

	const center = new Vector3();
	const size = new Vector3();
	box.getCenter( center );
	box.getSize( size );

	_frameForward.set( 0, 0, 1 ).transformDirection( localTarget.matrixWorld ).normalize();
	_frameUp.set( 0, 1, 0 ).transformDirection( localTarget.matrixWorld ).normalize();
	_frameRight.set( 1, 0, 0 ).transformDirection( localTarget.matrixWorld ).normalize();

	const distance = Math.max( size.x, size.y, size.z, 80 ) * 2.5;
	focusCamera( center, _frameForward, _frameUp, _frameRight, distance );

}

function resetShapes( options = {} ) {

	const frameCamera = options.frameCamera !== false;
	clearDemoShapes();

	// "single" 模式：默认值，仅渲染一个大多边形，便于演示编辑
	// "random" 模式：保留原有的随机多 shape 测试场景
	const demoMode = params.demoMode ?? 'single';

	if ( demoMode === 'single' ) {

		addSingleEditDemoShape( frameCamera );
		return;

	}

	if ( params.targetMode === 'tiles' ) {

		addModelDemoShapes( frameCamera );

	} else if ( params.targetMode === 'world' ) {

		addWorldDemoShapes( frameCamera );

	} else {

		addSurfaceDemoShapes( frameCamera );

	}

}

/**
 * 单一编辑演示：在 SoonCPS 中心附近放一个面积较大的多边形，并按当前
 * targetMode 决定它的 attachment：
 *
 *   - world  → addWorldShape：cartographic→world 转换，多边形悬浮在 SoonCPS
 *              世界坐标系上方（worldHeight 米），编辑器立即进入编辑会话
 *   - surface → addSurfaceShape：保留 cartographic 坐标，attachment 为 surface
 *              的 terrain target——多边形会"贴地"在 Cesium 地形上
 *   - tiles   → addModelShape：附着在 SoonCPS 模型瓦片上
 *
 * 高度统一来自 params.worldHeight（与"World height"滑块同源），用户拖动
 * 滑块会实时改变 demo polygon 的高度（surface/tiles 模式下也有效，但视
 * attachment 实现可能被覆盖为地表跟随）。
 *
 * @param {boolean} frameCamera 是否聚焦相机
 */
function addSingleEditDemoShape( frameCamera ) {

	const cartoPolygon = buildSingleDemoCartographicPolygon();

	let result;
	if ( params.targetMode === 'tiles' ) {

		result = addModelShape( cartoPolygon );

	} else if ( params.targetMode === 'surface' ) {

		result = addSurfaceShape( cartoPolygon );

	} else {

		// world 模式（默认）：cartographic → world frame meters，attachment.mode = 'world'
		result = addWorldShape( cartographicShapeToWorldShape( cartoPolygon ) );

	}

	_singleDemoShapeId = result?.id ?? null;
	plotEngine.invalidate();
	plotEngine.update();
	plotEngine.start();
	demoGenerationProgress = null;

	// Begin editing in every target mode; PlotEditor resolves the correct edit frame.
	if ( _singleDemoShapeId != null && plotEditor ) {

		plotEditor.beginEdit( _singleDemoShapeId );
		const shape = plotEngine.shapeStore.get( _singleDemoShapeId );
		if ( shape ) plotEditor._session?.handleLayer?.setSizeScale?.( getEditorHandleSizeScale( shape ) );

	}

	if ( frameCamera ) frameSoonModel();

}

/**
 * 构造 single 模式的 cartographic 多边形（lon/lat 度数 + 高度米）。
 * 多边形位于 SoonCPS 中心，宽约 50–70 米，呈不规则六边形，便于直观看到
 * 顶点 / 中点 / 中心控制点。
 */
function buildSingleDemoCartographicPolygon() {

	const altitude = Number( params.worldHeight ?? 300 ) || 0;
	const lon = SOONSPACE_LON_DEG;
	const lat = SOONSPACE_LAT_DEG;
	// 0.0005 度 ≈ 55m 经度（在 ~33°N 处约 92km/deg），0.0005 度 ≈ 55m 纬度
	const r = 0.0005;
	return {
		kind: 'polygon',
		coordinates: [
			[ lon - r, lat - r, altitude ],
			[ lon + r, lat - r, altitude ],
			[ lon + r * 1.4, lat, altitude ],
			[ lon + r, lat + r, altitude ],
			[ lon - r, lat + r, altitude ],
			[ lon - r * 1.4, lat, altitude ],
		],
		style: {
			fillColor: '#22d3ee',
			strokeColor: '#ecfeff',
			strokeWidth: 0,
			opacity: 0.7,
			altitude,
		},
	};

}

/**
 * 把 single demo polygon 的所有顶点的 z 替换为新高度，走 plotEngine.updateShape
 * 触发重编译。编辑会话存在时同步 working shape，避免 handle 与 hot mesh 错位。
 *
 * @param {number} altitude 新的高度（米）
 * @returns {boolean} 是否更新了 shape
 */
function applySingleDemoShapeHeight( altitude ) {

	if ( _singleDemoShapeId == null ) return false;
	const shape = plotEngine.shapeStore.get( _singleDemoShapeId );
	if ( ! shape ) return false;

	const newCoordinates = ( shape.coordinates || [] ).map( point => [
		point[ 0 ],
		point[ 1 ],
		altitude,
	] );
	const newStyle = { ...( shape.style || {} ), altitude };

	plotEngine.updateShape( _singleDemoShapeId, {
		coordinates: newCoordinates,
		style: newStyle,
	} );

	// 同步当前编辑会话的 working / initial shape，让 handle 立即跟随新高度
	if ( plotEditor?.editingShapeId === _singleDemoShapeId ) {

		plotEditor._refreshSessionAfterExternalChange?.();

	}

	return true;

}

function withDefaultHeight( shape, defaultHeight = DEFAULT_SHAPE_HEIGHT ) {

	return {
		...shape,
		coordinates: ( shape.coordinates || [] ).map( point => [
			point[ 0 ],
			point[ 1 ],
			point[ 2 ] ?? defaultHeight,
		] ),
	};

}

function withForcedHeight( shape, height ) {

	return {
		...shape,
		coordinates: ( shape.coordinates || [] ).map( point => [
			point[ 0 ],
			point[ 1 ],
			height,
		] ),
	};

}

function getMetersPerDegreeLon( latRad ) {

	return Math.cos( latRad ) * 111320;

}

function cartographicPointToWorldPoint( point ) {

	const [ lonDeg, latDeg, height ] = point;
	const cartographicHeight = point.length > 2 && Number.isFinite( Number( height ) ) ? Number( height ) : 0;
	WGS84_ELLIPSOID.getCartographicToPosition(
		latDeg * MathUtils.DEG2RAD,
		lonDeg * MathUtils.DEG2RAD,
		cartographicHeight,
		_cartographicPosition,
	);

	const referenceTiles = getReferenceTilesRenderer();
	if ( referenceTiles ) {

		referenceTiles.group.updateMatrixWorld( true );
		_cartographicPosition.applyMatrix4( referenceTiles.group.matrixWorld );

	} else {

		_cartographicPosition.applyMatrix4( _globeSceneFrame );

	}

	if ( localTarget ) {

		localTarget.updateMatrixWorld( true );
		_groupInverse.copy( localTarget.matrixWorld ).invert();
		_cartographicPosition.applyMatrix4( _groupInverse );

	}

	return point.length > 2
		? [ _cartographicPosition.x, _cartographicPosition.z, _cartographicPosition.y ]
		: [ _cartographicPosition.x, _cartographicPosition.z ];

}

function cartographicStyleToWorldStyle( shape ) {

	const style = { ...( shape.style || {} ) };
	const metersPerDegreeLon = getMetersPerDegreeLon( SOONSPACE_LAT );

	if ( Number.isFinite( style.width ) ) style.width *= metersPerDegreeLon;
	if ( Number.isFinite( style.headLength ) ) style.headLength *= metersPerDegreeLon;
	if ( Number.isFinite( style.radius ) ) style.radius *= metersPerDegreeLon;
	if ( Number.isFinite( style.strokeWidth ) && style.strokeWidth <= 1 ) {

		style.strokeWidth = Math.max( style.strokeWidth * Math.min( metersPerDegreeLon, METERS_PER_DEG_LAT ), 2 );

	}

	if ( shape.kind === 'point' ) {

		style.size = Math.max( Number( style.size ?? 0 ), 10 );

	}

	return style;

}

function cartographicShapeToWorldShape( shape ) {

	return {
		...shape,
		coordinates: ( shape.coordinates || [] ).map( cartographicPointToWorldPoint ),
		style: cartographicStyleToWorldStyle( shape ),
	};

}

function getDemoPlotCount() {

	return Math.max( 1, Number( params.demoPlotCount ?? DEFAULT_DEMO_PLOT_COUNT ) || DEFAULT_DEMO_PLOT_COUNT );

}

function getDemoPlotGridColumns( totalCount ) {

	return Math.max( 1, Math.ceil( Math.sqrt( totalCount ) ) );

}

function getDemoPlotOffset( index, totalCount = getDemoPlotCount() ) {

	const columns = getDemoPlotGridColumns( totalCount );
	const column = index % columns;
	const row = Math.floor( index / columns );
	const rows = Math.ceil( totalCount / columns );

	return {
		lon: ( column - ( columns - 1 ) * 0.5 ) * DEMO_PLOT_LON_STEP,
		lat: ( row - ( rows - 1 ) * 0.5 ) * DEMO_PLOT_LAT_STEP,
	};

}

function getDemoPlotStyle( index, overrides = {} ) {

	const color = DEMO_PLOT_COLORS[ index % DEMO_PLOT_COLORS.length ];

	return {
		...SOONSPACE_POLYGON_STYLE,
		fillColor: color,
		strokeColor: '#ecfeff',
		strokeWidth: DEMO_PLOT_STROKE_WIDTH,
		opacity: 0.62,
		...overrides,
	};

}

function getDemoPlotCenter( index, totalCount ) {

	const offset = getDemoPlotOffset( index, totalCount );
	return [
		SOONSPACE_LON_DEG + offset.lon,
		SOONSPACE_LAT_DEG + offset.lat,
	];

}

function getLocalDemoPlotCenter( index, totalCount ) {

	const columns = getDemoPlotGridColumns( totalCount );
	const rows = Math.ceil( totalCount / columns );
	const column = index % columns;
	const row = Math.floor( index / columns );
	const stepX = LOCAL_SURFACE_BOARD_SPAN / Math.max( columns, 1 );
	const stepY = LOCAL_SURFACE_BOARD_SPAN / Math.max( rows, 1 );

	return [
		( column - ( columns - 1 ) * 0.5 ) * stepX,
		( row - ( rows - 1 ) * 0.5 ) * stepY,
	];

}

function getDemoPlotShape( index, idPrefix, options = {} ) {

	const id = `${ idPrefix }-${ index }`;
	const types = options.types || DEMO_WORLD_PLOT_TYPES;
	const kind = types[ index % types.length ];
	const totalCount = options.totalCount ?? getDemoPlotCount();
	const [ lon, lat ] = options.coordinateSpace === 'local'
		? getLocalDemoPlotCenter( index, totalCount )
		: getDemoPlotCenter( index, totalCount );
	const size = options.size ?? DEMO_PLOT_SIZE;
	const halfSize = size * 0.5;
	const style = getDemoPlotStyle( index, options.styleOverrides );

	if ( kind === 'point' ) {

		return {
			id,
			kind,
			coordinates: [ [ lon, lat ] ],
			style: {
				...style,
				size: size,
				strokeWidth: 0,
			},
		};

	}

	if ( kind === 'line' ) {

		return {
			id,
			kind,
			coordinates: [
				[ lon - halfSize, lat - halfSize ],
				[ lon + halfSize, lat + halfSize ],
			],
			style: {
				...style,
				fillColor: '#000000',
				strokeWidth: DEMO_PLOT_STROKE_WIDTH * 1.6,
			},
		};

	}

	if ( kind === 'polyline' ) {

		return {
			id,
			kind,
			coordinates: [
				[ lon - halfSize, lat - halfSize ],
				[ lon, lat + halfSize ],
				[ lon + halfSize, lat - halfSize * 0.2 ],
			],
			style: {
				...style,
				fillColor: '#000000',
				strokeWidth: DEMO_PLOT_STROKE_WIDTH * 1.5,
			},
		};

	}

	if ( kind === 'polygon' ) {

		return {
			id,
			kind,
			coordinates: [
				[ lon, lat + halfSize ],
				[ lon + halfSize, lat ],
				[ lon + halfSize * 0.25, lat - halfSize ],
				[ lon - halfSize, lat - halfSize * 0.35 ],
			],
			style,
		};

	}

	if ( kind === 'rectangle' ) {

		return {
			id,
			kind,
			coordinates: [
				[ lon - halfSize, lat - halfSize * 0.7 ],
				[ lon + halfSize, lat + halfSize * 0.7 ],
			],
			style,
		};

	}

	if ( kind === 'circle' ) {

		return {
			id,
			kind,
			coordinates: [ [ lon, lat ] ],
			style: {
				...style,
				radius: halfSize,
			},
		};

	}

	if ( kind === 'sector' ) {

		return {
			id,
			kind,
			coordinates: [ [ lon, lat ] ],
			style: {
				...style,
				radius: halfSize,
				startAngle: ( index % 8 ) * Math.PI * 0.25,
				sectorAngle: Math.PI * 1.25,
			},
		};

	}

	return {
		id,
		kind: 'arrow',
		coordinates: [
			[ lon - halfSize, lat - halfSize * 0.4 ],
			[ lon + halfSize, lat + halfSize * 0.4 ],
		],
		style: {
			...style,
			width: size * 0.28,
			headLength: size * 0.45,
		},
	};

}

function addSoonspaceDemoShapes( addShape, idPrefix, options = {} ) {

	const totalCount = options.totalCount ?? getDemoPlotCount();
	const startIndex = options.startIndex ?? 0;
	const endIndex = Math.min( options.endIndex ?? totalCount, totalCount );

	for ( let index = startIndex; index < endIndex; index ++ ) {

		addShape( getDemoPlotShape( index, idPrefix, {
			...options,
			totalCount,
		} ) );

	}

}

function cancelDemoGeneration() {

	demoGenerationToken ++;
	if ( demoGenerationHandle !== null ) {

		cancelAnimationFrame( demoGenerationHandle );
		demoGenerationHandle = null;

	}

	demoGenerationProgress = null;

}

function clearDemoShapes() {

	cancelDemoGeneration();
	if ( plotEditor?.isEditing ) plotEditor.cancelEdit();
	plotEngine.stop();
	plotEngine.clearShapes();
	worldShapeIds.length = 0;
	localShapeIds.length = 0;
	terrainShapeIds.length = 0;
	modelShapeIds.length = 0;
	_singleDemoShapeId = null;

}

function finalizeDemoShapes( frameCamera ) {

	plotEngine.invalidate();
	plotEngine.update();
	plotEngine.start();
	demoGenerationProgress = null;

	if ( ! frameCamera ) return;

	if ( params.targetMode === 'tiles' ) {

		frameSoonModel();

	} else if ( params.targetMode === 'surface' ) {

		frameTerrain();

	} else {

		frameLocalTarget();

	}

}

function populateDemoShapes( addShape, idPrefix, options = {}, frameCamera = true ) {

	const totalCount = getDemoPlotCount();
	const token = ++ demoGenerationToken;
	let startIndex = 0;

	demoGenerationProgress = {
		current: 0,
		total: totalCount,
	};

	const step = () => {

		if ( token !== demoGenerationToken ) return;

		const endIndex = Math.min( startIndex + DEMO_PLOT_BATCH_SIZE, totalCount );
		addSoonspaceDemoShapes( addShape, idPrefix, {
			...options,
			totalCount,
			startIndex,
			endIndex,
		} );
		startIndex = endIndex;
		demoGenerationProgress.current = startIndex;

		if ( startIndex < totalCount ) {

			demoGenerationHandle = requestAnimationFrame( step );

		} else {

			demoGenerationHandle = null;
			finalizeDemoShapes( frameCamera );

		}

	};

	step();

}

function addWorldDemoShapes( frameCamera = true ) {

	populateDemoShapes(
		shape => addWorldShape(
			cartographicShapeToWorldShape( shape ),
			params.worldHeight,
			false,
		),
		'world-aoi',
		{
			types: DEMO_WORLD_PLOT_TYPES,
			styleOverrides: {
				opacity: params.localOpacity,
			},
		},
		frameCamera,
	);

}

function addSurfaceDemoShapes( frameCamera = true ) {

	populateDemoShapes( shape => addSurfaceShape( shape, false ), 'surface-aoi', {
		types: DEMO_SURFACE_PLOT_TYPES,
		styleOverrides: {
			strokeWidth: 0,
			opacity: params.localOpacity,
		},
	}, frameCamera );

}

function addTerrainDemoShapes( frameCamera = true ) {

	populateDemoShapes( shape => addTerrainShape( shape, false ), 'terrain-aoi', {
		types: DEMO_TILE_PLOT_TYPES,
		styleOverrides: {
			...SOONSPACE_POLYGON_STYLE,
			fillColor: '#f97316',
			strokeColor: '#fed7aa',
			strokeWidth: 0,
			opacity: 0.6,
		},
	}, frameCamera );

}

function addModelDemoShapes( frameCamera = true ) {

	populateDemoShapes( shape => addModelShape( shape, false ), 'model-aoi', {
		types: DEMO_TILE_PLOT_TYPES,
		styleOverrides: {
			strokeWidth: 0,
		},
	}, frameCamera );

}

function addWorldShape( shape, defaultHeight = params.worldHeight, shouldInvalidate = true ) {

	const result = plotEngine.shapeStore.add( withForcedHeight( {
		...shape,
		style: {
			...( shape.style || {} ),
			altitude: defaultHeight,
		},
	}, defaultHeight ) );
	if ( shouldInvalidate ) plotEngine.invalidate();
	worldShapeIds.push( result.id );
	return result;

}

function addLocalShape( shape, shouldInvalidate = true ) {

	const result = plotEngine.shapeStore.add( {
		...withDefaultHeight( shape, 0.1 ),
		attachment: {
			mode: 'surface',
			targetId: 'local-board',
		},
	} );
	if ( shouldInvalidate ) plotEngine.invalidate();
	localShapeIds.push( result.id );
	return result;

}

function addTerrainShape( shape, shouldInvalidate = true ) {

	const result = plotEngine.shapeStore.add( {
		...withDefaultHeight( shape, params.worldHeight ),
		attachment: {
			mode: 'tiles',
			targetId: TERRAIN_TARGET_ID,
		},
	} );
	if ( shouldInvalidate ) plotEngine.invalidate();
	terrainShapeIds.push( result.id );
	return result;

}

function addSurfaceShape( shape, shouldInvalidate = true ) {

	const result = plotEngine.shapeStore.add( {
		...withForcedHeight( shape, params.worldHeight ),
		attachment: {
			mode: 'surface',
			targetId: TERRAIN_TARGET_ID,
		},
	} );
	if ( shouldInvalidate ) plotEngine.invalidate();
	terrainShapeIds.push( result.id );
	return result;

}

function addModelShape( shape, shouldInvalidate = true ) {

	const result = plotEngine.shapeStore.add( {
		...withDefaultHeight( shape, params.worldHeight ),
		attachment: {
			mode: 'tiles',
			targetId: SOONSPACE_TARGET_ID,
		},
	} );
	if ( shouldInvalidate ) plotEngine.invalidate();
	modelShapeIds.push( result.id );
	return result;

}

function randomizeLocalShapes() {

	localTarget.updateMatrixWorld( true );

	_moveRight.set( 1, 0, 0 ).transformDirection( localTarget.matrixWorld ).normalize();
	_moveForward.set( 0, 0, 1 ).transformDirection( localTarget.matrixWorld ).normalize();

	const offsetRight = ( Math.random() - 0.5 ) * 2000;
	const offsetForward = ( Math.random() - 0.5 ) * 2000;
	localTargetPlacementState = 'manual';
	localTarget.position
		.addScaledVector( _moveRight, offsetRight )
		.addScaledVector( _moveForward, offsetForward );
	localTarget.updateMatrixWorld( true );
	syncWorldGroupToLocalTarget();
	if ( params.targetMode !== 'tiles' || ! tiles ) frameLocalTarget();

}

function updateWorldHeight( value ) {

	const altitude = Number( value ) || 0;
	params.worldHeight = altitude;

	// single 模式：只更新唯一 demo polygon 的 z，保留用户编辑过的形状
	if ( params.demoMode === 'single' && _singleDemoShapeId != null ) {

		const updated = applySingleDemoShapeHeight( altitude );
		if ( updated ) return;

	}

	// random 模式 / single 模式但没有现存 shape：走重置路径
	resetShapes( { frameCamera: false } );

}

function updateDemoPlotCount( value ) {

	params.demoPlotCount = Number( value );
	resetShapes( { frameCamera: false } );

}

function setupGui() {

	const gui = new GUI();
	gui.width = 340;
	gui.add( params, 'targetMode', {
		world: 'world',
		surface: 'surface',
		tiles: 'tiles',
	} )
		.name( 'Selected target mode' )
		.onChange( mode => {

			if ( mode === 'surface' || mode === 'tiles' ) {

				params.showTerrain = true;
				if ( ! tiles ) reinstantiateTiles();
				else updateTerrainVisibility();

			}

			plotEngine.setMode( mode );
			requestConditionalTilesUpdates();
			// 始终重建 demo shape，让 single 模式也能根据 targetMode 切换 attachment
			// （world / surface / tiles 三种 attachment 视觉差别明显——
			//   world：悬浮在 SoonCPS 上空；surface：贴 Cesium 地形；tiles：贴 SoonCPS 模型）
			resetShapes( { frameCamera: false } );

		} );
	gui.add( params, 'showLocalBoard' ).name( 'Show local board' ).onChange( updateLocalBoardVisibility );
	gui.add( params, 'showTerrain' ).name( 'Show terrain' ).onChange( reinstantiateTiles );
	gui.add( params, 'showSoonModel' ).name( 'Show SoonCPS model' ).onChange( reinstantiateModelTiles );
	gui.add( params, 'localOpacity', 0.1, 1, 0.05 ).name( 'Local opacity' ).onChange( updateLocalOpacity );
	gui.add( params, 'worldHeight', - 2000, 10000, 10 ).name( 'World height' ).onChange( updateWorldHeight );
	gui.add( params, 'demoMode', {
		'Single (editable)': 'single',
		'Random (stress)': 'random',
	} )
		.name( 'Demo mode' )
		.onChange( () => resetShapes( { frameCamera: true } ) );
	gui.add( params, 'demoPlotCount', {
		100: 100,
		500: 500,
		1000: 1000,
		100000: 100000,
		1000000: 1000000,
	} )
		.name( 'Plot count' )
		.onChange( updateDemoPlotCount );
	gui.add( params, 'randomizeLocal' ).name( 'Move local target' );
	gui.add( params, 'resetShapes' ).name( 'Reset shapes' );

	const cameraFolder = gui.addFolder( 'Camera' );
	cameraFolder.add( params, 'focusLocalBoard' ).name( 'Focus local board' );
	cameraFolder.add( params, 'focusTerrain' ).name( 'Focus tiles area' );
	cameraFolder.add( params, 'focusSoonModel' ).name( 'Focus SoonCPS model' );

	const terrainFolder = gui.addFolder( 'Cesium Terrain' );
	terrainFolder.add( params, 'terrainVisible' ).name( 'Visible' ).onChange( updateTerrainVisibility );
	terrainFolder.add( params, 'ionAccessToken' ).name( 'Ion access token' );
	terrainFolder.add( params, 'ionAssetId' ).name( 'Terrain asset id' );
	terrainFolder.add( params, 'ionImageryAssetId' ).name( 'Imagery asset id' );
	terrainFolder.add( params, 'reloadTerrain' ).name( 'Reload terrain' );

	const soonFolder = gui.addFolder( 'SoonCPS 3D Tiles' );
	soonFolder.add( params, 'soonModelVisible' ).name( 'Visible' ).onChange( updateSoonModelVisibility );
	soonFolder.add( params, 'reloadSoonModel' ).name( 'Reload model' );

	const editorFolder = gui.addFolder( 'Editor' );
	editorFolder.add( params, 'editorEndEdit' ).name( 'End edit (commit)' );
	editorFolder.add( params, 'editorCancelEdit' ).name( 'Cancel edit' );
	editorFolder.add( params, 'editorDeselect' ).name( 'Deselect' );
	editorUndoController = editorFolder.add( params, 'editorUndo' ).name( 'Undo' );
	editorRedoController = editorFolder.add( params, 'editorRedo' ).name( 'Redo' );
	editorStatusController = editorFolder.add( params, 'editorStatus' ).name( 'Status' ).disable();
	editorFolder.open();

	refreshEditorGui();

}

function updateLocalOpacity() {

	for ( const id of [ ...worldShapeIds, ...localShapeIds, ...terrainShapeIds, ...modelShapeIds ] ) {

		plotEngine.updateShape( id, {
			style: {
				opacity: params.localOpacity,
			},
		} );

	}

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();

	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setPixelRatio( window.devicePixelRatio );

}

function animate() {

	requestAnimationFrame( animate );

	controls.update();
	camera.updateMatrixWorld();
	const cameraChanged = ! conditionalUpdateCameraInitialized ||
		hasMatrixChanged( camera.matrixWorld, _lastConditionalUpdateCameraMatrix );
	if ( cameraChanged ) {

		_lastConditionalUpdateCameraMatrix.copy( camera.matrixWorld );
		conditionalUpdateCameraInitialized = true;

	}

	const shouldUpdateTerrain = shouldUpdateExternalTiles( params.terrainVisible, terrainConditionalUpdateFrames, cameraChanged );
	const shouldUpdateModel = shouldUpdateExternalTiles( params.soonModelVisible, modelConditionalUpdateFrames, cameraChanged );

	if ( tiles && shouldUpdateTerrain ) {

		tiles.setResolutionFromRenderer( camera, renderer );
		tiles.setCamera( camera );
		tiles.update();
		if ( terrainConditionalUpdateFrames > 0 ) terrainConditionalUpdateFrames --;

	}

	if ( modelTiles && shouldUpdateModel ) {

		modelTiles.setResolutionFromRenderer( camera, renderer );
		modelTiles.setCamera( camera );
		modelTiles.update();
		if ( modelConditionalUpdateFrames > 0 ) modelConditionalUpdateFrames --;

	}

	renderer.render( scene, camera );
	updateCredits();

}

function updateCredits() {

	const credits = document.getElementById( 'credits' );
	if ( ! credits ) return;

	const terrainStatus = tiles
		? `terrain ${ params.terrainVisible ? 'visible' : 'hidden' }`
		: params.showTerrain
			? 'terrain missing ionAccessToken'
			: 'terrain disabled';
	const modelStatus = modelTiles
		? `SoonCPS model ${ params.soonModelVisible ? 'visible' : 'hidden' }`
		: params.showSoonModel
			? 'SoonCPS model loading or unavailable'
			: 'SoonCPS model disabled';
	const generationStatus = demoGenerationProgress
		? `, generating ${ demoGenerationProgress.current }/${ demoGenerationProgress.total }`
		: '';
	credits.innerText = `PlotEngine: ${ plotEngine.shapeStore.size }/${ getDemoPlotCount() } shapes, mode=${ params.targetMode }${ generationStatus }, ${ terrainStatus }, ${ modelStatus }`;

}
