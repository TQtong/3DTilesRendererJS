import { describe, expect, test } from 'vitest';
import { buildSdfData, buildSdfTexture, unpackSdfData } from '../../packages/plot-engine/src/SdfDataBuilder.js';

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

	test( 'builds sdf textures with bounded 2d dimensions', () => {

		const payload = Array.from( { length: 20000 }, ( _, index ) => index * 0.1 );
		const texture = buildSdfTexture( [
			{
				bounds: [ 0, 0, 1, 1 ],
				sdf: {
					type: 2,
					payload,
					style: {
						fill: [ 1, 0, 0, 0.5 ],
						stroke: [ 0, 1, 0, 1 ],
						strokeWidth: 2,
						opacity: 0.75,
					},
				},
			},
		] );

		expect( texture.image.width ).toBeLessThanOrEqual( 2048 );
		expect( texture.image.height ).toBeGreaterThan( 1 );
		expect( texture.image.width * texture.image.height * 4 ).toBeGreaterThanOrEqual( 20017 );

	} );

} );
