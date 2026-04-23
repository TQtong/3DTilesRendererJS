import { describe, expect, test } from 'vitest';
import { ShapeStore } from '../../packages/plot-engine/src/ShapeStore.js';

describe( 'ShapeStore', () => {

	test( 'adds shapes with world attachment by default', () => {

		const store = new ShapeStore();
		const shape = store.add( {
			id: 'shape-a',
			kind: 'point',
			coordinates: [ [ 10, 20 ] ],
		} );

		expect( shape.id ).toBe( 'shape-a' );
		expect( shape.attachment.mode ).toBe( 'world' );
		expect( store.size ).toBe( 1 );
		expect( store.revision ).toBe( 1 );

	} );

	test( 'updates nested style and attachment fields', () => {

		const store = new ShapeStore();
		store.add( {
			id: 'shape-b',
			kind: 'line',
			coordinates: [ [ 0, 0 ], [ 1, 1 ] ],
			style: { color: '#ffffff' },
			attachment: { mode: 'tiles', targetId: 'terrain' },
		} );

		const updated = store.update( 'shape-b', {
			style: { strokeWidth: 4 },
			attachment: { targetId: 'city' },
		} );

		expect( updated.style.color ).toBe( '#ffffff' );
		expect( updated.style.strokeWidth ).toBe( 4 );
		expect( updated.attachment.mode ).toBe( 'tiles' );
		expect( updated.attachment.targetId ).toBe( 'city' );
		expect( updated.revision ).toBe( 1 );

	} );

} );
