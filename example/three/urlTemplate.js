import {
	Scene,
	WebGLRenderer,
	PerspectiveCamera,
} from 'three';
import { TilesRenderer, GlobeControls, EnvironmentControls } from '3d-tiles-renderer';
import { TilesFadePlugin, UpdateOnChangePlugin, UrlTemplateTilesPlugin } from '3d-tiles-renderer/plugins';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let controls, scene, renderer, camera, gui, tiles;

const params = {
	source: 'osm',
	planar: false,
};

const sources = {
	osm: {
		url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
		label: 'OpenStreetMap',
	},
	carto_light: {
		url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
		subdomains: 'abcd',
		label: 'Carto Light',
	},
	carto_dark: {
		url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
		subdomains: 'abcd',
		label: 'Carto Dark',
	},
	stamen_terrain: {
		url: 'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png',
		label: 'Stamen Terrain',
	},
	esri_imagery: {
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		label: 'ESRI Imagery',
	},
	esri_topo: {
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
		label: 'ESRI Topo',
	},
	'custom-1': {
		url: 'https://sooncps.xwbuilders.com/api/ugis-dataprocess/v1/image/wmts/3WI5gPWB/{z}/{x}/{y}',
		label: 'Custom 1',
	}
};

init();

function init() {

	renderer = new WebGLRenderer( { antialias: true } );
	renderer.setPixelRatio( window.devicePixelRatio );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.setClearColor( 0x111111 );
	renderer.setAnimationLoop( render );
	document.body.appendChild( renderer.domElement );

	scene = new Scene();
	camera = new PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 0.001, 10000 );

	buildGUI();
	rebuildTiles();

	window.addEventListener( 'resize', onWindowResize );

}

function buildGUI() {

	if ( gui ) gui.destroy();
	gui = new GUI();

	gui.add( params, 'source', Object.keys( sources ) )
		.name( 'Tile Source' )
		.onChange( rebuildTiles );

	gui.add( params, 'planar' )
		.name( 'Planar View' )
		.onChange( rebuildTiles );

}

function rebuildTiles() {

	if ( tiles ) {

		tiles.dispose();
		tiles = null;

	}

	if ( controls ) {

		controls.dispose();
		controls = null;

	}

	const sourceConfig = sources[ params.source ];

	tiles = new TilesRenderer();
	tiles.registerPlugin( new TilesFadePlugin() );
	tiles.registerPlugin( new UpdateOnChangePlugin() );
	tiles.registerPlugin( new UrlTemplateTilesPlugin( {
		url: sourceConfig.url,
		subdomains: sourceConfig.subdomains,
		shape: params.planar ? 'planar' : 'ellipsoid',
		center: true,
	} ) );

	tiles.setCamera( camera );
	scene.add( tiles.group );

	if ( params.planar ) {

		controls = new EnvironmentControls( scene, camera, renderer.domElement );
		controls.enableDamping = true;
		controls.minDistance = 1e-4;
		controls.maxDistance = 5;
		controls.cameraRadius = 0;
		controls.fallbackPlane.normal.set( 0, 0, 1 );
		controls.up.set( 0, 0, 1 );
		controls.camera.position.set( 0, 0, 2 );
		controls.camera.quaternion.identity();

		camera.near = 1e-4;
		camera.far = 10;
		camera.updateProjectionMatrix();

	} else {

		tiles.group.rotation.x = - Math.PI / 2;

		controls = new GlobeControls( scene, camera, renderer.domElement );
		controls.setEllipsoid( tiles.ellipsoid, tiles.group );
		controls.enableDamping = true;
		controls.camera.position.set( 0, 0, 1.75 * 1e7 );
		controls.camera.quaternion.identity();
		controls.minDistance = 150;

	}

	document.getElementById( 'info' ).innerHTML =
		'<b>URL Template Tiles</b><br/>' + sourceConfig.label;

}

function onWindowResize() {

	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );

}

function render() {

	if ( controls ) {

		controls.update();
		camera.updateMatrixWorld();

	}

	if ( tiles ) {

		tiles.setCamera( camera );
		tiles.setResolutionFromRenderer( camera, renderer );
		tiles.update();

	}

	renderer.render( scene, camera );

}
