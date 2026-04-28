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
import { WGS84_ELLIPSOID } from '../../src/three/renderer/math/GeoConstants.js';

class MockTilesRenderer extends EventDispatcher {

	constructor( items = [] ) {

		super();
		this._items = items;
		this.group = new Group();
		this.ellipsoid = WGS84_ELLIPSOID;
		for ( const item of items ) {

			this.group.add( item.scene );

		}

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

	test( 'wraps tile mesh material and adds plotUv attribute for tiles attachments', () => {

		const loaded = createLoadedTile();
		const tilesRenderer = new MockTilesRenderer( [ loaded ] );
		const engine = new PlotEngine();
		const originalMaterial = loaded.mesh.material;
		const originalGeometry = loaded.mesh.geometry;

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

		expect( loaded.scene.children.length ).toBe( 1 );
		expect( loaded.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();
		expect( typeof loaded.mesh.material.onBeforeCompile ).toBe( 'function' );

		engine.detachTarget( 'terrain' );
		expect( loaded.mesh.material ).toBe( originalMaterial );
		expect( loaded.mesh.geometry ).toBe( originalGeometry );

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

	test( 'batches world primitives sharing the same material', () => {

		const engine = new PlotEngine();

		engine.addShape( {
			id: 'world-point-a',
			kind: 'point',
			coordinates: [ [ 1, 2 ] ],
			style: { size: 8, strokeColor: '#22d3ee', opacity: 0.7 },
		} );
		engine.addShape( {
			id: 'world-point-b',
			kind: 'point',
			coordinates: [ [ 3, 4 ] ],
			style: { size: 8, strokeColor: '#22d3ee', opacity: 0.7 },
		} );

		engine.update();

		const batch = engine.group.children[ 0 ].children[ 0 ];
		expect( engine.group.children[ 0 ].children ).toHaveLength( 1 );
		expect( batch.isPoints ).toBe( true );
		expect( batch.geometry.getAttribute( 'position' ).count ).toBe( 2 );

	} );

	test( 'reuses pooled world materials across refreshes', () => {

		const engine = new PlotEngine();

		engine.addShape( {
			id: 'polygon-a',
			kind: 'polygon',
			coordinates: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ],
			style: { fillColor: '#f97316', opacity: 0.6 },
		} );
		engine.update();

		const firstMaterial = engine.group.children[ 0 ].children[ 0 ].material;

		engine.addShape( {
			id: 'polygon-b',
			kind: 'polygon',
			coordinates: [ [ 2, 0 ], [ 3, 0 ], [ 3, 1 ] ],
			style: { fillColor: '#f97316', opacity: 0.6 },
		} );
		engine.update();

		expect( engine.group.children[ 0 ].children[ 0 ].material ).toBe( firstMaterial );

	} );

	test( 'preserves local height for surface attachments on object targets', () => {

		const engine = new PlotEngine();
		const objectTarget = new Object3D();

		engine.attachObjectTarget( 'mesh-target', objectTarget );
		engine.addShape( {
			id: 'surface-polygon',
			kind: 'polygon',
			coordinates: [ [ 0, 0, 0.25 ], [ 1, 0, 0.25 ], [ 1, 1, 0.25 ] ],
			attachment: { mode: 'surface', targetId: 'mesh-target' },
		} );

		engine.update();

		const surfaceGroup = objectTarget.children[ 0 ];
		const surfaceMesh = surfaceGroup.children[ 0 ];
		const position = surfaceMesh.geometry.getAttribute( 'position' );

		for ( let index = 0; index < position.count; index ++ ) {

			expect( position.getY( index ) ).toBeCloseTo( 0.25 );

		}

	} );

	test( 'projects surface attachments through loaded terrain tile targets', () => {

		const loaded = createLoadedTile();
		const tilesRenderer = new MockTilesRenderer( [ loaded ] );
		const engine = new PlotEngine();
		const originalMaterial = loaded.mesh.material;
		const originalGeometry = loaded.mesh.geometry;

		engine.attachTilesRenderer( 'terrain', tilesRenderer, {
			geoReference: { kind: 'cartographic' },
		} );
		engine.addShape( {
			id: 'surface-polygon',
			kind: 'polygon',
			coordinates: [
				[ 0.1, 0.1 ],
				[ 0.8, 0.1 ],
				[ 0.8, 0.8 ],
			],
			attachment: { mode: 'surface', targetId: 'terrain' },
		} );
		engine.update();

		expect( loaded.scene.children.length ).toBe( 1 );
		expect( loaded.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();
		expect( typeof loaded.mesh.material.onBeforeCompile ).toBe( 'function' );
		expect( loaded.mesh.geometry ).not.toBe( originalGeometry );

		tilesRenderer.dispatchEvent( {
			type: 'tile-visibility-change',
			tile: loaded.tile,
			scene: loaded.scene,
			visible: false,
		} );
		expect( loaded.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();

		engine.detachTarget( 'terrain' );
		expect( loaded.mesh.material ).toBe( originalMaterial );
		expect( loaded.mesh.geometry ).toBe( originalGeometry );

	} );

	test( 'surface mode only paints the target terrain tiles', () => {

		const terrainLoaded = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const modelLoaded = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const terrainRenderer = new MockTilesRenderer( [ terrainLoaded ] );
		const modelRenderer = new MockTilesRenderer( [ modelLoaded ] );
		const engine = new PlotEngine();

		engine.attachTilesRenderer( 'terrain', terrainRenderer, {
			geoReference: { kind: 'cartographic' },
		} );
		engine.attachTilesRenderer( 'model', modelRenderer, {
			geoReference: { kind: 'cartographic' },
		} );

		engine.addShape( {
			id: 'surface-polygon',
			kind: 'polygon',
			coordinates: [
				[ 0.1, 0.1 ],
				[ 0.8, 0.1 ],
				[ 0.8, 0.8 ],
			],
			attachment: { mode: 'surface', targetId: 'terrain' },
		} );
		engine.update();

		expect( terrainLoaded.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();
		expect( modelLoaded.mesh.geometry.getAttribute( 'plotUv' ) ).toBeUndefined();

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

		expect( loadedA.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();
		expect( loadedB.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();

		engine.detachTarget( 'terrain-a' );
		expect( loadedB.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();

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

	test( 'incrementally rebuilds only tiles whose bounds intersect updated shapes', () => {

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

		const meshAGeometry = loadedA.mesh.geometry;
		expect( meshAGeometry.getAttribute( 'plotUv' ) ).toBeDefined();
		expect( loadedB.mesh.geometry.getAttribute( 'plotUv' ) ).toBeUndefined();

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

		expect( loadedA.mesh.geometry ).toBe( meshAGeometry );
		expect( loadedB.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();

	} );

	test( 'tiles mode only paints on primary target tiles', () => {

		const loadedA = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const loadedB = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const rendererA = new MockTilesRenderer( [ loadedA ] );
		const rendererB = new MockTilesRenderer( [ loadedB ] );
		const engine = new PlotEngine();

		engine.attachTilesRenderer( 'a', rendererA, {
			geoReference: { kind: 'cartographic' },
		} );
		engine.attachTilesRenderer( 'b', rendererB, {
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
			attachment: { mode: 'tiles', targetId: 'a' },
		} );
		engine.update();

		expect( loadedA.mesh.geometry.getAttribute( 'plotUv' ) ).toBeDefined();
		expect( loadedB.mesh.geometry.getAttribute( 'plotUv' ) ).toBeUndefined();

	} );

	test( 'reuses tile geometry when only style changes', () => {

		const loadedA = createLoadedTileWithRegion( [ 0, 0, Math.PI / 180, Math.PI / 180 ] );
		const tilesRenderer = new MockTilesRenderer( [ loadedA ] );
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

		const decoratedGeometry = loadedA.mesh.geometry;
		expect( decoratedGeometry.getAttribute( 'plotUv' ) ).toBeDefined();

		engine.updateShape( 'polygon-a', {
			style: { fillColor: '#ff0000', strokeColor: '#00ff00' },
		} );
		engine.update();

		expect( loadedA.mesh.geometry ).toBe( decoratedGeometry );

	} );

} );
