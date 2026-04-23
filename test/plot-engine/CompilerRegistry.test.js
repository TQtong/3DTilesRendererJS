import { describe, expect, test } from 'vitest';
import { CompilerRegistry } from '../../packages/plot-engine/src/CompilerRegistry.js';

describe( 'CompilerRegistry', () => {

	test( 'compiles arrow shapes into polygon sdf payloads', () => {

		const registry = new CompilerRegistry();
		const compiled = registry.compile( {
			id: 'arrow',
			kind: 'arrow',
			coordinates: [ [ 0, 0 ], [ 10, 0 ] ],
			style: { width: 2 },
			attachment: { mode: 'tiles', targetId: 'terrain' },
			revision: 0,
		} );

		expect( compiled.kind ).toBe( 'arrow' );
		expect( compiled.sdf.type ).toBe( 2 );
		expect( compiled.sdf.payload[ 0 ] ).toBeGreaterThanOrEqual( 3 );
		expect( compiled.bounds[ 2 ] ).toBeGreaterThan( compiled.bounds[ 0 ] );

	} );

} );
