import {
	boundsFromPoints,
	expandBounds,
	normalizeBounds,
} from '../utils/bounds.js';

export const SDF_TYPES = {
	rectangle: 0,
	circle: 1,
	polygon: 2,
	line: 3,
	text: 4,
	sector: 5,
	point: 6,
};

function point2( point ) {

	return [ Number( point[ 0 ] ), Number( point[ 1 ] ) ];

}

function flatPoints( points ) {

	const result = [];
	for ( const point of points ) {

		result.push( Number( point[ 0 ] ), Number( point[ 1 ] ) );

	}

	return result;

}

function parseColor( value, fallback ) {

	if ( Array.isArray( value ) ) {

		return [
			value[ 0 ] ?? fallback[ 0 ],
			value[ 1 ] ?? fallback[ 1 ],
			value[ 2 ] ?? fallback[ 2 ],
			value[ 3 ] ?? fallback[ 3 ],
		];

	}

	if ( typeof value === 'number' ) {

		return [
			( ( value >> 16 ) & 255 ) / 255,
			( ( value >> 8 ) & 255 ) / 255,
			( value & 255 ) / 255,
			1,
		];

	}

	if ( typeof value === 'string' && value.startsWith( '#' ) ) {

		let hex = value.slice( 1 );
		if ( hex.length === 3 ) {

			hex = hex.split( '' ).map( char => char + char ).join( '' );

		}

		return [
			parseInt( hex.slice( 0, 2 ), 16 ) / 255,
			parseInt( hex.slice( 2, 4 ), 16 ) / 255,
			parseInt( hex.slice( 4, 6 ), 16 ) / 255,
			1,
		];

	}

	return [ ...fallback ];

}

function styleBlock( style ) {

	const fill = parseColor( style.fillColor ?? style.color, [ 1, 1, 1, 0.35 ] );
	const stroke = parseColor( style.strokeColor ?? style.color, [ 1, 1, 1, 1 ] );
	fill[ 3 ] *= style.fillOpacity ?? style.opacity ?? 1;
	stroke[ 3 ] *= style.strokeOpacity ?? style.opacity ?? 1;

	return {
		fill,
		stroke,
		strokeWidth: style.strokeWidth ?? 1,
		opacity: style.opacity ?? 1,
	};

}

function wrapCompiled( shape, bounds, sdf, primitives = [] ) {

	const style = shape.style || {};
	const padding = style.boundsPadding ?? style.strokeWidthWorld ?? 0;
	const heightPoint = shape.coordinates?.find?.( point => point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) );

	return {
		id: shape.id,
		kind: shape.kind,
		revision: shape.revision,
		shape,
		attachment: { mode: 'world', ...shape.attachment },
		style,
		height: heightPoint ? Number( heightPoint[ 2 ] ) : Number( style.altitude ?? style.elevation ?? style.z ?? 0 ),
		bounds: expandBounds( bounds, padding ),
		sdf: {
			...sdf,
			style: styleBlock( style ),
		},
		primitives,
	};

}

function compilePoint( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 1 ) return null;
	const center = point2( coordinates[ 0 ] );
	const size = shape.style?.size ?? 1;
	const halfSize = size * 0.5;
	const bounds = [
		center[ 0 ] - halfSize,
		center[ 1 ] - halfSize,
		center[ 0 ] + halfSize,
		center[ 1 ] + halfSize,
	];

	return wrapCompiled( shape, bounds, {
		type: SDF_TYPES.point,
		payload: [ center[ 0 ], center[ 1 ], halfSize, halfSize, 0 ],
	}, [
		{ kind: 'point', points: [ center ] },
	] );

}

function compileLine( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 2 ) return null;
	const points = coordinates.map( point2 );
	const bounds = boundsFromPoints( points, shape.style?.boundsPadding ?? 0 );
	if ( ! bounds ) return null;

	return wrapCompiled( shape, bounds, {
		type: SDF_TYPES.line,
		payload: [ points.length, ...flatPoints( points ) ],
	}, [
		{ kind: 'line', points },
	] );

}

function compilePolygon( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 3 ) return null;
	const points = coordinates.map( point2 );
	const bounds = boundsFromPoints( points );
	if ( ! bounds ) return null;

	return wrapCompiled( shape, bounds, {
		type: SDF_TYPES.polygon,
		payload: [ points.length, ...flatPoints( points ) ],
	}, [
		{ kind: 'polygon', points },
	] );

}

function compileRectangle( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 1 ) return null;

	let bounds;
	if ( coordinates.length >= 2 ) {

		bounds = normalizeBounds( [
			coordinates[ 0 ][ 0 ],
			coordinates[ 0 ][ 1 ],
			coordinates[ 1 ][ 0 ],
			coordinates[ 1 ][ 1 ],
		] );

	} else {

		const center = point2( coordinates[ 0 ] );
		const width = shape.style?.width ?? 1;
		const height = shape.style?.height ?? width;
		bounds = [
			center[ 0 ] - width * 0.5,
			center[ 1 ] - height * 0.5,
			center[ 0 ] + width * 0.5,
			center[ 1 ] + height * 0.5,
		];

	}

	const centerX = ( bounds[ 0 ] + bounds[ 2 ] ) * 0.5;
	const centerY = ( bounds[ 1 ] + bounds[ 3 ] ) * 0.5;
	const halfWidth = ( bounds[ 2 ] - bounds[ 0 ] ) * 0.5;
	const halfHeight = ( bounds[ 3 ] - bounds[ 1 ] ) * 0.5;
	const points = [
		[ bounds[ 0 ], bounds[ 1 ] ],
		[ bounds[ 2 ], bounds[ 1 ] ],
		[ bounds[ 2 ], bounds[ 3 ] ],
		[ bounds[ 0 ], bounds[ 3 ] ],
	];

	return wrapCompiled( shape, bounds, {
		type: SDF_TYPES.rectangle,
		payload: [ centerX, centerY, halfWidth, halfHeight ],
	}, [
		{ kind: 'polygon', points },
	] );

}

function compileCircle( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 1 ) return null;
	const center = point2( coordinates[ 0 ] );
	const radius = shape.style?.radius ?? 1;
	const bounds = [
		center[ 0 ] - radius,
		center[ 1 ] - radius,
		center[ 0 ] + radius,
		center[ 1 ] + radius,
	];

	return wrapCompiled( shape, bounds, {
		type: SDF_TYPES.circle,
		payload: [ center[ 0 ], center[ 1 ], radius, radius ],
	}, [
		{ kind: 'circle', center, radius },
	] );

}

function compileSector( shape ) {

	const compiled = compileCircle( shape );
	if ( ! compiled ) return null;
	compiled.kind = 'sector';
	compiled.sdf.type = SDF_TYPES.sector;
	compiled.sdf.payload = [
		...compiled.sdf.payload,
		shape.style?.startAngle ?? 0,
		shape.style?.sectorAngle ?? Math.PI * 0.5,
	];
	return compiled;

}

function compileArrow( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 2 ) return null;

	const start = point2( coordinates[ 0 ] );
	const end = point2( coordinates[ coordinates.length - 1 ] );
	const heightPoint = coordinates.find( point => point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) );
	const height = heightPoint ? Number( heightPoint[ 2 ] ) : Number( shape.style?.altitude ?? shape.style?.elevation ?? shape.style?.z ?? 0 );
	const directionX = end[ 0 ] - start[ 0 ];
	const directionY = end[ 1 ] - start[ 1 ];
	const length = Math.hypot( directionX, directionY );
	if ( length === 0 ) return null;

	const normalX = - directionY / length;
	const normalY = directionX / length;
	const width = shape.style?.width ?? length * 0.08;
	const headLength = shape.style?.headLength ?? Math.min( length * 0.3, width * 4 );
	const neck = [
		end[ 0 ] - directionX / length * headLength,
		end[ 1 ] - directionY / length * headLength,
	];
	const points = [
		[ start[ 0 ] + normalX * width * 0.35, start[ 1 ] + normalY * width * 0.35 ],
		[ neck[ 0 ] + normalX * width, neck[ 1 ] + normalY * width ],
		end,
		[ neck[ 0 ] - normalX * width, neck[ 1 ] - normalY * width ],
		[ start[ 0 ] - normalX * width * 0.35, start[ 1 ] - normalY * width * 0.35 ],
	];
	for ( const point of points ) point[ 2 ] = height;

	const polygonShape = {
		...shape,
		kind: 'arrow',
		coordinates: points,
	};
	return compilePolygon( polygonShape );

}

export function registerDefaultCompilers( registry ) {

	registry.register( 'point', compilePoint );
	registry.register( 'line', compileLine );
	registry.register( 'polyline', compileLine );
	registry.register( 'polygon', compilePolygon );
	registry.register( 'rectangle', compileRectangle );
	registry.register( 'circle', compileCircle );
	registry.register( 'sector', compileSector );
	registry.register( 'arrow', compileArrow );
	return registry;

}
