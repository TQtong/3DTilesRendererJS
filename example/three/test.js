import {
	Scene,
	WebGLRenderer,
	PerspectiveCamera,
	AmbientLight,
	DirectionalLight,
} from 'three';
import { TilesRenderer, GlobeControls } from '3d-tiles-renderer';
import {
	TilesFadePlugin,
	UpdateOnChangePlugin,
	QuantizedMeshPlugin,
	ImageOverlayPlugin,
	UrlTemplateTilesOverlay,
} from '3d-tiles-renderer/plugins';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';

let controls, scene, renderer, camera, gui, tiles;
let imageOverlayPlugin;
let baseImageryOverlay, customImageryOverlay;

const TERRAIN_URL = 'https://sooncps.xwbuilders.com/api/ugis-dataprocess/v1/terrain/NhBLlMx3/';

const params = {
	baseImageryOpacity: 1.0,
	customImageryOpacity: 0.8,
	showCustomImagery: true,
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
	camera = new PerspectiveCamera( 60, window.innerWidth / window.innerHeight, 1, 2e8 );

	const ambientLight = new AmbientLight( 0xffffff, 2.0 );
	scene.add( ambientLight );

	const dirLight = new DirectionalLight( 0xffffff, 1.0 );
	dirLight.position.set( 1, 2, 3 );
	scene.add( dirLight );

	initTiles();
	buildGUI();

	window.addEventListener( 'resize', onWindowResize );

}

function initTiles() {

	baseImageryOverlay = new UrlTemplateTilesOverlay( {
		url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
		opacity: params.baseImageryOpacity,
	} );

	customImageryOverlay = new UrlTemplateTilesOverlay( {
		url: 'https://sooncps.xwbuilders.com/api/ugis-dataprocess/v1/image/wmts/3WI5gPWB/{z}/{x}/{y}',
		opacity: params.showCustomImagery ? params.customImageryOpacity : 0,
	} );

	imageOverlayPlugin = new ImageOverlayPlugin( {
		overlays: [ baseImageryOverlay, customImageryOverlay ],
	} );

	tiles = new TilesRenderer( TERRAIN_URL );
	tiles.registerPlugin( new TilesFadePlugin() );
	tiles.registerPlugin( new UpdateOnChangePlugin() );
	tiles.registerPlugin( new QuantizedMeshPlugin() );
	tiles.registerPlugin( imageOverlayPlugin );

	tiles.group.rotation.x = - Math.PI / 2;
	scene.add( tiles.group );

	controls = new GlobeControls( scene, camera, renderer.domElement );
	controls.setEllipsoid( tiles.ellipsoid, tiles.group );
	controls.enableDamping = true;
	controls.camera.position.set( 0, 0, 1.75 * 1e7 );
	controls.camera.quaternion.identity();
	controls.minDistance = 150;

	tiles.setCamera( camera );

}

function buildGUI() {

	gui = new GUI();

	const baseFolder = gui.addFolder( 'Base Imagery (ESRI)' );
	baseFolder.add( params, 'baseImageryOpacity', 0, 1, 0.1 )
		.name( 'Opacity' )
		.onChange( ( v ) => {

			baseImageryOverlay.opacity = v;

		} );
	baseFolder.open();

	const customFolder = gui.addFolder( 'Custom Imagery Overlay' );
	customFolder.add( params, 'showCustomImagery' )
		.name( 'Visible' )
		.onChange( ( v ) => {

			customImageryOverlay.opacity = v ? params.customImageryOpacity : 0;

		} );
	customFolder.add( params, 'customImageryOpacity', 0, 1, 0.1 )
		.name( 'Opacity' )
		.onChange( ( v ) => {

			if ( params.showCustomImagery ) {

				customImageryOverlay.opacity = v;

			}

		} );
	customFolder.open();

	document.getElementById( 'info' ).innerHTML =
		'<b>Terrain + UrlTemplate Imagery Test</b><br/>' +
		'Terrain: Custom Quantized Mesh<br/>' +
		'Base Imagery: ESRI (UrlTemplateTilesOverlay)<br/>' +
		'Custom Overlay: Your WMTS';

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
