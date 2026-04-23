import { describe, expect, test } from 'vitest';
import { SpatialIndex } from '../../packages/plot-engine/src/SpatialIndex.js';

describe( 'SpatialIndex', () => {

	test( 'updates and queries tile intersections', () => {

		const index = new SpatialIndex();
		index.load( [
			{ id: 'a', bounds: [ 0, 0, 2, 2 ], attachment: { mode: 'tiles' } },
			{ id: 'b', bounds: [ 5, 5, 7, 7 ], attachment: { mode: 'tiles' } },
		] );

		expect( index.search( [ 1, 1, 3, 3 ] ).map( item => item.id ) ).toEqual( [ 'a' ] );

		index.update( 'b', [ 1.5, 1.5, 4, 4 ], { id: 'b', bounds: [ 1.5, 1.5, 4, 4 ] } );
		expect( index.search( [ 1, 1, 3, 3 ] ).map( item => item.id ).sort() ).toEqual( [ 'a', 'b' ] );

	} );

} );
