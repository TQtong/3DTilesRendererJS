import { describe, expect, test } from 'vitest';
import { Object3D, PerspectiveCamera } from 'three';
import { PlotEngine } from '../../packages/plot-engine/src/PlotEngine.js';
import { PlotEditor } from '../../packages/plot-engine/src/editor/PlotEditor.js';

function createRendererStub() {

	return {
		domElement: {
			style: {},
			addEventListener() {},
			removeEventListener() {},
			getBoundingClientRect() {

				return {
					left: 0,
					top: 0,
					width: 100,
					height: 100,
				};

			},
			setPointerCapture() {},
			releasePointerCapture() {},
		},
	};

}

function createEditor( engine ) {

	return new PlotEditor( {
		plotEngine: engine,
		camera: new PerspectiveCamera(),
		renderer: createRendererStub(),
		autoStart: false,
	} );

}

function createCartographicTilesRenderer() {

	return {
		group: new Object3D(),
		ellipsoid: {
			getObjectFrame( lat, lon, height, heading, pitch, roll, out ) {

				void lat;
				void lon;
				void height;
				void heading;
				void pitch;
				void roll;
				return out.identity();

			},
		},
		addEventListener() {},
		removeEventListener() {},
		forEachLoadedModel() {},
	};

}

describe( 'PlotEditor', () => {

	test( 'selects without starting an edit session or showing handles', () => {

		const engine = new PlotEngine();
		engine.addShape( {
			id: 'polygon-a',
			kind: 'polygon',
			coordinates: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ],
		} );
		engine.update();

		const editor = createEditor( engine );
		expect( editor.select( 'polygon-a' ) ).toBe( true );

		expect( editor.selectedShapeId ).toBe( 'polygon-a' );
		expect( editor.isEditing ).toBe( false );
		expect( editor._session ).toBe( null );
		expect( editor._selectionHighlight.group.parent ).toBe( engine.group );

		editor.dispose();
		engine.dispose();

	} );

	test( 'beginEdit keeps cold rendering visible and only mounts the handle layer', () => {

		const engine = new PlotEngine();
		const target = new Object3D();
		engine.attachObjectTarget( 'local-target', target, {
			geoReference: { kind: 'local' },
		} );
		engine.addShape( {
			id: 'surface-polygon',
			kind: 'polygon',
			coordinates: [ [ 0, 0 ], [ 1, 0 ], [ 1, 1 ] ],
			attachment: { mode: 'surface', targetId: 'local-target' },
		} );
		engine.update();

		const surfaceGroup = target.children.find( child => child.name === 'PlotEngine.SurfacePipe.local-target' );
		const coldObject = surfaceGroup.children[ 0 ];
		expect( coldObject.visible ).toBe( true );

		const editor = createEditor( engine );
		expect( editor.beginEdit( 'surface-polygon' ) ).toBe( true );

		expect( coldObject.visible ).toBe( true );
		expect( editor._session.sessionGroup.children ).toHaveLength( 1 );
		expect( editor._session.sessionGroup.children[ 0 ].name ).toBe( 'PlotEditor.HandleLayer' );
		expect( editor._session.handleLayer._buckets.get( 'vertex' ).count ).toBeGreaterThan( 0 );

		editor.dispose();
		engine.dispose();

	} );

	test( 'picks cartographic surface shapes in projected display coordinates', () => {

		const engine = new PlotEngine();
		const tilesRenderer = createCartographicTilesRenderer();
		engine.attachTilesRenderer( 'terrain', tilesRenderer, {
			geoReference: { kind: 'cartographic' },
		} );
		engine.addShape( {
			id: 'surface-polygon',
			kind: 'polygon',
			coordinates: [
				[ 109.999, 32.999 ],
				[ 110.001, 32.999 ],
				[ 110.001, 33.001 ],
				[ 109.999, 33.001 ],
			],
			attachment: { mode: 'surface', targetId: 'terrain' },
		} );

		const camera = new PerspectiveCamera( 60, 1, 0.1, 5000 );
		camera.position.set( 0, 1000, 1000 );
		camera.lookAt( 0, 0, 0 );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld( true );

		const editor = new PlotEditor( {
			plotEngine: engine,
			camera,
			renderer: createRendererStub(),
			autoStart: false,
		} );

		expect( editor.pickShapeAt( 50, 50 ) ).toBe( 'surface-polygon' );

		editor.dispose();
		engine.dispose();

	} );

} );
