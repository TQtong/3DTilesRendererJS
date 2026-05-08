// ============================================================
// arrows/arrowOffsetting.js — 沿法线偏移、宽度场、自交检测
// ============================================================
//
// 职责：
//   - 在已经致密化的脊线 + 法线上，按 width(arc) 函数生成左右两条侧边
//   - 提供 cosine 缓变宽度场（避免线性收紧的视觉跳变）
//   - 自交检测（segment-segment 相交 + 左右穿插）
//

const EPSILON = 1e-9;

/**
 * 沿法线偏移生成左右侧边。
 *
 * @param {Array<Array<number>>} points - 致密化后的脊线点
 * @param {Array<Array<number>>} normals - 对应每个点的单位法线
 * @param {Function} widthFn - i => 半宽
 * @returns {{ left: Array, right: Array }}
 */
export function offsetSidesAlongNormals( points, normals, widthFn ) {

	const left = [];
	const right = [];
	const count = Math.min( points.length, normals.length );
	for ( let i = 0; i < count; i ++ ) {

		const half = widthFn( i );
		const point = points[ i ];
		const normal = normals[ i ];
		left.push( [ point[ 0 ] + normal[ 0 ] * half, point[ 1 ] + normal[ 1 ] * half ] );
		right.push( [ point[ 0 ] - normal[ 0 ] * half, point[ 1 ] - normal[ 1 ] * half ] );

	}

	return { left, right };

}

/**
 * 余弦缓变宽度场：从 wTail 平滑过渡到 wNeck，沿弧长归一化 [0,1]。
 * t=0 → wTail，t=1 → wNeck，cos 曲线避免端点突变。
 *
 * @param {Array<number>} arcLengths
 * @param {number} maxIndex - 体部结束的样本索引（颈部位置）
 * @param {number} wTail
 * @param {number} wNeck
 * @returns {Function} (i) => width
 */
export function makeCosineWidthField( arcLengths, maxIndex, wTail, wNeck ) {

	if ( maxIndex <= 0 ) return () => wTail;
	const totalArc = arcLengths[ maxIndex ] - arcLengths[ 0 ] || EPSILON;

	return ( i ) => {

		if ( i <= 0 ) return wTail;
		if ( i >= maxIndex ) return wNeck;
		const t = ( arcLengths[ i ] - arcLengths[ 0 ] ) / totalArc;
		// 0.5*(1+cos(πt)) 在 t=0 时为 1，t=1 时为 0
		const w = 0.5 * ( 1 + Math.cos( Math.PI * t ) );
		return wNeck + ( wTail - wNeck ) * w;

	};

}

/**
 * 累计弧长辅助函数。
 *
 * @param {Array<Array<number>>} points
 * @returns {Array<number>}
 */
export function cumulativeArcLengths( points ) {

	const result = [ 0 ];
	for ( let i = 1; i < points.length; i ++ ) {

		const dx = points[ i ][ 0 ] - points[ i - 1 ][ 0 ];
		const dy = points[ i ][ 1 ] - points[ i - 1 ][ 1 ];
		result.push( result[ i - 1 ] + Math.hypot( dx, dy ) );

	}

	return result;

}

// 两线段是否真相交（不算端点共点）
function segmentsIntersect( p, p2, q, q2 ) {

	const r = [ p2[ 0 ] - p[ 0 ], p2[ 1 ] - p[ 1 ] ];
	const s = [ q2[ 0 ] - q[ 0 ], q2[ 1 ] - q[ 1 ] ];
	const denom = r[ 0 ] * s[ 1 ] - r[ 1 ] * s[ 0 ];
	if ( Math.abs( denom ) < EPSILON ) return false;
	const qp = [ q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ] ];
	const t = ( qp[ 0 ] * s[ 1 ] - qp[ 1 ] * s[ 0 ] ) / denom;
	const u = ( qp[ 0 ] * r[ 1 ] - qp[ 1 ] * r[ 0 ] ) / denom;
	const margin = 1e-6;
	return t > margin && t < 1 - margin && u > margin && u < 1 - margin;

}

/**
 * 多点折线是否存在自交（O(n²) 暴力，n<200 时足够快）。
 *
 * @param {Array<Array<number>>} polyline
 * @returns {boolean}
 */
export function hasSelfIntersection( polyline ) {

	const n = polyline.length;
	if ( n < 4 ) return false;
	for ( let i = 0; i < n - 1; i ++ ) {

		for ( let j = i + 2; j < n - 1; j ++ ) {

			if ( i === 0 && j === n - 2 ) continue;
			if ( segmentsIntersect( polyline[ i ], polyline[ i + 1 ], polyline[ j ], polyline[ j + 1 ] ) ) {

				return true;

			}

		}

	}

	return false;

}

/**
 * 左右两条侧边是否互相穿插（应该全程平行）。
 *
 * @param {Array<Array<number>>} left
 * @param {Array<Array<number>>} right
 * @returns {boolean}
 */
export function crossEachOther( left, right ) {

	const n = Math.min( left.length, right.length ) - 1;
	for ( let i = 0; i < n; i ++ ) {

		for ( let j = 0; j < n; j ++ ) {

			if ( segmentsIntersect( left[ i ], left[ i + 1 ], right[ j ], right[ j + 1 ] ) ) return true;

		}

	}

	return false;

}

/**
 * 沿法线偏移生成左右侧边时，对宽度做 0.7× 收缩重试（最多 maxRetries 次）。
 * 用于自交兜底。
 *
 * @param {Function} buildOnce - (scale) => { left, right, ... }
 * @param {number} maxRetries
 */
export function buildWithSelfIntersectionFallback( buildOnce, maxRetries = 3 ) {

	let scale = 1;
	for ( let attempt = 0; attempt <= maxRetries; attempt ++ ) {

		const result = buildOnce( scale );
		const ok = ! hasSelfIntersection( result.left ) &&
			! hasSelfIntersection( result.right ) &&
			! crossEachOther( result.left, result.right );
		if ( ok ) return result;
		scale *= 0.7;

	}

	// 最后一次仍失败，返回最窄版本（保证不抛错）
	return buildOnce( 0.4 );

}
