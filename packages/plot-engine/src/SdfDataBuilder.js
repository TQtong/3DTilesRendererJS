import {
	DataTexture,
	FloatType,
	NearestFilter,
	RGBAFormat,
} from 'three';

const DEFAULT_MAX_TEXTURE_EDGE = 2048;

function createPaddedArray( values, options = {} ) {

	const texelCount = Math.max( 1, Math.ceil( values.length / 4 ) );
	const maxEdge = Math.max( 1, Math.floor( options.maxTextureEdge ?? DEFAULT_MAX_TEXTURE_EDGE ) );
	const width = Math.max( 1, Math.min( maxEdge, Math.ceil( Math.sqrt( texelCount ) ) ) );
	const height = Math.max( 1, Math.ceil( texelCount / width ) );
	const data = new Float32Array( width * height * 4 );
	data.set( values );
	return { data, width, height };

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
		const bounds = compiled.bounds || [ 0, 0, 0, 0 ];
		const total = 16 + payload.length;

		values.push(
			compiled.sdf.type,
			total,
			bounds[ 0 ], bounds[ 1 ], bounds[ 2 ], bounds[ 3 ],
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
		const bounds = Array.from( data.slice( offset + 2, offset + 6 ) );
		const fill = Array.from( data.slice( offset + 6, offset + 10 ) );
		const stroke = Array.from( data.slice( offset + 10, offset + 14 ) );
		const strokeWidth = data[ offset + 14 ];
		const opacity = data[ offset + 15 ];
		const payload = Array.from( data.slice( offset + 16, offset + total ) );

		shapes.push( {
			type,
			total,
			bounds,
			style: { fill, stroke, strokeWidth, opacity },
			payload,
		} );

		offset += total;

	}

	return shapes;

}

export function buildSdfTexture( compiledShapes, options = {} ) {

	const values = buildSdfData( compiledShapes );
	const { data, width, height } = createPaddedArray( values, options );
	const texture = new DataTexture( data, width, height, RGBAFormat, FloatType );
	texture.minFilter = NearestFilter;
	texture.magFilter = NearestFilter;
	texture.needsUpdate = true;
	texture.userData.sourceLength = values.length;
	texture.userData.mode = 'vector';
	return texture;

}
