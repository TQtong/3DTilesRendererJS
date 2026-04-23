import { describe, expect, test } from 'vitest';
import { buildSdfData, unpackSdfData } from '../../packages/plot-engine/src/SdfDataBuilder.js';

describe( 'SdfDataBuilder', () => {

	test( 'packs and unpacks sdf blocks', () => {

		const data = buildSdfData( [
			{
				sdf: {
					type: 2,
					payload: [ 4, 0, 0, 1, 0, 1, 1, 0, 1 ],
					style: {
						fill: [ 1, 0, 0, 0.5 ],
						stroke: [ 0, 1, 0, 1 ],
						strokeWidth: 2,
						opacity: 0.75,
					},
				},
			},
		] );

		const unpacked = unpackSdfData( data );
		expect( data[ 0 ] ).toBe( 1 );
		expect( unpacked ).toHaveLength( 1 );
		expect( unpacked[ 0 ].type ).toBe( 2 );
		expect( unpacked[ 0 ].payload[ 0 ] ).toBe( 4 );
		expect( unpacked[ 0 ].style.strokeWidth ).toBe( 2 );

	} );

} );
