const FITTING_COUNT = 100;
const ZERO_TOLERANCE = 0.0001;

export function MathDistance( p1, p2 ) {

	return Math.sqrt( ( p1[ 0 ] - p2[ 0 ] ) ** 2 + ( p1[ 1 ] - p2[ 1 ] ) ** 2 );

}

export function wholeDistance( points ) {

	let d = 0;
	for ( let i = 0; i < points.length - 1; i ++ ) {

		d += MathDistance( points[ i ], points[ i + 1 ] );

	}

	return d;

}

export function getBaseLength( points ) {

	return wholeDistance( points ) ** 0.99;

}

export function Mid( p1, p2 ) {

	return [ ( p1[ 0 ] + p2[ 0 ] ) / 2, ( p1[ 1 ] + p2[ 1 ] ) / 2 ];

}

export function getAzimuth( startPnt, endPnt ) {

	const angle = Math.asin(
		Math.abs( endPnt[ 1 ] - startPnt[ 1 ] ) / MathDistance( startPnt, endPnt )
	);
	if ( endPnt[ 1 ] >= startPnt[ 1 ] && endPnt[ 0 ] >= startPnt[ 0 ] ) return angle + Math.PI;
	if ( endPnt[ 1 ] >= startPnt[ 1 ] && endPnt[ 0 ] < startPnt[ 0 ] ) return Math.PI * 2 - angle;
	if ( endPnt[ 1 ] < startPnt[ 1 ] && endPnt[ 0 ] < startPnt[ 0 ] ) return angle;
	return Math.PI - angle;

}

export function getAngleOfThreePoints( a, b, c ) {

	const angle = getAzimuth( b, a ) - getAzimuth( b, c );
	return angle < 0 ? angle + Math.PI * 2 : angle;

}

export function isClockWise( p1, p2, p3 ) {

	return ( p3[ 1 ] - p1[ 1 ] ) * ( p2[ 0 ] - p1[ 0 ] ) > ( p2[ 1 ] - p1[ 1 ] ) * ( p3[ 0 ] - p1[ 0 ] );

}

export function getThirdPoint( startPnt, endPnt, angle, distance, clockWise ) {

	const azimuth = getAzimuth( startPnt, endPnt );
	const alpha = clockWise ? azimuth + angle : azimuth - angle;
	return [ endPnt[ 0 ] + distance * Math.cos( alpha ), endPnt[ 1 ] + distance * Math.sin( alpha ) ];

}

export function getNormal( p1, p2, p3 ) {

	let dX1 = p1[ 0 ] - p2[ 0 ], dY1 = p1[ 1 ] - p2[ 1 ];
	const d1 = Math.sqrt( dX1 * dX1 + dY1 * dY1 );
	dX1 /= d1; dY1 /= d1;
	let dX2 = p3[ 0 ] - p2[ 0 ], dY2 = p3[ 1 ] - p2[ 1 ];
	const d2 = Math.sqrt( dX2 * dX2 + dY2 * dY2 );
	dX2 /= d2; dY2 /= d2;
	return [ dX1 + dX2, dY1 + dY2 ];

}

export function getBisectorNormals( t, p1, p2, p3 ) {

	const normal = getNormal( p1, p2, p3 );
	const dist = Math.sqrt( normal[ 0 ] ** 2 + normal[ 1 ] ** 2 );
	const d1 = MathDistance( p1, p2 );
	const d2 = MathDistance( p2, p3 );
	let bisectorNormalRight, bisectorNormalLeft;

	if ( dist > ZERO_TOLERANCE ) {

		const uX = normal[ 0 ] / dist, uY = normal[ 1 ] / dist;
		if ( isClockWise( p1, p2, p3 ) ) {

			bisectorNormalRight = [ p2[ 0 ] - t * d1 * uY, p2[ 1 ] + t * d1 * uX ];
			bisectorNormalLeft = [ p2[ 0 ] + t * d2 * uY, p2[ 1 ] - t * d2 * uX ];

		} else {

			bisectorNormalRight = [ p2[ 0 ] + t * d1 * uY, p2[ 1 ] - t * d1 * uX ];
			bisectorNormalLeft = [ p2[ 0 ] - t * d2 * uY, p2[ 1 ] + t * d2 * uX ];

		}

	} else {

		bisectorNormalRight = [ p2[ 0 ] + t * ( p1[ 0 ] - p2[ 0 ] ), p2[ 1 ] + t * ( p1[ 1 ] - p2[ 1 ] ) ];
		bisectorNormalLeft = [ p2[ 0 ] + t * ( p3[ 0 ] - p2[ 0 ] ), p2[ 1 ] + t * ( p3[ 1 ] - p2[ 1 ] ) ];

	}

	return [ bisectorNormalRight, bisectorNormalLeft ];

}

function getLeftMostControlPoint( controlPoints, t ) {

	const [ p1, p2, p3 ] = [ controlPoints[ 0 ], controlPoints[ 1 ], controlPoints[ 2 ] ];
	const pnts = getBisectorNormals( 0, p1, p2, p3 );
	const normalRight = pnts[ 0 ];
	const normal = getNormal( p1, p2, p3 );
	const dist = Math.sqrt( normal[ 0 ] ** 2 + normal[ 1 ] ** 2 );

	if ( dist > ZERO_TOLERANCE ) {

		const mid = Mid( p1, p2 );
		const pX = p1[ 0 ] - mid[ 0 ], pY = p1[ 1 ] - mid[ 1 ];
		const n = 2.0 / MathDistance( p1, p2 );
		const nX = - n * pY, nY = n * pX;
		const a11 = nX * nX - nY * nY, a12 = 2 * nX * nY, a22 = nY * nY - nX * nX;
		const dX = normalRight[ 0 ] - mid[ 0 ], dY = normalRight[ 1 ] - mid[ 1 ];
		return [ mid[ 0 ] + a11 * dX + a12 * dY, mid[ 1 ] + a12 * dX + a22 * dY ];

	}

	return [ p1[ 0 ] + t * ( p2[ 0 ] - p1[ 0 ] ), p1[ 1 ] + t * ( p2[ 1 ] - p1[ 1 ] ) ];

}

function getRightMostControlPoint( controlPoints, t ) {

	const count = controlPoints.length;
	const [ p1, p2, p3 ] = [ controlPoints[ count - 3 ], controlPoints[ count - 2 ], controlPoints[ count - 1 ] ];
	const pnts = getBisectorNormals( 0, p1, p2, p3 );
	const normalLeft = pnts[ 1 ];
	const normal = getNormal( p1, p2, p3 );
	const dist = Math.sqrt( normal[ 0 ] ** 2 + normal[ 1 ] ** 2 );

	if ( dist > ZERO_TOLERANCE ) {

		const mid = Mid( p2, p3 );
		const pX = p3[ 0 ] - mid[ 0 ], pY = p3[ 1 ] - mid[ 1 ];
		const n = 2.0 / MathDistance( p2, p3 );
		const nX = - n * pY, nY = n * pX;
		const a11 = nX * nX - nY * nY, a12 = 2 * nX * nY, a22 = nY * nY - nX * nX;
		const dX = normalLeft[ 0 ] - mid[ 0 ], dY = normalLeft[ 1 ] - mid[ 1 ];
		return [ mid[ 0 ] + a11 * dX + a12 * dY, mid[ 1 ] + a12 * dX + a22 * dY ];

	}

	return [ p3[ 0 ] + t * ( p2[ 0 ] - p3[ 0 ] ), p3[ 1 ] + t * ( p2[ 1 ] - p3[ 1 ] ) ];

}

export function getCurvePoints( t, controlPoints ) {

	const leftControl = getLeftMostControlPoint( controlPoints, t );
	let normals = [ leftControl ];
	for ( let i = 0; i < controlPoints.length - 2; i ++ ) {

		const ns = getBisectorNormals( t, controlPoints[ i ], controlPoints[ i + 1 ], controlPoints[ i + 2 ] );
		normals = normals.concat( ns );

	}

	const rightControl = getRightMostControlPoint( controlPoints, t );
	if ( rightControl ) normals.push( rightControl );

	const points = [];
	for ( let i = 0; i < controlPoints.length - 1; i ++ ) {

		const p1 = controlPoints[ i ], p2 = controlPoints[ i + 1 ];
		points.push( p1 );
		for ( let j = 0; j < FITTING_COUNT; j ++ ) {

			const tt = j / FITTING_COUNT;
			const tp = 1 - tt, t2 = tt * tt, t3 = t2 * tt, tp2 = tp * tp, tp3 = tp2 * tp;
			const c1 = normals[ i * 2 ], c2 = normals[ i * 2 + 1 ];
			points.push( [
				tp3 * p1[ 0 ] + 3 * tp2 * tt * c1[ 0 ] + 3 * tp * t2 * c2[ 0 ] + t3 * p2[ 0 ],
				tp3 * p1[ 1 ] + 3 * tp2 * tt * c1[ 1 ] + 3 * tp * t2 * c2[ 1 ] + t3 * p2[ 1 ],
			] );

		}

		points.push( p2 );

	}

	return points;

}

function getQuadricBSplineFactor( k, t ) {

	if ( k === 0 ) return ( t - 1 ) ** 2 / 2;
	if ( k === 1 ) return ( - 2 * t ** 2 + 2 * t + 1 ) / 2;
	if ( k === 2 ) return t ** 2 / 2;
	return 0;

}

export function getQBSplinePoints( points ) {

	if ( points.length <= 2 ) return points;
	const result = [ points[ 0 ] ];
	const m = points.length - 3;
	for ( let i = 0; i <= m; i ++ ) {

		for ( let t = 0; t <= 1; t += 0.05 ) {

			let x = 0, y = 0;
			for ( let k = 0; k <= 2; k ++ ) {

				const f = getQuadricBSplineFactor( k, t );
				x += f * points[ i + k ][ 0 ];
				y += f * points[ i + k ][ 1 ];

			}

			result.push( [ x, y ] );

		}

	}

	result.push( points[ points.length - 1 ] );
	return result;

}

// ── Arrow shape generators ──
// Each returns an array of [lon, lat] pairs forming a closed polygon.

export function createStraightArrow( p1, p2, headSize ) {

	const distance = MathDistance( p1, p2 );
	let len = distance / 5;
	len = Math.min( len, headSize > 0 ? headSize * 0.01 : len );
	const leftPnt = getThirdPoint( p1, p2, Math.PI / 6, len / 2, false );
	const rightPnt = getThirdPoint( p1, p2, Math.PI / 6, len / 2, true );
	return [ p1, p2, leftPnt, p2, rightPnt ];

}

export function createFineArrow( p1, p2 ) {

	const len = getBaseLength( [ p1, p2 ] );
	const tailWidth = len * 0.1;
	const neckWidth = len * 0.2;
	const headWidth = len * 0.25;
	const headAngle = Math.PI / 8.5;
	const neckAngle = Math.PI / 13;

	const tailLeft = getThirdPoint( p2, p1, Math.PI / 2, tailWidth, true );
	const tailRight = getThirdPoint( p2, p1, Math.PI / 2, tailWidth, false );
	const headLeft = getThirdPoint( p1, p2, headAngle, headWidth, false );
	const headRight = getThirdPoint( p1, p2, headAngle, headWidth, true );
	const neckLeft = getThirdPoint( p1, p2, neckAngle, neckWidth, false );
	const neckRight = getThirdPoint( p1, p2, neckAngle, neckWidth, true );

	return [ tailLeft, neckLeft, headLeft, p2, headRight, neckRight, tailRight, p1 ];

}

function downsample( points, maxCount ) {

	if ( points.length <= maxCount ) return points;
	const result = [ points[ 0 ] ];
	const step = ( points.length - 1 ) / ( maxCount - 1 );
	for ( let i = 1; i < maxCount - 1; i ++ ) {

		result.push( points[ Math.round( i * step ) ] );

	}

	result.push( points[ points.length - 1 ] );
	return result;

}

export function createCurvedArrow( lnglatPoints ) {

	if ( lnglatPoints.length === 2 ) {

		return createFineArrow( lnglatPoints[ 0 ], lnglatPoints[ 1 ] );

	}

	const rawCurve = getCurvePoints( 0.3, lnglatPoints );
	const curvePoints = downsample( rawCurve, 25 );
	const totalLen = wholeDistance( curvePoints );

	const tailWidthFactor = 0.08;
	const neckWidthFactor = 0.12;
	const headWidthFactor = 0.2;
	const headAngle = Math.PI / 8.5;
	const neckAngle = Math.PI / 13;
	const headLenFactor = 0.15;

	const tailW = totalLen * tailWidthFactor;
	const headLen = totalLen * headLenFactor;

	const leftSide = [];
	const rightSide = [];
	let accumulated = 0;
	const bodyEnd = totalLen - headLen;

	for ( let i = 0; i < curvePoints.length; i ++ ) {

		if ( i > 0 ) accumulated += MathDistance( curvePoints[ i - 1 ], curvePoints[ i ] );
		if ( accumulated > bodyEnd ) break;

		const t = bodyEnd > 0 ? accumulated / bodyEnd : 0;
		const w = tailW * ( 1 - t * 0.5 );

		const prev = i > 0 ? curvePoints[ i - 1 ] : curvePoints[ 0 ];
		const next = i < curvePoints.length - 1 ? curvePoints[ i + 1 ] : curvePoints[ i ];
		const dx = next[ 0 ] - prev[ 0 ], dy = next[ 1 ] - prev[ 1 ];
		const len = Math.sqrt( dx * dx + dy * dy ) || 1;
		const nx = - dy / len, ny = dx / len;

		leftSide.push( [ curvePoints[ i ][ 0 ] + nx * w, curvePoints[ i ][ 1 ] + ny * w ] );
		rightSide.push( [ curvePoints[ i ][ 0 ] - nx * w, curvePoints[ i ][ 1 ] - ny * w ] );

	}

	const tip = curvePoints[ curvePoints.length - 1 ];
	const beforeTip = curvePoints[ curvePoints.length - 2 ];
	const neckWidth = totalLen * neckWidthFactor;
	const headWidth = totalLen * headWidthFactor;
	const neckLeft = getThirdPoint( beforeTip, tip, neckAngle, neckWidth, false );
	const neckRight = getThirdPoint( beforeTip, tip, neckAngle, neckWidth, true );
	const headLeft = getThirdPoint( beforeTip, tip, headAngle, headWidth, false );
	const headRight = getThirdPoint( beforeTip, tip, headAngle, headWidth, true );

	return [ ...leftSide, neckLeft, headLeft, tip, headRight, neckRight, ...rightSide.reverse() ];

}

export function createAttackArrow( lnglatPoints ) {

	let tailLeft = lnglatPoints[ 0 ], tailRight = lnglatPoints[ 1 ];
	if ( isClockWise( lnglatPoints[ 0 ], lnglatPoints[ 1 ], lnglatPoints[ 2 ] ) ) {

		tailLeft = lnglatPoints[ 1 ];
		tailRight = lnglatPoints[ 0 ];

	}

	const midTail = Mid( tailLeft, tailRight );
	const bonePnts = [ midTail, ...lnglatPoints.slice( 2 ) ];

	const headHeightFactor = 0.18, headWidthFactor = 0.3;
	const neckHeightFactor = 0.85, neckWidthFactor = 0.15;
	const headTailFactor = 0.8;

	let len = getBaseLength( bonePnts );
	let headHeight = len * headHeightFactor;
	const headPnt = bonePnts[ bonePnts.length - 1 ];
	len = MathDistance( headPnt, bonePnts[ bonePnts.length - 2 ] );
	const tailWidth = MathDistance( tailLeft, tailRight );
	if ( headHeight > tailWidth * headTailFactor ) headHeight = tailWidth * headTailFactor;
	const headWidth = headHeight * headWidthFactor;
	const neckWidth = headHeight * neckWidthFactor;
	headHeight = Math.min( headHeight, len );
	const neckHeight = headHeight * neckHeightFactor;

	const headEndPnt = getThirdPoint( bonePnts[ bonePnts.length - 2 ], headPnt, 0, headHeight, true );
	const neckEndPnt = getThirdPoint( bonePnts[ bonePnts.length - 2 ], headPnt, 0, neckHeight, true );
	const headLeft = getThirdPoint( headPnt, headEndPnt, Math.PI / 2, headWidth, false );
	const headRight = getThirdPoint( headPnt, headEndPnt, Math.PI / 2, headWidth, true );
	const neckLeft = getThirdPoint( headPnt, neckEndPnt, Math.PI / 2, neckWidth, false );
	const neckRight = getThirdPoint( headPnt, neckEndPnt, Math.PI / 2, neckWidth, true );
	const headPnts = [ neckLeft, headLeft, headPnt, headRight, neckRight ];

	const tailWidthFactor = tailWidth / getBaseLength( bonePnts );
	const allLen = wholeDistance( bonePnts );
	const bLen = getBaseLength( bonePnts );
	const tw = bLen * tailWidthFactor;
	const nw = MathDistance( neckLeft, neckRight );
	const widthDif = ( tw - nw ) / 2;
	let tempLen = 0;
	const leftBodyPnts = [], rightBodyPnts = [];
	for ( let i = 1; i < bonePnts.length - 1; i ++ ) {

		const angle = getAngleOfThreePoints( bonePnts[ i - 1 ], bonePnts[ i ], bonePnts[ i + 1 ] ) / 2;
		tempLen += MathDistance( bonePnts[ i - 1 ], bonePnts[ i ] );
		const w = ( tw / 2 - ( tempLen / allLen ) * widthDif ) / Math.sin( angle );
		leftBodyPnts.push( getThirdPoint( bonePnts[ i - 1 ], bonePnts[ i ], Math.PI - angle, w, true ) );
		rightBodyPnts.push( getThirdPoint( bonePnts[ i - 1 ], bonePnts[ i ], angle, w, false ) );

	}

	let leftPnts = [ tailLeft, ...leftBodyPnts, neckLeft ];
	let rightPnts = [ tailRight, ...rightBodyPnts, neckRight ];
	leftPnts = downsample( getQBSplinePoints( leftPnts ), 25 );
	rightPnts = downsample( getQBSplinePoints( rightPnts ), 25 );

	return [ ...leftPnts, ...headPnts, ...rightPnts.reverse() ];

}
