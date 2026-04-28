/**
 * StyledGeoJSONOverlay 手动验证页面。
 *
 * 本页面只创建一个 StyledGeoJSONOverlay。页面启动时只加载一个普洱市区县
 * GeoJSON，后续通过 GUI 按需加载其他区县，并用 geojson-merge-ts 合并成一个
 * FeatureCollection 交给同一个 overlay。
 */
import { Scene, WebGLRenderer, PerspectiveCamera, MathUtils } from 'three';
import { TilesRenderer, GlobeControls, CAMERA_FRAME } from 'um-3d-tiles-renderer';
import {
	ImageOverlayPlugin,
	StyledGeoJSONOverlay,
	TilesFadePlugin,
	UpdateOnChangePlugin,
	XYZTilesPlugin,
} from 'um-3d-tiles-renderer/plugins';
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { merge } from 'geojson-merge-ts';

let scene, renderer, camera, controls, tiles, overlay, gui;

const info = document.getElementById( 'info' );
const PUER_CENTER = { lon: 100.9723, lat: 22.7776 };
const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };
// 使用影像底图，方便检查行政区边界贴到真实地表后的效果。
const IMAGERY_TILE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

// 这里按用户给出的 URL 顺序排列。默认只加载澜沧, 便于先观察单个区县的显示效果。
const AREA_DEFINITIONS = [
	{
		id: '530821',
		name: '宁洱哈尼族彝族自治县',
		color: '#22c55e',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530821.json',
	},
	{
		id: '530802',
		name: '思茅区',
		color: '#f97316',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530802.json',
	},
	{
		id: '530828',
		name: '澜沧拉祜族自治县',
		color: '#38bdf8',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530828.json',
	},
	{
		id: '530829',
		name: '西盟佤族自治县',
		color: '#a78bfa',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530829.json',
	},
	{
		id: '530827',
		name: '孟连傣族拉祜族佤族自治县',
		color: '#f43f5e',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530827.json',
	},
	{
		id: '530824',
		name: '景谷傣族彝族自治县',
		color: '#eab308',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530824.json',
	},
	{
		id: '530823',
		name: '景东彝族自治县',
		color: '#14b8a6',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530823.json',
	},
	{
		id: '530825',
		name: '镇沅彝族哈尼族拉祜族自治县',
		color: '#ec4899',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530825.json',
	},
	{
		id: '530822',
		name: '墨江哈尼族自治县',
		color: '#84cc16',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530822.json',
	},
	{
		id: '530826',
		name: '江城哈尼族彝族自治县',
		color: '#06b6d4',
		url: 'https://geo.datav.aliyun.com/areas_v3/bound/530826.json',
	},
];
const DEFAULT_AREA_ID = '530828';
const DEFAULT_AREA_DEFINITION = AREA_DEFINITIONS.find( definition => definition.id === DEFAULT_AREA_ID ) || AREA_DEFINITIONS[ 0 ];

const areaStates = new Map();
const areaStyles = new Map();
const areaControllers = [];
const styleControllers = [];
let syncToken = 0;
let isSyncing = false;
let lastMergeTime = 0;
let lastError = '';
let mergedCoordinateCount = 0;
let mergedGeometryTypes = '';
let activeStyleUpdateFrame = null;

const params = {
	activeAreaId: DEFAULT_AREA_DEFINITION.id,
	activeColor: DEFAULT_AREA_DEFINITION.color,
	activeFillOpacity: 0.38,
	activeStrokeColor: '#ffffff',
	activeStrokeWidth: 3,
	activePointZIndex: 1000 + AREA_DEFINITIONS.indexOf( DEFAULT_AREA_DEFINITION ),
	activeVisible: true,
	overlayOpacity: 1,
	loadOne: () => setEnabledAreaIds( [ DEFAULT_AREA_ID ] ),
	loadThree: () => setEnabledAreaCount( 3 ),
	loadFive: () => setEnabledAreaCount( 5 ),
	loadAll: () => setEnabledAreaCount( AREA_DEFINITIONS.length ),
	clearAll: () => setEnabledAreaCount( 0 ),
	reloadActiveArea,
	randomizeActiveStyle,
	focusLoadedAreas,
};

for ( const definition of AREA_DEFINITIONS ) {

	const enabledKey = getAreaEnabledKey( definition );
	params[ enabledKey ] = definition.id === DEFAULT_AREA_ID;
	areaStates.set( definition.id, {
		geojson: null,
		promise: null,
		error: '',
		bounds: null,
		featureIds: [],
		coordinateCount: 0,
		geometryTypes: [],
	} );
	areaStyles.set( definition.id, {
		visible: true,
		fillStyle: definition.color,
		fillOpacity: 0.38,
		strokeStyle: '#ffffff',
		strokeWidth: 3,
		strokeOpacity: 0.95,
		lineJoin: 'round',
		pointRadius: 7,
		pointStrokeWidth: 2,
		pointZIndex: 1000 + AREA_DEFINITIONS.indexOf( definition ),
		zIndex: AREA_DEFINITIONS.indexOf( definition ),
	} );

}

init();

function init() {

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x111111 );
	renderer.setAnimationLoop( render );
	document.body.appendChild( renderer.domElement );

	scene = new Scene();
	camera = new PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 160000000 );

	tiles = new TilesRenderer();
	tiles.registerPlugin( new UpdateOnChangePlugin() );
	tiles.registerPlugin( new TilesFadePlugin() );
	tiles.registerPlugin( new XYZTilesPlugin( {
		center: true,
		shape: 'ellipsoid',
		url: IMAGERY_TILE_URL,
	} ) );

	tiles.setCamera( camera );
	tiles.setResolutionFromRenderer( camera, renderer );
	tiles.group.rotation.x = - Math.PI / 2;
	tiles.group.updateMatrixWorld();
	scene.add( tiles.group );

	overlay = new StyledGeoJSONOverlay( {
		geojson: EMPTY_GEOJSON,
		color: '#ffffff',
		opacity: params.overlayOpacity,
		defaultStyle: {
			fillStyle: 'rgba( 255, 255, 255, 0.22 )',
			fillOpacity: 1,
			strokeStyle: '#ffffff',
			strokeWidth: 2,
			strokeOpacity: 1,
			pointRadius: 5,
			lineCap: 'round',
			lineJoin: 'round',
		},
	} );

	tiles.registerPlugin( new ImageOverlayPlugin( {
		overlays: [ overlay ],
		renderer,
		resolution: 512,
	} ) );

	controls = new GlobeControls( scene, camera, renderer.domElement );
	controls.setEllipsoid( tiles.ellipsoid, tiles.group );
	controls.enableDamping = true;

	frameCartographicLocation( PUER_CENTER.lat, PUER_CENTER.lon, 520000 );
	window.addEventListener( 'resize', onWindowResize, false );

	buildGUI();
	syncSelectedAreas( { focusAfterLoad: true } );

}

function buildGUI() {

	gui = new GUI();
	gui.width = 360;

	const dataFolder = gui.addFolder( '普洱区县 GeoJSON' );
	for ( const definition of AREA_DEFINITIONS ) {

		const enabledKey = getAreaEnabledKey( definition );
		const controller = dataFolder
			.add( params, enabledKey )
			.name( `${ definition.id } ${ definition.name }` )
			.onChange( () => syncSelectedAreas() );
		areaControllers.push( controller );

	}

	const presetFolder = gui.addFolder( '数量测试' );
	presetFolder.add( params, 'loadOne' ).name( '只加载 1 个' );
	presetFolder.add( params, 'loadThree' ).name( '加载前 3 个' );
	presetFolder.add( params, 'loadFive' ).name( '加载前 5 个' );
	presetFolder.add( params, 'loadAll' ).name( '加载全部 10 个' );
	presetFolder.add( params, 'clearAll' ).name( '清空 overlay' );

	const styleFolder = gui.addFolder( '单区县样式' );
	styleFolder
		.add( params, 'activeAreaId', getAreaOptions() )
		.name( '目标区县' )
		.onChange( refreshActiveStyleControls );
	styleControllers.push(
		styleFolder.addColor( params, 'activeColor' ).name( '填充颜色' ).onChange( applyActiveStyle ),
		styleFolder.add( params, 'activeFillOpacity', 0, 1, 0.01 ).name( '填充透明度' ).onChange( applyActiveStyle ),
		styleFolder.addColor( params, 'activeStrokeColor' ).name( '边线颜色' ).onChange( applyActiveStyle ),
		styleFolder.add( params, 'activeStrokeWidth', 0, 12, 1 ).name( '边线宽度' ).onChange( applyActiveStyle ),
		styleFolder.add( params, 'activePointZIndex', 0, 5000, 1 ).name( '点 zIndex' ).onFinishChange( applyActiveStyle ),
		styleFolder.add( params, 'activeVisible' ).name( '样式可见' ).onChange( applyActiveStyle ),
	);
	styleFolder.add( params, 'randomizeActiveStyle' ).name( '随机当前样式' );
	styleFolder.add( params, 'reloadActiveArea' ).name( '重新下载当前区县' );

	const viewFolder = gui.addFolder( '显示' );
	viewFolder.add( params, 'overlayOpacity', 0, 1, 0.01 ).name( 'Overlay 透明度' );
	viewFolder.add( params, 'focusLoadedAreas' ).name( '定位到已加载范围' );

}

function getAreaEnabledKey( definition ) {

	return `area${ definition.id }`;

}

function getAreaOptions() {

	const result = {};
	for ( const definition of AREA_DEFINITIONS ) {

		result[ `${ definition.id } ${ definition.name }` ] = definition.id;

	}

	return result;

}

function getEnabledDefinitions() {

	return AREA_DEFINITIONS.filter( definition => params[ getAreaEnabledKey( definition ) ] );

}

function setEnabledAreaCount( count ) {

	AREA_DEFINITIONS.forEach( ( definition, index ) => {

		params[ getAreaEnabledKey( definition ) ] = index < count;

	} );
	refreshAreaControllers();
	syncSelectedAreas( { focusAfterLoad: count > 0 } );

}

function setEnabledAreaIds( ids ) {

	const idSet = new Set( ids );
	AREA_DEFINITIONS.forEach( definition => {

		params[ getAreaEnabledKey( definition ) ] = idSet.has( definition.id );

	} );
	refreshAreaControllers();
	syncSelectedAreas( { focusAfterLoad: ids.length > 0 } );

}

function refreshAreaControllers() {

	for ( const controller of areaControllers ) {

		controller.updateDisplay();

	}

}

async function syncSelectedAreas( { focusAfterLoad = false } = {} ) {

	const token = ++ syncToken;
	const enabledDefinitions = getEnabledDefinitions();
	isSyncing = true;
	lastError = '';
	updateInfo();

	await Promise.all( enabledDefinitions.map( async definition => {

		try {

			await ensureAreaLoaded( definition );

		} catch ( error ) {

			const state = areaStates.get( definition.id );
			state.error = error.message || String( error );
			lastError = `${ definition.name }: ${ state.error }`;

		}

	} ) );

	if ( token !== syncToken ) {

		return;

	}

	commitMergedGeoJSON( enabledDefinitions );
	isSyncing = false;

	if ( focusAfterLoad && overlay.geojson.features.length > 0 ) {

		focusLoadedAreas();

	}

	updateInfo();

}

async function ensureAreaLoaded( definition ) {

	const state = areaStates.get( definition.id );
	if ( state.geojson ) {

		return state.geojson;

	}

	if ( state.promise ) {

		return state.promise;

	}

	state.error = '';
	state.promise = fetch( definition.url )
		.then( response => {

			if ( ! response.ok ) {

				throw new Error( `HTTP ${ response.status }` );

			}

			return response.json();

		} )
		.then( json => {

			state.geojson = decorateAreaGeoJSON( definition, json );
			state.bounds = getFeatureCollectionBounds( state.geojson );
			state.coordinateCount = countGeoJSONCoordinates( state.geojson );
			state.geometryTypes = getGeoJSONGeometryTypes( state.geojson );
			state.featureIds = state.geojson.features.map( feature => feature.id );
			return state.geojson;

		} )
		.finally( () => {

			state.promise = null;

		} );

	return state.promise;

}

function decorateAreaGeoJSON( definition, geojson ) {

	// geojson-merge-ts 可以把 Geometry、Feature、FeatureCollection 统一规范为 FeatureCollection。
	const normalized = merge( [ geojson ] );
	const style = areaStyles.get( definition.id );

	normalized.features = normalized.features.map( ( feature, index ) => {

		const featureId = normalized.features.length === 1 ? definition.id : `${ definition.id }-${ index }`;
		return applyAreaStyleToFeature( {
			...feature,
			id: featureId,
			properties: {
				...( feature.properties || {} ),
				areaId: definition.id,
				areaName: definition.name,
				sourceUrl: definition.url,
			},
		}, style );

	} );

	const adminPoint = getAreaAdminPoint( definition, normalized );
	if ( adminPoint ) {

		normalized.features.push( createAreaAdminPointFeature( definition, adminPoint, style ) );

	}

	return normalized;

}

function getAreaAdminPoint( definition, geojson ) {

	for ( const feature of geojson.features || [] ) {

		const properties = feature.properties || {};
		const point = normalizeLonLatPoint(
			properties.centroid ||
			properties.center ||
			properties.cp,
		);
		if ( point ) {

			return point;

		}

	}

	const bounds = getFeatureCollectionBounds( geojson );
	if ( bounds ) {

		const [ minLon, minLat, maxLon, maxLat ] = bounds;
		return [ ( minLon + maxLon ) * 0.5, ( minLat + maxLat ) * 0.5 ];

	}

	console.warn( `StyledGeoJSONOverlay demo: ${ definition.name } 没有可用行政点。` );
	return null;

}

function normalizeLonLatPoint( value ) {

	if ( ! Array.isArray( value ) || value.length < 2 ) {

		return null;

	}

	const lon = Number( value[ 0 ] );
	const lat = Number( value[ 1 ] );
	return Number.isFinite( lon ) && Number.isFinite( lat ) ? [ lon, lat ] : null;

}

function createAreaAdminPointFeature( definition, coordinates, style ) {

	return applyAreaStyleToFeature( {
		type: 'Feature',
		id: `${ definition.id }-admin-point`,
		properties: {
			areaId: definition.id,
			areaName: definition.name,
			sourceUrl: definition.url,
			isAdminPoint: true,
		},
		geometry: {
			type: 'Point',
			coordinates,
		},
	}, style );

}

function applyAreaStyleToFeature( feature, style ) {

	feature.properties = {
		...( feature.properties || {} ),
		...getAreaStylePatch( style, feature.properties && feature.properties.isAdminPoint === true ),
	};
	return feature;

}

function getAreaStylePatch( style, isAdminPoint = false ) {

	return {
		visible: style.visible,
		fillStyle: style.fillStyle,
		fillOpacity: style.fillOpacity,
		strokeStyle: style.strokeStyle,
		strokeWidth: style.strokeWidth,
		strokeOpacity: style.strokeOpacity,
		lineJoin: style.lineJoin,
		pointRadius: style.pointRadius,
		pointOpacity: 1,
		pointFillStyle: style.fillStyle,
		pointStrokeStyle: style.strokeStyle,
		pointStrokeWidth: style.pointStrokeWidth,
		zIndex: isAdminPoint ? style.pointZIndex : style.zIndex,
	};

}

function commitMergedGeoJSON( definitions = getEnabledDefinitions() ) {

	const startTime = performance.now();
	const inputs = [];
	let coordinateCount = 0;
	const geometryTypes = new Set();

	for ( const definition of definitions ) {

		const state = areaStates.get( definition.id );
		if ( ! state.geojson ) {

			continue;

		}

		inputs.push( state.geojson );
		coordinateCount += state.coordinateCount;
		for ( const type of state.geometryTypes ) {

			geometryTypes.add( type );

		}

	}

	const merged = inputs.length > 0 ? merge( inputs ) : EMPTY_GEOJSON;
	lastMergeTime = performance.now() - startTime;
	mergedCoordinateCount = coordinateCount;
	mergedGeometryTypes = [ ...geometryTypes ].join( ', ' ) || '-';
	overlay.setGeoJSON( merged );

}

function refreshActiveStyleControls() {

	const style = areaStyles.get( params.activeAreaId );
	if ( ! style ) {

		return;

	}

	params.activeColor = style.fillStyle;
	params.activeFillOpacity = style.fillOpacity;
	params.activeStrokeColor = style.strokeStyle;
	params.activeStrokeWidth = style.strokeWidth;
	params.activePointZIndex = style.pointZIndex;
	params.activeVisible = style.visible;

	for ( const controller of styleControllers ) {

		controller.updateDisplay();

	}

}

function applyActiveStyle() {

	if ( activeStyleUpdateFrame !== null ) {

		cancelAnimationFrame( activeStyleUpdateFrame );

	}

	activeStyleUpdateFrame = requestAnimationFrame( () => {

		activeStyleUpdateFrame = null;
		applyActiveStyleNow();

	} );

}

function applyActiveStyleNow() {

	const style = areaStyles.get( params.activeAreaId );
	if ( ! style ) {

		return;

	}

	const wasVisible = style.visible;
	style.visible = params.activeVisible;
	style.fillStyle = params.activeColor;
	style.fillOpacity = params.activeFillOpacity;
	style.strokeStyle = params.activeStrokeColor;
	style.strokeWidth = params.activeStrokeWidth;
	style.pointZIndex = params.activePointZIndex;

	const state = areaStates.get( params.activeAreaId );
	if ( state.geojson ) {

		const areaFeatureIds = [];
		const adminPointFeatureIds = [];
		for ( const feature of state.geojson.features ) {

			const isAdminPoint = feature.properties && feature.properties.isAdminPoint === true;
			if ( isAdminPoint ) {

				adminPointFeatureIds.push( feature.id );

			} else {

				areaFeatureIds.push( feature.id );

			}

		}

		if ( areaFeatureIds.length > 0 ) {

			overlay.updateFeatureStylesByIds( areaFeatureIds, getAreaStylePatch( style, false ) );

		}

		if ( adminPointFeatureIds.length > 0 ) {

			overlay.updateFeatureStylesByIds( adminPointFeatureIds, getAreaStylePatch( style, true ) );

		}

		if ( ! wasVisible && style.visible ) {

			// 从隐藏切回显示时, 有些瓦片之前可能因为 hasContent=false 没有分配 overlay 纹理。
			// 这种情况才需要让插件重新检查已加载瓦片；普通颜色/透明度变化不走这条慢路径。
			overlay.requestUpdate();

		}

	}

}

function randomizeActiveStyle() {

	params.activeColor = randomColor();
	params.activeFillOpacity = randomRange( 0.18, 0.62 );
	params.activeStrokeColor = '#ffffff';
	params.activeStrokeWidth = Math.round( randomRange( 1, 6 ) );
	params.activePointZIndex = Math.round( randomRange( 1000, 3000 ) );
	params.activeVisible = true;
	applyActiveStyle();
	refreshActiveStyleControls();

}

function reloadActiveArea() {

	const definition = AREA_DEFINITIONS.find( item => item.id === params.activeAreaId );
	if ( ! definition ) {

		return;

	}

	const state = areaStates.get( definition.id );
	state.geojson = null;
	state.bounds = null;
	state.featureIds = [];
	state.coordinateCount = 0;
	state.geometryTypes = [];
	params[ getAreaEnabledKey( definition ) ] = true;
	refreshAreaControllers();
	syncSelectedAreas( { focusAfterLoad: true } );

}

function focusLoadedAreas() {

	const bounds = getMergedEnabledBounds();
	if ( ! bounds ) {

		frameCartographicLocation( PUER_CENTER.lat, PUER_CENTER.lon, 520000 );
		return;

	}

	const [ minLon, minLat, maxLon, maxLat ] = bounds;
	const centerLon = ( minLon + maxLon ) * 0.5;
	const centerLat = ( minLat + maxLat ) * 0.5;
	const span = Math.max( maxLon - minLon, maxLat - minLat );
	const height = MathUtils.clamp( span * 155000, 90000, 900000 );
	frameCartographicLocation( centerLat, centerLon, height );

}

function frameCartographicLocation( latDeg, lonDeg, height ) {

	tiles.ellipsoid.getObjectFrame(
		latDeg * MathUtils.DEG2RAD,
		lonDeg * MathUtils.DEG2RAD,
		height,
		0,
		0.5 - Math.PI / 2,
		0,
		camera.matrixWorld,
		CAMERA_FRAME,
	);

	camera.matrixWorld
		.premultiply( tiles.group.matrixWorld )
		.decompose( camera.position, camera.quaternion, camera.scale );

	camera.updateMatrixWorld();
	if ( controls ) {

		controls.resetState();
		controls.needsUpdate = true;

	}

}

function getMergedEnabledBounds() {

	let result = null;
	for ( const definition of getEnabledDefinitions() ) {

		const bounds = areaStates.get( definition.id ).bounds;
		if ( bounds ) {

			result = unionBounds( result, bounds );

		}

	}

	return result;

}

function getFeatureCollectionBounds( geojson ) {

	let bounds = null;
	for ( const feature of geojson.features || [] ) {

		bounds = unionBounds( bounds, getGeometryBounds( feature.geometry ) );

	}

	return bounds;

}

function getGeometryBounds( geometry ) {

	if ( ! geometry ) {

		return null;

	}

	if ( geometry.type === 'GeometryCollection' ) {

		let bounds = null;
		for ( const child of geometry.geometries || [] ) {

			bounds = unionBounds( bounds, getGeometryBounds( child ) );

		}

		return bounds;

	}

	return getCoordinateBounds( geometry.coordinates );

}

function getCoordinateBounds( coordinates, bounds = null ) {

	if ( ! Array.isArray( coordinates ) ) {

		return bounds;

	}

	if ( typeof coordinates[ 0 ] === 'number' && typeof coordinates[ 1 ] === 'number' ) {

		const lon = coordinates[ 0 ];
		const lat = coordinates[ 1 ];
		if ( Number.isFinite( lon ) && Number.isFinite( lat ) ) {

			return unionBounds( bounds, [ lon, lat, lon, lat ] );

		}

		return bounds;

	}

	for ( const item of coordinates ) {

		bounds = getCoordinateBounds( item, bounds );

	}

	return bounds;

}

function unionBounds( a, b ) {

	if ( ! b ) {

		return a;

	}

	if ( ! a ) {

		return [ ...b ];

	}

	a[ 0 ] = Math.min( a[ 0 ], b[ 0 ] );
	a[ 1 ] = Math.min( a[ 1 ], b[ 1 ] );
	a[ 2 ] = Math.max( a[ 2 ], b[ 2 ] );
	a[ 3 ] = Math.max( a[ 3 ], b[ 3 ] );
	return a;

}

function countGeoJSONCoordinates( geojson ) {

	let count = 0;
	for ( const feature of geojson.features || [] ) {

		count += countGeometryCoordinates( feature.geometry );

	}

	return count;

}

function countGeometryCoordinates( geometry ) {

	if ( ! geometry ) {

		return 0;

	}

	if ( geometry.type === 'GeometryCollection' ) {

		return ( geometry.geometries || [] ).reduce( ( sum, child ) => sum + countGeometryCoordinates( child ), 0 );

	}

	return countCoordinatePairs( geometry.coordinates );

}

function countCoordinatePairs( coordinates ) {

	if ( ! Array.isArray( coordinates ) ) {

		return 0;

	}

	if ( typeof coordinates[ 0 ] === 'number' && typeof coordinates[ 1 ] === 'number' ) {

		return 1;

	}

	return coordinates.reduce( ( sum, item ) => sum + countCoordinatePairs( item ), 0 );

}

function getGeoJSONGeometryTypes( geojson ) {

	const result = new Set();
	for ( const feature of geojson.features || [] ) {

		collectGeometryTypes( feature.geometry, result );

	}

	return [ ...result ];

}

function collectGeometryTypes( geometry, target ) {

	if ( ! geometry ) {

		return;

	}

	target.add( geometry.type );
	if ( geometry.type === 'GeometryCollection' ) {

		for ( const child of geometry.geometries || [] ) {

			collectGeometryTypes( child, target );

		}

	}

}

function randomRange( min, max ) {

	return min + Math.random() * ( max - min );

}

function randomColor() {

	return `#${ Math.floor( Math.random() * 0xffffff ).toString( 16 ).padStart( 6, '0' ) }`;

}

function onWindowResize() {

	const aspect = window.innerWidth / window.innerHeight;
	camera.aspect = aspect;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

}

function updateInfo() {

	if ( ! overlay ) {

		return;

	}

	const source = overlay.imageSource;
	const enabledDefinitions = getEnabledDefinitions();
	const loadedDefinitions = enabledDefinitions.filter( definition => areaStates.get( definition.id ).geojson );
	const loadingDefinitions = enabledDefinitions.filter( definition => areaStates.get( definition.id ).promise );
	const loadedNames = loadedDefinitions.map( definition => definition.name ).join( '、' ) || '-';
	const loadingNames = loadingDefinitions.map( definition => definition.name ).join( '、' ) || '-';

	info.innerHTML = [
		`enabled json: ${ enabledDefinitions.length } / ${ AREA_DEFINITIONS.length }`,
		`loaded json: ${ loadedDefinitions.length }`,
		`loading: ${ isSyncing ? loadingNames : '-' }`,
		`features: ${ source.featureRecords.length }`,
		`coordinate pairs: ${ mergedCoordinateCount }`,
		`geometry types: ${ mergedGeometryTypes }`,
		`query hits: ${ source.lastQueriedFeatureCount }`,
		`drawn: ${ source.lastDrawnFeatureCount }`,
		`last redraw tiles: ${ source.lastRedrawTileCount }`,
		`merge time: ${ lastMergeTime.toFixed( 2 ) } ms`,
		`loaded areas: ${ loadedNames }`,
		lastError ? `error: ${ lastError }` : '',
	].filter( Boolean ).join( '<br>' );

}

function render() {

	if ( controls ) {

		controls.update();
		camera.updateMatrixWorld();

	}

	if ( tiles ) {

		tiles.setResolutionFromRenderer( camera, renderer );
		tiles.setCamera( camera );
		tiles.update();

	}

	if ( overlay ) {

		overlay.opacity = params.overlayOpacity;

	}

	if ( renderer ) {

		renderer.render( scene, camera );

	}

	updateInfo();

}
