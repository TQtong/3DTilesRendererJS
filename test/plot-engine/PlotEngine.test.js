import { describe, expect, test } from 'vitest';
import {
	BoxGeometry,
	EventDispatcher,
	Group,
	Mesh,
	MeshBasicMaterial,
	Object3D,
} from 'three';
import { PlotEngine } from '../../packages/plot-engine/src/PlotEngine.js';

class MockTilesRenderer extends EventDispatcher {

	constructor( items = [] ) {

		super();
		this._items = items;

	}

	forEachLoadedModel( callback ) {

		for ( const item of this._items ) {

			callback( item.scene, item.tile );

		}

	}

}

function createLoadedTile() {

	const scene = new Group();
	const mesh = new Mesh( new BoxGeometry( 1, 1, 1 ), new MeshBasicMaterial() );
	scene.add( mesh );
	return {
		scene,
		tile: {
			boundingVolume: {
				region: [ 0, 0, Math.PI / 180, Math.PI / 180 ],
			},
			traversal: {
				visible: true,
			},
		},
		mesh,
	};

}

function createLoadedTileWithRegion( region ) {

	const loaded = createLoadedTile();
	loaded.tile.boundingVolume.region = region;
	return loaded;

}

describe( 'PlotEngine', () => {

	test( 'rebuilds tiled decals for loaded tile models and removes them on detach', () => {

		const loaded = createLoadedTile();
		const tilesRenderer = new MockTilesRenderer( [ loaded ] );
		const engine = new PlotEngine();

		engine.attachTilesRenderer( 'terrain', tilesRenderer, {
			geoReference: { kind: 'cartographic' },
		} );
		engine.addShape( {
			id: 'polygon-a',
			kind: 'polygon',
			coordinates: [
				[ 0.1, 0.1 ],
				[ 0.8, 0.1 ],
				[ 0.8, 0.8 ],
			],
			attachment: { mode: 'tiles', targetId: 'terrain' },
		} );
		engine.update();

		expect( loaded.scene.children.length ).toBe( 2 );
		const decal = loaded.scene.children.find( child => child !== loaded.mesh );
		expect( decal.name ).toContain( 'PlotEngine.TiledDecal' );

		tilesRenderer.dispatchEvent( {
			type: 'tile-visibility-change',
			tile: loaded.tile,
			scene: loaded.scene,
			visible: false,
		} );
		expect( decal.visible ).toBe( false );

		engine.detachTarget( 'terrain' );
		expect( loaded.scene.children ).toHaveLength( 1 );

	} );

	test( 'renders world and surface targets separately', () => {

		const engine = new PlotEngine();
		const objectTarget = new Object3D();

		engine.attachObjectTarget( 'mesh-target', objectTarget );
		engine.addShape( {
			id: 'world-point',
			kind: 'point',
			coordinates: [ [ 1, 2 ] ],
		} );
		engine.addShape( {
			id: 'surface-polygon',
			kind: 'polygon',
			coordinates: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ],
			attachment: { mode: 'surface', targetId: 'mesh-target' },
		} );

		engine.update();

		expect( engine.group.children[ 0 ].children.length ).toBe( 1 );
		expect( objectTarget.children.length ).toBe( 1 );
		expect( objectTarget.children[ 0 ].children.length ).toBe( 1 );

	} );

	test( 'supports multiple tiles renderers attached to one engine', () => {

		const loadedA = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const loadedB = createLoadedTileWithRegion( [ Math.PI / 90, 0, Math.PI / 60, Math.PI / 180 ] );
		const tilesRendererA = new MockTilesRenderer( [ loadedA ] );
		const tilesRendererB = new MockTilesRenderer( [ loadedB ] );
		const engine = new PlotEngine();

		const targetA = engine.attachTilesRenderer( 'terrain-a', tilesRendererA, {
			geoReference: { kind: 'cartographic' },
		} );
		const targetB = engine.attachTilesRenderer( 'terrain-b', tilesRendererB, {
			geoReference: { kind: 'cartographic' },
		} );

		expect( engine.targetRegistry.size ).toBe( 2 );
		expect( engine.targetRegistry.findByTilesRenderer( tilesRendererA ) ).toBe( targetA );
		expect( engine.targetRegistry.findByTilesRenderer( tilesRendererB ) ).toBe( targetB );

		engine.addShape( {
			id: 'polygon-a',
			kind: 'polygon',
			coordinates: [
				[ 0.1, 0.1 ],
				[ 0.8, 0.1 ],
				[ 0.8, 0.8 ],
			],
			attachment: { mode: 'tiles', targetId: 'terrain-a' },
		} );
		engine.addShape( {
			id: 'polygon-b',
			kind: 'polygon',
			coordinates: [
				[ 2.2, 0.1 ],
				[ 2.8, 0.1 ],
				[ 2.8, 0.8 ],
			],
			attachment: { mode: 'tiles', targetId: 'terrain-b' },
		} );

		engine.update();

		expect( loadedA.scene.children.length ).toBe( 2 );
		expect( loadedB.scene.children.length ).toBe( 2 );
		expect( loadedA.scene.children.find( child => child !== loadedA.mesh ).name ).toContain( 'terrain-a' );
		expect( loadedB.scene.children.find( child => child !== loadedB.mesh ).name ).toContain( 'terrain-b' );

		engine.detachTarget( 'terrain-a' );
		expect( loadedA.scene.children ).toHaveLength( 1 );
		expect( loadedB.scene.children ).toHaveLength( 2 );

		tilesRendererB.dispatchEvent( {
			type: 'tile-visibility-change',
			tile: loadedB.tile,
			scene: loadedB.scene,
			visible: false,
		} );
		expect( loadedB.scene.children.find( child => child !== loadedB.mesh ).visible ).toBe( false );

	} );

	test( 'rejects attaching the same tiles renderer twice', () => {

		const tilesRenderer = new MockTilesRenderer();
		const engine = new PlotEngine();

		engine.attachTilesRenderer( 'terrain-a', tilesRenderer, {
			geoReference: { kind: 'cartographic' },
		} );

		expect( () => engine.attachTilesRenderer( 'terrain-b', tilesRenderer ) )
			.toThrow( /already attached/ );

	} );

	test( 'incrementally rebuilds only affected tiles', () => {

		const loadedA = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const loadedB = createLoadedTileWithRegion( [ Math.PI / 90, 0, Math.PI / 60, Math.PI / 180 ] );
		const tilesRenderer = new MockTilesRenderer( [ loadedA, loadedB ] );
		const engine = new PlotEngine();

		engine.attachTilesRenderer( 'terrain', tilesRenderer, {
			geoReference: { kind: 'cartographic' },
		} );

		engine.addShape( {
			id: 'polygon-a',
			kind: 'polygon',
			coordinates: [
				[ 0.1, 0.1 ],
				[ 0.8, 0.1 ],
				[ 0.8, 0.8 ],
			],
			attachment: { mode: 'tiles', targetId: 'terrain' },
		} );
		engine.update();

		const decalA = loadedA.scene.children.find( child => child !== loadedA.mesh );
		const decalAGeometry = decalA.geometry;
		expect( loadedB.scene.children ).toHaveLength( 1 );

		engine.addShape( {
			id: 'polygon-b',
			kind: 'polygon',
			coordinates: [
				[ 2.2, 0.1 ],
				[ 2.8, 0.1 ],
				[ 2.8, 0.8 ],
			],
			attachment: { mode: 'tiles', targetId: 'terrain' },
		} );
		engine.update();

		expect( loadedA.scene.children.find( child => child !== loadedA.mesh ) ).toBe( decalA );
		expect( loadedA.scene.children.find( child => child !== loadedA.mesh ).geometry ).toBe( decalAGeometry );
		expect( loadedB.scene.children.length ).toBe( 2 );

	} );

	test( 'reuses tile decal geometry when only SDF data changes', () => {

		const loadedA = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const loadedB = createLoadedTileWithRegion( [ Math.PI / 90, 0, Math.PI / 60, Math.PI / 180 ] );
		const tilesRenderer = new MockTilesRenderer( [ loadedA, loadedB ] );
		const engine = new PlotEngine();

		engine.attachTilesRenderer( 'terrain', tilesRenderer, {
			geoReference: { kind: 'cartographic' },
		} );

		engine.addShape( {
			id: 'polygon-a',
			kind: 'polygon',
			coordinates: [
				[ 0.1, 0.1 ],
				[ 0.8, 0.1 ],
				[ 0.8, 0.8 ],
			],
			attachment: { mode: 'tiles', targetId: 'terrain' },
		} );
		engine.addShape( {
			id: 'polygon-b',
			kind: 'polygon',
			coordinates: [
				[ 2.2, 0.1 ],
				[ 2.8, 0.1 ],
				[ 2.8, 0.8 ],
			],
			attachment: { mode: 'tiles', targetId: 'terrain' },
		} );
		engine.update();

		const decalA = loadedA.scene.children.find( child => child !== loadedA.mesh );
		const decalB = loadedB.scene.children.find( child => child !== loadedB.mesh );
		const decalAGeometry = decalA.geometry;
		const decalBGeometry = decalB.geometry;

		engine.updateShape( 'polygon-a', {
			style: { fillColor: '#ff0000', strokeColor: '#00ff00' },
		} );
		engine.update();

		expect( loadedA.scene.children.find( child => child !== loadedA.mesh ) ).toBe( decalA );
		expect( loadedB.scene.children.find( child => child !== loadedB.mesh ) ).toBe( decalB );
		expect( decalA.geometry ).toBe( decalAGeometry );
		expect( decalB.geometry ).toBe( decalBGeometry );

	} );

} );
