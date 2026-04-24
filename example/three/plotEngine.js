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
import { PlotEngine } from 'um-plot-engine';
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
let tiles, modelTiles, plotEngine, localTarget, localTargetVisuals;

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
	worldHeight: 0,
	demoPlotCount: DEFAULT_DEMO_PLOT_COUNT,
	targetMode: 'world',
	reloadTerrain: reinstantiateTiles,
	reloadSoonModel: reinstantiateModelTiles,
	focusLocalBoard: frameLocalTarget,
	focusTerrain: frameTerrain,
	focusSoonModel: frameSoonModel,
	resetShapes,
	randomizeLocal: randomizeLocalShapes,
};

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

	if ( params.targetMode === 'tiles' ) {

		addModelDemoShapes( frameCamera );

	} else if ( params.targetMode === 'world' ) {

		addWorldDemoShapes( frameCamera );

	} else {

		addSurfaceDemoShapes( frameCamera );

	}

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
	plotEngine.stop();
	plotEngine.clearShapes();
	worldShapeIds.length = 0;
	localShapeIds.length = 0;
	terrainShapeIds.length = 0;
	modelShapeIds.length = 0;

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
		...withDefaultHeight( shape, 0 ),
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
		...withDefaultHeight( shape, 0 ),
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
		...withDefaultHeight( shape, 0 ),
		attachment: {
			mode: 'tiles',
			targetId: SOONSPACE_TARGET_ID,
			fallbackTargetId: TERRAIN_TARGET_ID,
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

	params.worldHeight = Number( value );
	if ( params.targetMode === 'world' ) {

		resetShapes( { frameCamera: false } );

	}

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
			resetShapes( { frameCamera: false } );

		} );
	gui.add( params, 'showLocalBoard' ).name( 'Show local board' ).onChange( updateLocalBoardVisibility );
	gui.add( params, 'showTerrain' ).name( 'Show terrain' ).onChange( reinstantiateTiles );
	gui.add( params, 'showSoonModel' ).name( 'Show SoonCPS model' ).onChange( reinstantiateModelTiles );
	gui.add( params, 'localOpacity', 0.1, 1, 0.05 ).name( 'Local opacity' ).onChange( updateLocalOpacity );
	gui.add( params, 'worldHeight', - 2000, 10000, 10 ).name( 'World height' ).onChange( updateWorldHeight );
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
