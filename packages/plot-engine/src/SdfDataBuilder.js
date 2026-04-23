import {
	DataTexture,
	FloatType,
	NearestFilter,
	RGBAFormat,
} from 'three';

function createPaddedArray( values ) {

	const width = Math.max( 1, Math.ceil( values.length / 4 ) );
	const data = new Float32Array( width * 4 );
	data.set( values );
	return { data, width };

}

export function buildSdfData( compiledShapes ) {

	const values = [ 0 ];
	let count = 0;

	for ( const compiled of compiledShapes ) {

		if ( ! compiled?.sdf ) continue;

		const payload = compiled.sdf.payload || [];
		const style = compiled.sdf.style || {};
		const fill = style.fill || [ 1, 1, 1, 0.35 ];
		const stroke = style.stroke || [ 1, 1, 1, 1 ];
		const total = 12 + payload.length;

		values.push(
			compiled.sdf.type,
			total,
			fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
			stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
			style.strokeWidth ?? 1,
			style.opacity ?? 1,
			...payload,
		);

		count ++;

	}

	values[ 0 ] = count;
	return new Float32Array( values );

}

export function unpackSdfData( data ) {

	const shapes = [];
	const count = data[ 0 ] || 0;
	let offset = 1;

	for ( let index = 0; index < count; index ++ ) {

		const type = data[ offset ];
		const total = data[ offset + 1 ];
		const fill = Array.from( data.slice( offset + 2, offset + 6 ) );
		const stroke = Array.from( data.slice( offset + 6, offset + 10 ) );
		const strokeWidth = data[ offset + 10 ];
		const opacity = data[ offset + 11 ];
		const payload = Array.from( data.slice( offset + 12, offset + total ) );

		shapes.push( {
			type,
			total,
			style: { fill, stroke, strokeWidth, opacity },
			payload,
		} );

		offset += total;

	}

	return shapes;

}

export function buildSdfTexture( compiledShapes ) {

	const values = buildSdfData( compiledShapes );
	const { data, width } = createPaddedArray( values );
	const texture = new DataTexture( data, width, 1, RGBAFormat, FloatType );
	texture.minFilter = NearestFilter;
	texture.magFilter = NearestFilter;
	texture.needsUpdate = true;
	texture.userData.sourceLength = values.length;
	return texture;

}
