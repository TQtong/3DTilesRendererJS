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
const TOUCH_GROUND_FRAME_LON_DEG = 110;
const TOUCH_GROUND_FRAME_LAT_DEG = 26.2;
const TOUCH_GROUND_FRAME_DISTANCE = 3600000;
const TOUCH_GROUND_CIRCLE_RADIUS = 8000;
const TOUCH_GROUND_RECT_WIDTH = 20000;
const TOUCH_GROUND_RECT_HEIGHT = 20000;
const TOUCH_GROUND_ARROW_WIDTH = 5000;
const TOUCH_GROUND_ARROW_HEAD_LENGTH = 12000;
const LOCAL_EDITOR_HANDLE_SIZE = 0.6;
const CONDITIONAL_TILE_UPDATE_FRAMES = 45;
const DEMO_SHAPE_COUNT = 8;
const TOUCH_GROUND_LINE_POINTS = [
	[ 119.99552468061438, 29.98779678449977 ],
	[ 119.99580048686205, 29.988238416209864 ],
	[ 119.99534018250115, 29.988492694365185 ],
	[ 119.99435743163077, 29.988454606644222 ],
	[ 119.99414870282934, 29.988084796650025 ],
	[ 119.9944385073686, 29.987605192923038 ],
	[ 119.99489756955799, 29.98744160470172 ],
	[ 119.99515575549049, 29.98734323911049 ],
];
const TOUCH_GROUND_POLYGON_POINTS = [
	[ 100.60, 22.60 ],
	[ 100.70, 22.55 ],
	[ 100.75, 22.65 ],
	[ 100.68, 22.70 ],
	[ 100.58, 22.67 ],
];
const TOUCH_GROUND_RECTANGLE_POINTS = [
	[ 119.98958614828571, 29.981249367417227 ],
	[ 119.98524036576107, 29.981153019385363 ],
	[ 119.99513688269689, 29.984687707618647 ],
	[ 119.99948281910438, 29.98478405905903 ],
];
const TOUCH_GROUND_ARROW_POINTS = [
	[ 100.50, 22.70 ],
	[ 100.60, 22.78 ],
	[ 100.75, 22.60 ],
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
	localOpacity: 1,
	worldHeight: 300,
	targetMode: 'surface',
	reloadTerrain: reinstantiateTiles,
	reloadSoonModel: reinstantiateModelTiles,
	focusLocalBoard: frameLocalTarget,
	focusTerrain: frameTerrain,
	focusSoonModel: frameSoonModel,
	resetShapes,
	editorBeginEdit: () => beginEditSelectedShape(),
	editorEndEdit: () => plotEditor?.endEdit(),
	editorCancelEdit: () => plotEditor?.cancelEdit(),
	editorDeselect: () => plotEditor?.deselect(),
	editorUndo: () => plotEditor?.undo(),
	editorRedo: () => plotEditor?.redo(),
	editorStatus: 'idle',
};

const shapeIds = {
	pointId: null,
	lineId: null,
	polylineId: null,
	polygonId: null,
	rectId: null,
	sectorId: null,
	circleId: null,
	arrowId: null,
};

const S = {
	pointStyle: 'circle',
	pointSize: 2000,
	pointFillColor: '#3B82F6',
	pointFillOpacity: 80,
	pointStrokeColor: '#1D4ED8',
	pointStrokeWidth: 2,
	pointStrokeOpacity: 100,
	pointVisible: true,

	lineStrokeStyle: 'solid',
	lineStrokeColor: '#ff00ff',
	lineStrokeWidth: 8,
	lineStrokeOpacity: 90,
	lineVisible: true,

	polylineStrokeStyle: 'solid',
	polylineStrokeColor: '#ff00ff',
	polylineStrokeWidth: 8,
	polylineStrokeOpacity: 90,
	polylineVisible: true,

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
	arrowVisible: true,
};

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
		// stencil 缂傛挸鍟块弰?PlotEngine TiledPipe meshOverlay 濡€崇础閿涘湑esium 妞嬪孩鐗搁崷鏉胯埌閸掑棛琚敍?
		// 閻ㄥ嫮鈥栭幀褑顩﹀Ч鍌椻偓鏂衡偓鏃€鐥呴張?stencil 缂傛挸鍟块敍瀹籬adow volume 娴兼俺顫﹂弫缈犵秼缂佹ê鍩楁稉鍝勫讲鐟欎焦鐓存担鎾扁偓?
		// Three.js WebGLRenderer 鐎?`stencil` 閻ㄥ嫰绮拋銈呪偓鐓庢躬娑撳秴鎮撻悧鍫熸拱闁插本婀侀崣妯哄閿?
		// 鏉╂瑩鍣烽弰鎯х础閹垫挸绱戦柆鍨帳娓氭繆绂嗘妯款吇閵?
		stencil: true,
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

	plotEngine = new PlotEngine();
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
		// 姒涙顓婚幍瀣労婢堆冪毈閿涘牆鐪柈銊ユ綏閺嶅洤宕熸担宥忕礆閵嗗倸婀稉宥呮倱 attach 濡€崇础娑撳娓剁憰浣瑰瘻鐏忓搫瀹崇拫鍐╂殻閿?
		//  - local board (鐏忓搫瀹?~80m)閿涙畧0.6
		//  - world (lon/lat 瀵冨鐏忓搫瀹?閿涙畧0.00015
		// 鏉╂瑩鍣风紒娆庣娑擃亙绻氱€瑰牆鈧》绱濋悽杈殶閻劍鏌熼崷?beginEdit 閸氬酣鈧俺绻?setSizeScale 鐟曞棛娲?
		handleSizeScale: 0.6,
	} );

	plotEditor.addEventListener( 'history-change', refreshEditorGui );
	plotEditor.addEventListener( 'edit-begin', refreshEditorGui );
	plotEditor.addEventListener( 'edit-end', refreshEditorGui );
	plotEditor.addEventListener( 'edit-cancel', refreshEditorGui );
	plotEditor.addEventListener( 'selection-change', refreshEditorGui );

	attachShapePickListener();

}

// 閳光偓閳光偓 閻愮懓鍤幏鎯у絿閿涙碍濡?閻愮懓鍤粚铏规婢跺嫮娈?shape"缂堟槒鐦ф稉?鏉╂稑鍙嗙拠?shape 閻ㄥ嫮绱潏鎴滅窗鐠? 閳光偓閳光偓
//
// 娴犲懎缍嬮悙鐟板毊閺勵垳婀″锝囨畱"閻厽瀵?閿涘牊瀵滄稉瀣╃瑢閹额剝鎹ｆ担宥囩枂閹恒儴绻庨妴渚€妫块梾鏃傜叚閿涘澧犵憴鍡曡礋 click閿?
// 閸氾箑鍨憴鍡曠稊 GlobeControls 閼奉亜绻侀惃鍕珛閹锋枻绱濇稉宥嗗ⅵ閹垫壆娴夐張鐑樻惙娴ｆ嚎鈧?
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

	// 缂傛牞绶張鐔兼？閿涙俺顔€ DragController 閼奉亜绻佹径鍕倞 handle 閸涙垝鑵戦敍娑滅箹闁插苯褰ч崷?閺?handle 閸涙垝鑵?
	// 閻ㄥ嫭鍎忛崘鍏哥瑓閸?shape pick閵嗗倹娓剁€硅妲楅惃鍕灲鐎规碍妲搁敍姝眑otEditor 閻?isEditing 閻樿埖鈧焦鐥呴崣姗堢礉
	// 娴ｅ棗鍙剧€圭偞娲块崣顖炴浆閻ㄥ嫭鏌熷蹇旀Ц閻╁瓨甯寸亸婵婄槸 pick閳ユ柡鈧柨顩ч弸?hit 閽€钘夋躬閸欙缚绔存稉?shape 娑撳绱濋崚娆忓瀼閹诡潿鈧?
	if ( ! plotEditor ) return;
	const shapeId = plotEditor.pickShapeAt( event.clientX, event.clientY );
	if ( shapeId == null ) return;
	if ( plotEditor.editingShapeId === shapeId ) return;

	plotEditor.select( shapeId );
	refreshEditorGui();

}

function beginEditSelectedShape( shapeId = plotEditor?.selectedShapeId ) {

	if ( ! plotEditor || shapeId == null ) return false;
	const ok = plotEditor.beginEdit( shapeId );
	if ( ! ok ) return false;
	const shape = plotEngine.shapeStore.get( shapeId );
	if ( shape ) {

		// 娑撳秴鎮?attachment 閻ㄥ嫬娼楅弽鍥ф槀鎼达箑妯婂鍌氭硶婢堆嶇礉閹稿鏄傛惔锕傗偓澶嬪閹靛鐒烘径褍鐨敍?
		//  - world (lon/lat 瀵冨)閿涙畧0.00015
		//  - surface 娑?local-board / 缁啿鏄傛惔锔肩窗~0.6
		plotEditor._session?.handleLayer?.setSizeScale?.( getEditorHandleSizeScale( shape ) );

	}

	refreshEditorGui();
	return true;

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

	frameCartographicLocation(
		TOUCH_GROUND_FRAME_LAT_DEG * MathUtils.DEG2RAD,
		TOUCH_GROUND_FRAME_LON_DEG * MathUtils.DEG2RAD,
		DEFAULT_SHAPE_HEIGHT + 2000,
		TOUCH_GROUND_FRAME_DISTANCE,
	);

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
	clearFixedDemoShapes();
	reAddAllDemoShapes( false );
	finalizeFixedDemoShapes( frameCamera );
	return;

}


function getDemoShapeEntries() {

	return [
		{ label: 'Point', idKey: 'pointId', addFn: addDemoPoint, applyFn: applyPoint },
		{ label: 'Line', idKey: 'lineId', addFn: addDemoLine, applyFn: applyLine },
		{ label: 'Polyline', idKey: 'polylineId', addFn: addDemoPolyline, applyFn: applyPolyline },
		{ label: 'Polygon', idKey: 'polygonId', addFn: addDemoPolygon, applyFn: applyPoly },
		{ label: 'Rectangle', idKey: 'rectId', addFn: addDemoRectangle, applyFn: applyRect },
		{ label: 'Sector', idKey: 'sectorId', addFn: addDemoSector, applyFn: applySector },
		{ label: 'Circle', idKey: 'circleId', addFn: addDemoCircle, applyFn: applyCircle },
		{ label: 'Arrow', idKey: 'arrowId', addFn: addDemoArrow, applyFn: applyArrow },
	];

}

function reAddAllDemoShapes( shouldInvalidate = true ) {

	for ( const entry of getDemoShapeEntries() ) {

		if ( shapeIds[ entry.idKey ] != null ) continue;
		shapeIds[ entry.idKey ] = entry.addFn( shouldInvalidate );

	}

	if ( shouldInvalidate ) finalizeFixedDemoShapes( false );

}

function clearFixedDemoShapes() {

	if ( plotEditor?.isEditing ) plotEditor.cancelEdit();
	plotEditor?.deselect?.();
	plotEngine.stop();
	plotEngine.clearShapes();
	worldShapeIds.length = 0;
	localShapeIds.length = 0;
	terrainShapeIds.length = 0;
	modelShapeIds.length = 0;
	for ( const key of Object.keys( shapeIds ) ) shapeIds[ key ] = null;
	refreshEditorGui();

}

function finalizeFixedDemoShapes( frameCamera ) {

	plotEngine.invalidate();
	plotEngine.update();
	plotEngine.start();
	requestConditionalTilesUpdates();

	if ( ! frameCamera ) return;
	if ( params.targetMode === 'world' ) frameLocalTarget();
	else frameTerrain();

}

function addDemoShape( sourceShape, shouldInvalidate = true ) {

	const shape = prepareDemoShapeForTarget( sourceShape );
	let result;
	if ( params.targetMode === 'world' ) {

		result = addWorldShape( demoCartographicShapeToWorldShape( shape ), params.worldHeight, shouldInvalidate );

	} else if ( params.targetMode === 'tiles' ) {

		result = addTerrainShape( shape, shouldInvalidate );

	} else {

		result = addSurfaceShape( shape, shouldInvalidate );

	}

	return result?.id ?? null;

}

function prepareDemoShapeForTarget( sourceShape ) {

	const shape = {
		...sourceShape,
		coordinates: cloneCoordinates( sourceShape.coordinates || [] ),
		style: { ...( sourceShape.style || {} ) },
		userData: { ...( sourceShape.userData || {} ) },
	};

	if ( params.targetMode !== 'world' ) shape.style = metricStyleToCartographicStyle( shape );
	return shape;

}

function updateDemoShapeStyle( idKey, sourceShape ) {

	const id = shapeIds[ idKey ];
	if ( id == null || ! plotEngine.shapeStore.has( id ) ) return;
	const nextShape = prepareDemoShapeForTarget( sourceShape );
	plotEngine.updateShape( id, {
		style: nextShape.style,
	} );
	updateEditingSessionAfterExternalChange( id );
	requestConditionalTilesUpdates();

}

function removeDemoShape( idKey ) {

	const id = shapeIds[ idKey ];
	if ( id == null ) return;
	if ( plotEditor?.editingShapeId === id ) plotEditor.cancelEdit();
	if ( plotEditor?.selectedShapeId === id ) plotEditor.deselect();
	plotEngine.removeShape( id );
	removeShapeIdFromLists( id );
	shapeIds[ idKey ] = null;
	plotEngine.update();
	requestConditionalTilesUpdates();
	refreshEditorGui();

}

function removeShapeIdFromLists( id ) {

	for ( const list of [ worldShapeIds, localShapeIds, terrainShapeIds, modelShapeIds ] ) {

		const index = list.indexOf( id );
		if ( index !== - 1 ) list.splice( index, 1 );

	}

}

function updateEditingSessionAfterExternalChange( shapeId ) {

	if ( plotEditor?.editingShapeId === shapeId ) plotEditor._refreshSessionAfterExternalChange?.();

}

function cloneCoordinates( coordinates ) {

	return coordinates.map( point => [ ...point ] );

}

function cloneSourcePoints( points ) {

	return points.map( point => [ point[ 0 ], point[ 1 ] ] );

}

function getRectangleCenter() {

	let lon = 0;
	let lat = 0;
	for ( const point of TOUCH_GROUND_RECTANGLE_POINTS ) {

		lon += point[ 0 ];
		lat += point[ 1 ];

	}

	return [
		lon / TOUCH_GROUND_RECTANGLE_POINTS.length,
		lat / TOUCH_GROUND_RECTANGLE_POINTS.length,
	];

}

function percent( value ) {

	return MathUtils.clamp( Number( value ) || 0, 0, 100 ) / 100;

}

function visibleOpacity( visible, opacityPercent ) {

	return visible ? MathUtils.clamp( params.localOpacity * percent( opacityPercent ), 0, 1 ) : 0;

}

function fillStrokeStyle( prefix, visible, primaryOpacityPercent ) {

	const visibility = visible ? params.localOpacity : 0;
	return {
		units: 'meters',
		fillColor: S[ `${ prefix }FillColor` ],
		fillOpacity: visibility * percent( S[ `${ prefix }FillOpacity` ] ),
		strokeColor: S[ `${ prefix }StrokeColor` ],
		strokeWidth: S[ `${ prefix }StrokeWidth` ],
		strokeOpacity: visibility * percent( S[ `${ prefix }StrokeOpacity` ] ),
		opacity: visibleOpacity( visible, primaryOpacityPercent ),
	};

}

function lineStyle( prefix, visible ) {

	const strokeWidth = S[ `${ prefix }StrokeWidth` ];
	const strokeOpacity = S[ `${ prefix }StrokeOpacity` ];
	return {
		units: 'meters',
		fillColor: '#000000',
		strokeStyle: S[ `${ prefix }StrokeStyle` ],
		strokeColor: S[ `${ prefix }StrokeColor` ],
		strokeWidth,
		strokeOpacity: visible ? params.localOpacity * percent( strokeOpacity ) : 0,
		boundsPadding: strokeWidth * 0.5,
		opacity: visibleOpacity( visible, strokeOpacity ),
	};

}

function buildPointStyle() {

	return {
		...fillStrokeStyle( 'point', S.pointVisible, S.pointFillOpacity ),
		pointStyle: S.pointStyle,
		size: S.pointSize,
	};

}

function buildPolyStyle() {

	return fillStrokeStyle( 'poly', S.polyVisible, S.polyFillOpacity );

}

function buildRectStyle() {

	return {
		...fillStrokeStyle( 'rect', S.rectVisible, S.rectFillOpacity ),
		width: TOUCH_GROUND_RECT_WIDTH,
		height: TOUCH_GROUND_RECT_HEIGHT,
	};

}

function buildSectorStyle() {

	return {
		...fillStrokeStyle( 'sector', S.sectorVisible, S.sectorFillOpacity ),
		radius: S.sectorRadius,
		startAngle: S.sectorStartAngle * MathUtils.DEG2RAD,
		sectorAngle: S.sectorAngle * MathUtils.DEG2RAD,
	};

}

function buildCircleStyle() {

	return {
		...fillStrokeStyle( 'circle', S.circleVisible, S.circleFillOpacity ),
		radius: TOUCH_GROUND_CIRCLE_RADIUS,
	};

}

function buildArrowStyle() {

	return {
		...fillStrokeStyle( 'arrow', S.arrowVisible, S.arrowFillOpacity ),
		arrowType: S.arrowType,
		width: TOUCH_GROUND_ARROW_WIDTH,
		headLength: TOUCH_GROUND_ARROW_HEAD_LENGTH,
	};

}

function buildDemoPointShape() {

	return {
		id: 'touch-ground-point',
		kind: 'point',
		coordinates: [[ 120, 30 ]],
		style: buildPointStyle(),
	};

}

function buildDemoLineShape() {

	const first = TOUCH_GROUND_LINE_POINTS[ 0 ];
	const last = TOUCH_GROUND_LINE_POINTS[ TOUCH_GROUND_LINE_POINTS.length - 1 ];
	return {
		id: 'touch-ground-line',
		kind: 'line',
		coordinates: cloneSourcePoints( [ first, last ] ),
		style: lineStyle( 'line', S.lineVisible ),
	};

}

function buildDemoPolylineShape() {

	return {
		id: 'touch-ground-polyline',
		kind: 'polyline',
		coordinates: cloneSourcePoints( TOUCH_GROUND_LINE_POINTS ),
		style: lineStyle( 'polyline', S.polylineVisible ),
	};

}

function buildDemoPolygonShape() {

	return {
		id: 'touch-ground-polygon',
		kind: 'polygon',
		coordinates: cloneSourcePoints( TOUCH_GROUND_POLYGON_POINTS ),
		style: buildPolyStyle(),
	};

}

function buildDemoRectangleShape() {

	return {
		id: 'touch-ground-rectangle',
		kind: 'rectangle',
		coordinates: [ getRectangleCenter() ],
		style: buildRectStyle(),
		userData: {
			sourcePoints: cloneSourcePoints( TOUCH_GROUND_RECTANGLE_POINTS ),
		},
	};

}

function buildDemoSectorShape() {

	return {
		id: 'touch-ground-sector',
		kind: 'sector',
		coordinates: [[ 100.85, 22.65 ]],
		style: buildSectorStyle(),
	};

}

function buildDemoCircleShape() {

	return {
		id: 'touch-ground-circle',
		kind: 'circle',
		coordinates: [[ 100.95, 22.80 ]],
		style: buildCircleStyle(),
	};

}

function buildDemoArrowShape() {

	return {
		id: 'touch-ground-arrow',
		kind: 'arrow',
		coordinates: cloneSourcePoints( TOUCH_GROUND_ARROW_POINTS ),
		style: buildArrowStyle(),
	};

}

function addDemoPoint( shouldInvalidate = true ) {

	return addDemoShape( buildDemoPointShape(), shouldInvalidate );

}

function addDemoLine( shouldInvalidate = true ) {

	return addDemoShape( buildDemoLineShape(), shouldInvalidate );

}

function addDemoPolyline( shouldInvalidate = true ) {

	return addDemoShape( buildDemoPolylineShape(), shouldInvalidate );

}

function addDemoPolygon( shouldInvalidate = true ) {

	return addDemoShape( buildDemoPolygonShape(), shouldInvalidate );

}

function addDemoRectangle( shouldInvalidate = true ) {

	return addDemoShape( buildDemoRectangleShape(), shouldInvalidate );

}

function addDemoSector( shouldInvalidate = true ) {

	return addDemoShape( buildDemoSectorShape(), shouldInvalidate );

}

function addDemoCircle( shouldInvalidate = true ) {

	return addDemoShape( buildDemoCircleShape(), shouldInvalidate );

}

function addDemoArrow( shouldInvalidate = true ) {

	return addDemoShape( buildDemoArrowShape(), shouldInvalidate );

}

function applyPoint() {

	updateDemoShapeStyle( 'pointId', buildDemoPointShape() );

}

function applyLine() {

	updateDemoShapeStyle( 'lineId', buildDemoLineShape() );

}

function applyPolyline() {

	updateDemoShapeStyle( 'polylineId', buildDemoPolylineShape() );

}

function applyPoly() {

	updateDemoShapeStyle( 'polygonId', buildDemoPolygonShape() );

}

function applyRect() {

	updateDemoShapeStyle( 'rectId', buildDemoRectangleShape() );

}

function applySector() {

	updateDemoShapeStyle( 'sectorId', buildDemoSectorShape() );

}

function applyCircle() {

	updateDemoShapeStyle( 'circleId', buildDemoCircleShape() );

}

function applyArrow() {

	updateDemoShapeStyle( 'arrowId', buildDemoArrowShape() );

}

function applyAllDemoStyles() {

	for ( const entry of getDemoShapeEntries() ) entry.applyFn();

}

function updateAllShapeHeights( altitude ) {

	for ( const id of [ ...worldShapeIds, ...localShapeIds, ...terrainShapeIds, ...modelShapeIds ] ) {

		const shape = plotEngine.shapeStore.get( id );
		if ( ! shape ) continue;
		plotEngine.updateShape( id, {
			coordinates: ( shape.coordinates || [] ).map( point => [
				point[ 0 ],
				point[ 1 ],
				altitude,
			] ),
			style: {
				altitude,
			},
		} );
		updateEditingSessionAfterExternalChange( id );

	}

	requestConditionalTilesUpdates();

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

function metersToLonDegrees( meters, latDeg ) {

	return Number( meters ) / getDemoMetersPerDegreeLon( latDeg * MathUtils.DEG2RAD );

}

function metersToLatDegrees( meters ) {

	return Number( meters ) / METERS_PER_DEG_LAT;

}

function getShapeReferenceLatDeg( shape ) {

	const coordinates = shape.coordinates || [];
	let total = 0;
	let count = 0;
	for ( const point of coordinates ) {

		const lat = Number( point[ 1 ] );
		if ( ! Number.isFinite( lat ) ) continue;
		total += lat;
		count ++;

	}

	return count > 0 ? total / count : TOUCH_GROUND_FRAME_LAT_DEG;

}

function metricStyleToCartographicStyle( shape ) {

	const style = { ...( shape.style || {} ) };
	if ( style.units !== 'meters' ) return style;

	const lat = getShapeReferenceLatDeg( shape );
	for ( const key of [ 'size', 'strokeWidth', 'boundsPadding', 'radius', 'width', 'headLength' ] ) {

		if ( Number.isFinite( Number( style[ key ] ) ) ) style[ key ] = metersToLonDegrees( style[ key ], lat );

	}

	if ( Number.isFinite( Number( style.height ) ) ) style.height = metersToLatDegrees( style.height );
	delete style.units;
	return style;

}

function getDemoMetersPerDegreeLon( latRad ) {

	return Math.max( Math.cos( latRad ) * 111320, 1e-6 );

}

function cartographicDemoStyleToWorldStyle( shape ) {

	const style = { ...( shape.style || {} ) };
	if ( style.units === 'meters' ) {

		delete style.units;
		return style;

	}

	const metersPerDegreeLon = getDemoMetersPerDegreeLon( getShapeReferenceLatDeg( shape ) * MathUtils.DEG2RAD );
	if ( Number.isFinite( style.width ) ) style.width *= metersPerDegreeLon;
	if ( Number.isFinite( style.height ) ) style.height *= METERS_PER_DEG_LAT;
	if ( Number.isFinite( style.headLength ) ) style.headLength *= metersPerDegreeLon;
	if ( Number.isFinite( style.radius ) ) style.radius *= metersPerDegreeLon;
	if ( Number.isFinite( style.size ) ) style.size *= metersPerDegreeLon;
	if ( Number.isFinite( style.strokeWidth ) && style.strokeWidth <= 1 ) {

		style.strokeWidth = Math.max( style.strokeWidth * Math.min( metersPerDegreeLon, METERS_PER_DEG_LAT ), 2 );

	}

	if ( Number.isFinite( style.boundsPadding ) && style.boundsPadding <= 1 ) {

		style.boundsPadding *= Math.min( metersPerDegreeLon, METERS_PER_DEG_LAT );

	}

	return style;

}

function demoCartographicShapeToWorldShape( shape ) {

	return {
		...shape,
		coordinates: ( shape.coordinates || [] ).map( cartographicPointToWorldPoint ),
		style: cartographicDemoStyleToWorldStyle( shape ),
	};

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


function updateWorldHeight( value ) {

	const altitude = Number( value ) || 0;
	params.worldHeight = altitude;
	updateAllShapeHeights( altitude );
}


function addFillControls( folder, prefix, apply ) {

	folder.addColor( S, `${ prefix }FillColor` ).name( 'Fill' ).onChange( apply );
	folder.add( S, `${ prefix }FillOpacity`, 0, 100, 1 ).name( 'Fill Opacity' ).onChange( apply );

}

function addStrokeControls( folder, prefix, apply, maxWidth = 20 ) {

	folder.addColor( S, `${ prefix }StrokeColor` ).name( 'Stroke' ).onChange( apply );
	folder.add( S, `${ prefix }StrokeWidth`, 0, maxWidth, 1 ).name( 'Stroke Width' ).onChange( apply );
	folder.add( S, `${ prefix }StrokeOpacity`, 0, 100, 1 ).name( 'Stroke Opacity' ).onChange( apply );

}

function addVisibleToggle( folder, prefix, apply ) {

	folder.add( S, `${ prefix }Visible` ).name( 'Visible' ).onChange( apply );

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
			// 婵绮撻柌宥呯紦 demo shape閿涘矁顔€ single 濡€崇础娑旂喕鍏橀弽瑙勫祦 targetMode 閸掑洦宕?attachment
			// 閿涘澋orld / surface / tiles 娑撳顫?attachment 鐟欏棜顫庡顔煎焼閺勫孩妯夐垾鏂衡偓?
			//   world閿涙碍鍋撳ù顔兼躬 SoonCPS 娑撳﹦鈹栭敍娉倁rface閿涙俺鍒?Cesium 閸︽澘鑸伴敍娉僫les閿涙俺鍒?SoonCPS 濡€崇€烽敍?
			resetShapes( { frameCamera: false } );

		} );
	gui.add( params, 'showLocalBoard' ).name( 'Show local board' ).onChange( updateLocalBoardVisibility );
	gui.add( params, 'showTerrain' ).name( 'Show terrain' ).onChange( reinstantiateTiles );
	gui.add( params, 'showSoonModel' ).name( 'Show SoonCPS model' ).onChange( reinstantiateModelTiles );
	gui.add( params, 'localOpacity', 0, 1, 0.05 ).name( 'Global opacity' ).onChange( updateLocalOpacity );
	gui.add( params, 'worldHeight', - 2000, 10000, 10 ).name( 'World height' ).onChange( updateWorldHeight );
	gui.add( params, 'resetShapes' ).name( 'Reset shapes' );

	const ptF = gui.addFolder( 'Point' );
	ptF.add( S, 'pointStyle', [ 'circle', 'square' ] ).name( 'Style' ).onChange( applyPoint );
	ptF.add( S, 'pointSize', 100, 10000, 100 ).name( 'Size (m)' ).onChange( applyPoint );
	addFillControls( ptF, 'point', applyPoint );
	addStrokeControls( ptF, 'point', applyPoint );
	addVisibleToggle( ptF, 'point', applyPoint );

	const lnF = gui.addFolder( 'Line' );
	lnF.add( S, 'lineStrokeStyle', [ 'solid', 'dashed', 'dotted' ] ).name( 'Style' ).onChange( applyLine );
	addStrokeControls( lnF, 'line', applyLine, 30 );
	addVisibleToggle( lnF, 'line', applyLine );

	const plF = gui.addFolder( 'Polyline' );
	plF.add( S, 'polylineStrokeStyle', [ 'solid', 'dashed', 'dotted' ] ).name( 'Style' ).onChange( applyPolyline );
	addStrokeControls( plF, 'polyline', applyPolyline, 30 );
	addVisibleToggle( plF, 'polyline', applyPolyline );

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
	scF.add( S, 'sectorStartAngle', - 360, 360, 1 ).name( 'Start Angle' ).onChange( applySector );
	scF.add( S, 'sectorAngle', - 360, 360, 1 ).name( 'Sector Angle' ).onChange( applySector );
	addVisibleToggle( scF, 'sector', applySector );

	const ciF = gui.addFolder( 'Circle' );
	addFillControls( ciF, 'circle', applyCircle );
	addStrokeControls( ciF, 'circle', applyCircle );
	addVisibleToggle( ciF, 'circle', applyCircle );

	const arF = gui.addFolder( 'Arrow' );
	arF.add( S, 'arrowType', [ 'fine', 'curved', 'attack', 'straight' ] ).name( 'Type' ).onChange( applyArrow );
	addFillControls( arF, 'arrow', applyArrow );
	addStrokeControls( arF, 'arrow', applyArrow );
	addVisibleToggle( arF, 'arrow', applyArrow );

	const deleteFolder = gui.addFolder( 'Delete & Re-add' );
	const folderByIdKey = {
		pointId: [ ptF ],
		lineId: [ lnF ],
		polylineId: [ plF ],
		polygonId: [ pgF ],
		rectId: [ rcF ],
		sectorId: [ scF ],
		circleId: [ ciF ],
		arrowId: [ arF ],
	};

	for ( const entry of getDemoShapeEntries() ) {

		const actions = {
			delete: () => {

				removeDemoShape( entry.idKey );
				folderByIdKey[ entry.idKey ].forEach( folder => folder.hide() );

			},
			add: () => {

				if ( shapeIds[ entry.idKey ] != null ) return;
				shapeIds[ entry.idKey ] = entry.addFn();
				folderByIdKey[ entry.idKey ].forEach( folder => folder.show() );

			},
		};
		deleteFolder.add( actions, 'delete' ).name( `Delete ${ entry.label }` );
		deleteFolder.add( actions, 'add' ).name( `Re-add ${ entry.label }` );

	}

	deleteFolder.add( {
		clearAll: () => {

			clearFixedDemoShapes();
			plotEngine.start();
			for ( const folders of Object.values( folderByIdKey ) ) folders.forEach( folder => folder.hide() );

		},
	}, 'clearAll' ).name( 'Clear All' );

	deleteFolder.add( {
		reAddAll: () => {

			reAddAllDemoShapes();
			for ( const folders of Object.values( folderByIdKey ) ) folders.forEach( folder => folder.show() );

		},
	}, 'reAddAll' ).name( 'Re-add All' );

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
	editorFolder.add( params, 'editorBeginEdit' ).name( 'Begin edit selected' );
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

	applyAllDemoStyles();

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
	credits.innerText = `PlotEngine: ${ plotEngine.shapeStore.size }/${ DEMO_SHAPE_COUNT } shapes, mode=${ params.targetMode }, ${ terrainStatus }, ${ modelStatus }`;

}
