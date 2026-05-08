// ============================================================
// arrows/arrowSpine.js — 箭头脊线工具（Catmull-Rom 致密化 + 弧长 + 法线）
// ============================================================
//
// 设计要点：
//   1. 使用向心 Catmull-Rom（α=0.5），样条严格穿过所有控制点，且不会出现 cusp（Yuksel 2011）
//   2. 致密化后顺带提供：累计弧长 / 切线 / 单位法线 —— 后续偏移阶段直接复用
//   3. 控制点退化（重合 / 仅 2 点 / 仅 1 点）有显式兜底，不会抛异常
//
// 公开 API:
//   catmullRomDense( points, options ) → { points, tangents, normals, arcLengths, totalLength }
//   findIndexAtArcLength( arcLengths, targetLength ) → index
//   linearDense( a, b, segments ) → 同上结构（Catmull-Rom 的 2 点退化）
//

const EPSILON = 1e-9;

function distance2D( a, b ) {

	const dx = b[ 0 ] - a[ 0 ];
	const dy = b[ 1 ] - a[ 1 ];
	return Math.sqrt( dx * dx + dy * dy );

}

// 向心 Catmull-Rom 子段：返回 t∈[0,1] 时段内某点的位置 + 切线
// p0,p1,p2,p3 是相邻 4 个控制点（p1,p2 是当前段端点）
// alpha=0.5 → centripetal；alpha=0 → uniform；alpha=1 → chordal
function catmullRomSegment( p0, p1, p2, p3, t, alpha ) {

	// 计算 tj 的累积参数
	const getT = ( ti, pi, pj ) => {

		const dx = pj[ 0 ] - pi[ 0 ];
		const dy = pj[ 1 ] - pi[ 1 ];
		const distance = Math.sqrt( dx * dx + dy * dy );
		return Math.pow( Math.max( distance, EPSILON ), alpha ) + ti;

	};

	const t0 = 0;
	const t1 = getT( t0, p0, p1 );
	const t2 = getT( t1, p1, p2 );
	const t3 = getT( t2, p2, p3 );

	if ( t1 - t0 < EPSILON || t2 - t1 < EPSILON || t3 - t2 < EPSILON ) {

		// 退化为线性插值
		const x = p1[ 0 ] + ( p2[ 0 ] - p1[ 0 ] ) * t;
		const y = p1[ 1 ] + ( p2[ 1 ] - p1[ 1 ] ) * t;
		const tx = p2[ 0 ] - p1[ 0 ];
		const ty = p2[ 1 ] - p1[ 1 ];
		return { point: [ x, y ], tangent: [ tx, ty ] };

	}

	const tt = t1 + ( t2 - t1 ) * t;

	// A1 = (t1-t)/(t1-t0)*p0 + (t-t0)/(t1-t0)*p1
	const a1x = ( t1 - tt ) / ( t1 - t0 ) * p0[ 0 ] + ( tt - t0 ) / ( t1 - t0 ) * p1[ 0 ];
	const a1y = ( t1 - tt ) / ( t1 - t0 ) * p0[ 1 ] + ( tt - t0 ) / ( t1 - t0 ) * p1[ 1 ];
	const a2x = ( t2 - tt ) / ( t2 - t1 ) * p1[ 0 ] + ( tt - t1 ) / ( t2 - t1 ) * p2[ 0 ];
	const a2y = ( t2 - tt ) / ( t2 - t1 ) * p1[ 1 ] + ( tt - t1 ) / ( t2 - t1 ) * p2[ 1 ];
	const a3x = ( t3 - tt ) / ( t3 - t2 ) * p2[ 0 ] + ( tt - t2 ) / ( t3 - t2 ) * p3[ 0 ];
	const a3y = ( t3 - tt ) / ( t3 - t2 ) * p2[ 1 ] + ( tt - t2 ) / ( t3 - t2 ) * p3[ 1 ];

	const b1x = ( t2 - tt ) / ( t2 - t0 ) * a1x + ( tt - t0 ) / ( t2 - t0 ) * a2x;
	const b1y = ( t2 - tt ) / ( t2 - t0 ) * a1y + ( tt - t0 ) / ( t2 - t0 ) * a2y;
	const b2x = ( t3 - tt ) / ( t3 - t1 ) * a2x + ( tt - t1 ) / ( t3 - t1 ) * a3x;
	const b2y = ( t3 - tt ) / ( t3 - t1 ) * a2y + ( tt - t1 ) / ( t3 - t1 ) * a3y;

	const px = ( t2 - tt ) / ( t2 - t1 ) * b1x + ( tt - t1 ) / ( t2 - t1 ) * b2x;
	const py = ( t2 - tt ) / ( t2 - t1 ) * b1y + ( tt - t1 ) / ( t2 - t1 ) * b2y;

	// 切线（数值微分）：用前后微小 t 求差分
	const dt = 0.001;
	const tt2 = t1 + ( t2 - t1 ) * Math.min( 1, t + dt );
	const tt1 = t1 + ( t2 - t1 ) * Math.max( 0, t - dt );
	const sample = u => {

		const a1xu = ( t1 - u ) / ( t1 - t0 ) * p0[ 0 ] + ( u - t0 ) / ( t1 - t0 ) * p1[ 0 ];
		const a1yu = ( t1 - u ) / ( t1 - t0 ) * p0[ 1 ] + ( u - t0 ) / ( t1 - t0 ) * p1[ 1 ];
		const a2xu = ( t2 - u ) / ( t2 - t1 ) * p1[ 0 ] + ( u - t1 ) / ( t2 - t1 ) * p2[ 0 ];
		const a2yu = ( t2 - u ) / ( t2 - t1 ) * p1[ 1 ] + ( u - t1 ) / ( t2 - t1 ) * p2[ 1 ];
		const a3xu = ( t3 - u ) / ( t3 - t2 ) * p2[ 0 ] + ( u - t2 ) / ( t3 - t2 ) * p3[ 0 ];
		const a3yu = ( t3 - u ) / ( t3 - t2 ) * p2[ 1 ] + ( u - t2 ) / ( t3 - t2 ) * p3[ 1 ];
		const b1xu = ( t2 - u ) / ( t2 - t0 ) * a1xu + ( u - t0 ) / ( t2 - t0 ) * a2xu;
		const b1yu = ( t2 - u ) / ( t2 - t0 ) * a1yu + ( u - t0 ) / ( t2 - t0 ) * a2yu;
		const b2xu = ( t3 - u ) / ( t3 - t1 ) * a2xu + ( u - t1 ) / ( t3 - t1 ) * a3xu;
		const b2yu = ( t3 - u ) / ( t3 - t1 ) * a2yu + ( u - t1 ) / ( t3 - t1 ) * a3yu;
		return [
			( t2 - u ) / ( t2 - t1 ) * b1xu + ( u - t1 ) / ( t2 - t1 ) * b2xu,
			( t2 - u ) / ( t2 - t1 ) * b1yu + ( u - t1 ) / ( t2 - t1 ) * b2yu,
		];

	};

	const sa = sample( tt1 );
	const sb = sample( tt2 );
	return {
		point: [ px, py ],
		tangent: [ sb[ 0 ] - sa[ 0 ], sb[ 1 ] - sa[ 1 ] ],
	};

}

// 计算样条点的累计弧长 + 单位法线
function buildArcAndNormals( samples ) {

	const arcLengths = [ 0 ];
	const tangents = [];
	const normals = [];

	for ( let index = 0; index < samples.length; index ++ ) {

		const tangent = samples[ index ].tangent;
		const length = Math.hypot( tangent[ 0 ], tangent[ 1 ] ) || EPSILON;
		const tx = tangent[ 0 ] / length;
		const ty = tangent[ 1 ] / length;
		tangents.push( [ tx, ty ] );
		// 法线 = 切线 90° 旋转
		normals.push( [ - ty, tx ] );

		if ( index > 0 ) {

			const prev = samples[ index - 1 ].point;
			const curr = samples[ index ].point;
			arcLengths.push( arcLengths[ index - 1 ] + distance2D( prev, curr ) );

		}

	}

	return { tangents, normals, arcLengths };

}

/**
 * 用 Catmull-Rom 样条（向心参数化）将控制点致密化。
 *
 * @param {Array<Array<number>>} controlPoints - 控制点 [[x,y], ...]
 * @param {object} [options]
 * @param {number} [options.alpha=0.5] - 0=uniform, 0.5=centripetal, 1=chordal
 * @param {number} [options.segments=24] - 每段控制点之间的采样数
 * @returns {{points: Array, tangents: Array, normals: Array, arcLengths: Array, totalLength: number}}
 */
export function catmullRomDense( controlPoints, options = {} ) {

	const alpha = options.alpha ?? 0.5;
	const segments = Math.max( 2, options.segments ?? 24 );

	if ( ! controlPoints || controlPoints.length < 2 ) {

		return { points: [], tangents: [], normals: [], arcLengths: [], totalLength: 0 };

	}

	if ( controlPoints.length === 2 ) {

		return linearDense( controlPoints[ 0 ], controlPoints[ 1 ], segments );

	}

	// 端点延拓：在首尾各镜像一个虚拟控制点
	const ext = [
		[
			2 * controlPoints[ 0 ][ 0 ] - controlPoints[ 1 ][ 0 ],
			2 * controlPoints[ 0 ][ 1 ] - controlPoints[ 1 ][ 1 ],
		],
		...controlPoints,
		[
			2 * controlPoints[ controlPoints.length - 1 ][ 0 ] - controlPoints[ controlPoints.length - 2 ][ 0 ],
			2 * controlPoints[ controlPoints.length - 1 ][ 1 ] - controlPoints[ controlPoints.length - 2 ][ 1 ],
		],
	];

	const samples = [];
	for ( let i = 1; i < ext.length - 2; i ++ ) {

		const p0 = ext[ i - 1 ];
		const p1 = ext[ i ];
		const p2 = ext[ i + 1 ];
		const p3 = ext[ i + 2 ];

		const includeStart = i === 1;
		for ( let s = includeStart ? 0 : 1; s <= segments; s ++ ) {

			const t = s / segments;
			samples.push( catmullRomSegment( p0, p1, p2, p3, t, alpha ) );

		}

	}

	const { tangents, normals, arcLengths } = buildArcAndNormals( samples );
	return {
		points: samples.map( s => s.point ),
		tangents,
		normals,
		arcLengths,
		totalLength: arcLengths[ arcLengths.length - 1 ] || 0,
	};

}

/**
 * 2 点退化情况：纯线性插值（没有曲率）。
 *
 * @param {Array} a
 * @param {Array} b
 * @param {number} segments
 */
export function linearDense( a, b, segments = 24 ) {

	const points = [];
	const tangents = [];
	const normals = [];
	const arcLengths = [];

	const dx = b[ 0 ] - a[ 0 ];
	const dy = b[ 1 ] - a[ 1 ];
	const length = Math.hypot( dx, dy ) || EPSILON;
	const tx = dx / length;
	const ty = dy / length;

	for ( let s = 0; s <= segments; s ++ ) {

		const t = s / segments;
		points.push( [ a[ 0 ] + dx * t, a[ 1 ] + dy * t ] );
		tangents.push( [ tx, ty ] );
		normals.push( [ - ty, tx ] );
		arcLengths.push( length * t );

	}

	return { points, tangents, normals, arcLengths, totalLength: length };

}

/**
 * 在累积弧长数组中找到给定弧长对应的样本索引。
 *
 * @param {Array<number>} arcLengths
 * @param {number} target
 * @returns {number}
 */
export function findIndexAtArcLength( arcLengths, target ) {

	if ( ! arcLengths || arcLengths.length === 0 ) return 0;
	if ( target <= 0 ) return 0;
	const total = arcLengths[ arcLengths.length - 1 ];
	if ( target >= total ) return arcLengths.length - 1;

	let lo = 0;
	let hi = arcLengths.length - 1;
	while ( lo < hi - 1 ) {

		const mid = ( lo + hi ) >> 1;
		if ( arcLengths[ mid ] < target ) lo = mid;
		else hi = mid;

	}

	return lo;

}

/**
 * 工具：从 a 出发，沿 a→b 方向偏转 angle，前进 distance 后的点（顺时针 / 逆时针）。
 * 用于头部几何（沿用既有 cesium-plot-js 头部的计算方式）。
 */
export function getThirdPoint( startPoint, endPoint, angle, distance, clockWise ) {

	const dx = endPoint[ 0 ] - startPoint[ 0 ];
	const dy = endPoint[ 1 ] - startPoint[ 1 ];
	let azimuth = Math.atan2( dy, dx );
	if ( azimuth < 0 ) azimuth += Math.PI * 2;
	const alpha = clockWise ? azimuth + angle : azimuth - angle;
	return [
		endPoint[ 0 ] + distance * Math.cos( alpha ),
		endPoint[ 1 ] + distance * Math.sin( alpha ),
	];

}

/**
 * p1→p2→p3 是否为顺时针方向（叉积判断）
 */
export function isClockWise( p1, p2, p3 ) {

	return ( p3[ 1 ] - p1[ 1 ] ) * ( p2[ 0 ] - p1[ 0 ] ) >
		( p2[ 1 ] - p1[ 1 ] ) * ( p3[ 0 ] - p1[ 0 ] );

}

export function midpoint( a, b ) {

	return [ ( a[ 0 ] + b[ 0 ] ) * 0.5, ( a[ 1 ] + b[ 1 ] ) * 0.5 ];

}
