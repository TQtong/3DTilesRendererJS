export function createEmptyBounds() {

	return [ Infinity, Infinity, - Infinity, - Infinity ];

}

export function isValidBounds( bounds ) {

	return Boolean( bounds ) &&
		Number.isFinite( bounds[ 0 ] ) &&
		Number.isFinite( bounds[ 1 ] ) &&
		Number.isFinite( bounds[ 2 ] ) &&
		Number.isFinite( bounds[ 3 ] ) &&
		bounds[ 0 ] <= bounds[ 2 ] &&
		bounds[ 1 ] <= bounds[ 3 ];

}

export function cloneBounds( bounds ) {

	return [ bounds[ 0 ], bounds[ 1 ], bounds[ 2 ], bounds[ 3 ] ];

}

export function normalizeBounds( bounds ) {

	const minX = Math.min( bounds[ 0 ], bounds[ 2 ] );
	const minY = Math.min( bounds[ 1 ], bounds[ 3 ] );
	const maxX = Math.max( bounds[ 0 ], bounds[ 2 ] );
	const maxY = Math.max( bounds[ 1 ], bounds[ 3 ] );
	return [ minX, minY, maxX, maxY ];

}

export function expandBounds( bounds, amount = 0 ) {

	return [
		bounds[ 0 ] - amount,
		bounds[ 1 ] - amount,
		bounds[ 2 ] + amount,
		bounds[ 3 ] + amount,
	];

}

export function unionBounds( left, right ) {

	if ( ! isValidBounds( left ) ) return cloneBounds( right );
	if ( ! isValidBounds( right ) ) return cloneBounds( left );
	return [
		Math.min( left[ 0 ], right[ 0 ] ),
		Math.min( left[ 1 ], right[ 1 ] ),
		Math.max( left[ 2 ], right[ 2 ] ),
		Math.max( left[ 3 ], right[ 3 ] ),
	];

}

export function intersectsBounds( left, right ) {

	if ( ! isValidBounds( left ) || ! isValidBounds( right ) ) return false;
	return ! (
		left[ 2 ] < right[ 0 ] ||
		left[ 0 ] > right[ 2 ] ||
		left[ 3 ] < right[ 1 ] ||
		left[ 1 ] > right[ 3 ]
	);

}

export function boundsFromPoints( points, fallbackSize = 0 ) {

	const bounds = createEmptyBounds();
	for ( const point of points || [] ) {

		if ( ! point ) continue;
		const x = Number( point[ 0 ] );
		const y = Number( point[ 1 ] );
		if ( ! Number.isFinite( x ) || ! Number.isFinite( y ) ) continue;

		bounds[ 0 ] = Math.min( bounds[ 0 ], x );
		bounds[ 1 ] = Math.min( bounds[ 1 ], y );
		bounds[ 2 ] = Math.max( bounds[ 2 ], x );
		bounds[ 3 ] = Math.max( bounds[ 3 ], y );

	}

	if ( ! isValidBounds( bounds ) ) return null;

	const hasWidth = bounds[ 0 ] !== bounds[ 2 ];
	const hasHeight = bounds[ 1 ] !== bounds[ 3 ];
	if ( hasWidth && hasHeight ) return bounds;

	const halfSize = fallbackSize * 0.5;
	return [
		bounds[ 0 ] - halfSize,
		bounds[ 1 ] - halfSize,
		bounds[ 2 ] + halfSize,
		bounds[ 3 ] + halfSize,
	];

}

export function boundsToItem( id, bounds, data = null ) {

	return {
		minX: bounds[ 0 ],
		minY: bounds[ 1 ],
		maxX: bounds[ 2 ],
		maxY: bounds[ 3 ],
		id,
		data,
	};

}

export function itemToBounds( item ) {

	return [ item.minX, item.minY, item.maxX, item.maxY ];

}
