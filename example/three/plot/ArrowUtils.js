/**
 * ArrowUtils.js — 箭头标绘图形生成工具库
 *
 * 移植自 cesium-plot-js（https://github.com/...），将原始 Cesium Cartesian3 的逻辑
 * 改为纯 2D [lon, lat] 经纬度坐标计算。每个 create* 函数接收控制点，返回闭合多边形顶点数组，
 * 供 GroundDecalManager.addArrowPlot() 作为 polygon (type 2) 渲染。
 *
 * 所有坐标格式：[longitude, latitude]（度）
 * 所有距离单位：度（在经纬度空间中计算，非真实米制距离）
 */

// 每段 Bézier 曲线的采样次数（getCurvePoints 使用）
const FITTING_COUNT = 100;

// 角平分线法向量的零容差阈值
const ZERO_TOLERANCE = 0.0001;

// ── 基础几何工具 ──

/**
 * 两点之间的欧氏距离（经纬度空间）
 */
export function MathDistance( p1, p2 ) {

	return Math.sqrt( ( p1[ 0 ] - p2[ 0 ] ) ** 2 + ( p1[ 1 ] - p2[ 1 ] ) ** 2 );

}

/**
 * 点集的总折线长度
 */
export function wholeDistance( points ) {

	let d = 0;
	for ( let i = 0; i < points.length - 1; i ++ ) {

		d += MathDistance( points[ i ], points[ i + 1 ] );

	}

	return d;

}

/**
 * 基础长度：总距离的 0.99 次幂，用于箭头各部分宽度计算的基准值。
 * 幂次 <1 使得长箭头的宽度增长速度略低于线性。
 */
export function getBaseLength( points ) {

	return wholeDistance( points ) ** 0.99;

}

/**
 * 两点的中点
 */
export function Mid( p1, p2 ) {

	return [ ( p1[ 0 ] + p2[ 0 ] ) / 2, ( p1[ 1 ] + p2[ 1 ] ) / 2 ];

}

/**
 * 从 startPnt 到 endPnt 的方位角（地平经度），返回弧度。
 * 根据象限返回 [0, 2π) 范围的角度。
 */
export function getAzimuth( startPnt, endPnt ) {

	const angle = Math.asin(
		Math.abs( endPnt[ 1 ] - startPnt[ 1 ] ) / MathDistance( startPnt, endPnt )
	);
	if ( endPnt[ 1 ] >= startPnt[ 1 ] && endPnt[ 0 ] >= startPnt[ 0 ] ) return angle + Math.PI;
	if ( endPnt[ 1 ] >= startPnt[ 1 ] && endPnt[ 0 ] < startPnt[ 0 ] ) return Math.PI * 2 - angle;
	if ( endPnt[ 1 ] < startPnt[ 1 ] && endPnt[ 0 ] < startPnt[ 0 ] ) return angle;
	return Math.PI - angle;

}

/**
 * 三点确定的夹角：从 b 看 a 和 c 的方位角之差，归一化到 [0, 2π)
 */
export function getAngleOfThreePoints( a, b, c ) {

	const angle = getAzimuth( b, a ) - getAzimuth( b, c );
	return angle < 0 ? angle + Math.PI * 2 : angle;

}

/**
 * 判断 p1→p2→p3 是否为顺时针方向（叉积判断）
 */
export function isClockWise( p1, p2, p3 ) {

	return ( p3[ 1 ] - p1[ 1 ] ) * ( p2[ 0 ] - p1[ 0 ] ) > ( p2[ 1 ] - p1[ 1 ] ) * ( p3[ 0 ] - p1[ 0 ] );

}

/**
 * 从 endPnt 出发，沿 startPnt→endPnt 方向偏转 angle 弧度，步进 distance 距离，
 * 返回第三个点的坐标。clockWise 控制偏转方向。
 * 这是箭头几何中最核心的工具函数——箭头的翼尖、颈部、尾部都由它计算。
 */
export function getThirdPoint( startPnt, endPnt, angle, distance, clockWise ) {

	const azimuth = getAzimuth( startPnt, endPnt );
	const alpha = clockWise ? azimuth + angle : azimuth - angle;
	return [ endPnt[ 0 ] + distance * Math.cos( alpha ), endPnt[ 1 ] + distance * Math.sin( alpha ) ];

}

// ── 曲线插值工具 ──

/**
 * 三点的法向量（角平分线方向）：p2 处 p1→p2 和 p3→p2 方向的单位向量之和。
 * 用于确定 Bézier 控制点的偏移方向。
 */
export function getNormal( p1, p2, p3 ) {

	let dX1 = p1[ 0 ] - p2[ 0 ], dY1 = p1[ 1 ] - p2[ 1 ];
	const d1 = Math.sqrt( dX1 * dX1 + dY1 * dY1 );
	dX1 /= d1; dY1 /= d1;
	let dX2 = p3[ 0 ] - p2[ 0 ], dY2 = p3[ 1 ] - p2[ 1 ];
	const d2 = Math.sqrt( dX2 * dX2 + dY2 * dY2 );
	dX2 /= d2; dY2 /= d2;
	return [ dX1 + dX2, dY1 + dY2 ];

}

/**
 * 在顶点 p2 处，沿角平分线法向量偏移，生成左右两个 Bézier 控制点。
 * t 控制偏移量与相邻边长的比例。
 * 用于 getCurvePoints 中每个内部顶点的曲线控制。
 */
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

		// 三点近似共线时，退化为线性插值
		bisectorNormalRight = [ p2[ 0 ] + t * ( p1[ 0 ] - p2[ 0 ] ), p2[ 1 ] + t * ( p1[ 1 ] - p2[ 1 ] ) ];
		bisectorNormalLeft = [ p2[ 0 ] + t * ( p3[ 0 ] - p2[ 0 ] ), p2[ 1 ] + t * ( p3[ 1 ] - p2[ 1 ] ) ];

	}

	return [ bisectorNormalRight, bisectorNormalLeft ];

}

/**
 * 曲线起点处的镜像控制点。
 * 通过将第二个顶点的右侧法向量关于第一段中点进行反射，得到起点的控制点。
 * 确保曲线在起点处的切线方向与第一段一致。
 */
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
		// 反射矩阵 [[a11, a12], [a12, a22]]
		const a11 = nX * nX - nY * nY, a12 = 2 * nX * nY, a22 = nY * nY - nX * nX;
		const dX = normalRight[ 0 ] - mid[ 0 ], dY = normalRight[ 1 ] - mid[ 1 ];
		return [ mid[ 0 ] + a11 * dX + a12 * dY, mid[ 1 ] + a12 * dX + a22 * dY ];

	}

	return [ p1[ 0 ] + t * ( p2[ 0 ] - p1[ 0 ] ), p1[ 1 ] + t * ( p2[ 1 ] - p1[ 1 ] ) ];

}

/**
 * 曲线终点处的镜像控制点（与 getLeftMostControlPoint 对称）
 */
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

/**
 * 通过控制点序列生成平滑曲线（三次 Bézier 链）。
 *
 * 算法步骤：
 * 1. 为每个内部顶点计算角平分线法向量 → 左右两个 Bézier 控制点
 * 2. 为起点/终点生成镜像控制点
 * 3. 每相邻两个原始控制点之间用三次 Bézier 插值（FITTING_COUNT=100 个采样）
 *
 * @param t - 控制点偏移因子，影响曲线的弯曲程度（0.3 为典型值）
 * @param controlPoints - 控制点数组 [[lon, lat], ...]，至少 3 个
 * @returns 平滑曲线上的点数组
 */
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

			// 三次 Bézier：B(t) = (1-t)³·P0 + 3(1-t)²t·C1 + 3(1-t)t²·C2 + t³·P1
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

/**
 * 均匀二次 B 样条的基函数
 */
function getQuadricBSplineFactor( k, t ) {

	if ( k === 0 ) return ( t - 1 ) ** 2 / 2;
	if ( k === 1 ) return ( - 2 * t ** 2 + 2 * t + 1 ) / 2;
	if ( k === 2 ) return t ** 2 / 2;
	return 0;

}

/**
 * 均匀二次 B 样条插值。
 * 用于攻击箭头的左右侧边平滑——将折线控制点平滑为曲线。
 * 比 Bézier 更适合「经过控制点附近但不精确经过」的场景。
 */
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

// ── 箭头形状生成器 ──
// 每个函数返回 [lon, lat] 对数组，构成闭合多边形，供 polygon SDF (type 2) 渲染。

/**
 * 细箭头（多边形型）：两点定义一个有宽度的填充箭头。
 *
 * 形状结构（8 个顶点的闭合多边形）：
 *   tailLeft ─── neckLeft ── headLeft
 *       │                        ╲
 *      p1                        p2 (tip)
 *       │                        ╱
 *   tailRight ── neckRight ── headRight
 *
 * 各部分宽度由 baseLength 的固定比例因子控制：
 * - tailWidth  = 10% （尾部宽度）
 * - neckWidth  = 20% （颈部宽度）
 * - headWidth  = 25% （翼展宽度）
 *
 * @param p1 - 尾部中心 [lon, lat]
 * @param p2 - 箭头尖端 [lon, lat]
 */
export function createFineArrow( p1, p2 ) {

	const len = getBaseLength( [ p1, p2 ] );
	const tailWidth = len * 0.1;
	const neckWidth = len * 0.2;
	const headWidth = len * 0.25;
	// 翼展角度 ≈ 21°
	const headAngle = Math.PI / 8.5;
	// 颈部角度 ≈ 14°
	const neckAngle = Math.PI / 13;

	// 尾部：在 p1 处，垂直于 p1→p2 方向展开
	const tailLeft = getThirdPoint( p2, p1, Math.PI / 2, tailWidth, true );
	const tailRight = getThirdPoint( p2, p1, Math.PI / 2, tailWidth, false );
	// 头部：在 p2 附近，沿 headAngle/neckAngle 展开
	const headLeft = getThirdPoint( p1, p2, headAngle, headWidth, false );
	const headRight = getThirdPoint( p1, p2, headAngle, headWidth, true );
	const neckLeft = getThirdPoint( p1, p2, neckAngle, neckWidth, false );
	const neckRight = getThirdPoint( p1, p2, neckAngle, neckWidth, true );

	// 顺序：逆时针闭合 tailLeft → neck → head → tip → head → neck → tailRight → p1
	return [ tailLeft, neckLeft, headLeft, p2, headRight, neckRight, tailRight, p1 ];

}

/**
 * 对点数组进行均匀降采样，保留首尾点。
 * 用于将 getCurvePoints（200+ 点）或 getQBSplinePoints（100+ 点）
 * 降到 shader 的 64 顶点上限以内。
 *
 * @param points - 原始点数组
 * @param maxCount - 目标最大点数
 */
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

/**
 * 曲线箭头（多边形型）：3+ 个控制点定义弧形体 + 三角头的填充箭头。
 *
 * 算法步骤：
 * 1. 用 getCurvePoints 生成平滑曲线
 * 2. 降采样到 25 点（避免超出 shader 64 顶点限制）
 * 3. 沿曲线法线方向左右偏移，生成有宽度的体部（宽度从尾到颈逐渐收窄）
 * 4. 在末端生成三角箭头（headAngle/neckAngle 翼展）
 * 5. 合并：左侧轮廓 + 箭头头部 + 右侧轮廓（反转）→ 闭合多边形
 *
 * 2 点退化为 createFineArrow。
 *
 * @param lnglatPoints - 控制点数组 [[lon, lat], ...]
 */
export function createCurvedArrow( lnglatPoints ) {

	if ( lnglatPoints.length === 2 ) {

		return createFineArrow( lnglatPoints[ 0 ], lnglatPoints[ 1 ] );

	}

	// 生成平滑曲线并降采样
	const rawCurve = getCurvePoints( 0.3, lnglatPoints );
	const curvePoints = downsample( rawCurve, 25 );
	const totalLen = wholeDistance( curvePoints );

	// 各部分比例因子
	// 各部分比例因子（相对于曲线总长）
	const tailWidthFactor = 0.08;
	const neckWidthFactor = 0.12;
	const headWidthFactor = 0.2;
	const headAngle = Math.PI / 8.5;
	const neckAngle = Math.PI / 13;
	const headLenFactor = 0.15;

	const tailW = totalLen * tailWidthFactor;
	const headLen = totalLen * headLenFactor;

	// 生成体部左右轮廓
	const leftSide = [];
	const rightSide = [];
	let accumulated = 0;
	const bodyEnd = totalLen - headLen; // 体部在此长度处结束，之后是箭头头部

	for ( let i = 0; i < curvePoints.length; i ++ ) {

		if ( i > 0 ) accumulated += MathDistance( curvePoints[ i - 1 ], curvePoints[ i ] );
		if ( accumulated > bodyEnd ) break;

		// 宽度从尾部到颈部线性收窄 50%
		const t = bodyEnd > 0 ? accumulated / bodyEnd : 0;
		const w = tailW * ( 1 - t * 0.5 );

		// 计算当前点的切线法线方向
		const prev = i > 0 ? curvePoints[ i - 1 ] : curvePoints[ 0 ];
		const next = i < curvePoints.length - 1 ? curvePoints[ i + 1 ] : curvePoints[ i ];
		const dx = next[ 0 ] - prev[ 0 ], dy = next[ 1 ] - prev[ 1 ];
		const len = Math.sqrt( dx * dx + dy * dy ) || 1;
		const nx = - dy / len, ny = dx / len; // 90° 旋转得到法线

		leftSide.push( [ curvePoints[ i ][ 0 ] + nx * w, curvePoints[ i ][ 1 ] + ny * w ] );
		rightSide.push( [ curvePoints[ i ][ 0 ] - nx * w, curvePoints[ i ][ 1 ] - ny * w ] );

	}

	// 生成箭头头部（5 个点：颈左、翼左、尖端、翼右、颈右）
	const tip = curvePoints[ curvePoints.length - 1 ];
	const beforeTip = curvePoints[ curvePoints.length - 2 ];
	const neckWidth = totalLen * neckWidthFactor;
	const headWidth = totalLen * headWidthFactor;
	const neckLeft = getThirdPoint( beforeTip, tip, neckAngle, neckWidth, false );
	const neckRight = getThirdPoint( beforeTip, tip, neckAngle, neckWidth, true );
	const headLeft = getThirdPoint( beforeTip, tip, headAngle, headWidth, false );
	const headRight = getThirdPoint( beforeTip, tip, headAngle, headWidth, true );

	// 合并为闭合多边形：左侧 → 箭头头部 → 右侧（反转）
	return [ ...leftSide, neckLeft, headLeft, tip, headRight, neckRight, ...rightSide.reverse() ];

}

/**
 * 攻击箭头（多边形型）：3+ 个控制点定义宽体渐变箭头。
 *
 * 控制点含义：
 * - points[0], points[1]：定义尾部宽度（两点间距 = 尾宽）
 * - points[2..n]：定义脊线（箭头体的中轴走向）
 *
 * 算法步骤：
 * 1. 根据 points[0,1] 的顺逆时针关系确定 tailLeft/tailRight
 * 2. 计算脊线：尾部中点 → points[2] → ... → points[n]
 * 3. 在脊线末端生成五点箭头头部（颈左/右、翼左/右、尖端）
 * 4. 沿脊线每个内部顶点，用角平分线计算左右偏移（宽度从尾宽渐变到颈宽）
 * 5. 左右侧边用 B 样条平滑 → 降采样到 25 点
 * 6. 合并：左侧 + 箭头头部 + 右侧（反转）→ 闭合多边形
 *
 * @param lnglatPoints - 控制点数组 [[lon, lat], ...]，至少 3 个
 */
export function createAttackArrow( lnglatPoints ) {

	// 根据第三个点的位置确定尾部左右
	let tailLeft = lnglatPoints[ 0 ], tailRight = lnglatPoints[ 1 ];
	if ( isClockWise( lnglatPoints[ 0 ], lnglatPoints[ 1 ], lnglatPoints[ 2 ] ) ) {

		tailLeft = lnglatPoints[ 1 ];
		tailRight = lnglatPoints[ 0 ];

	}

	// 脊线：尾部中点 + 后续所有控制点
	const midTail = Mid( tailLeft, tailRight );
	const bonePnts = [ midTail, ...lnglatPoints.slice( 2 ) ];

	// 箭头头部比例因子
	const headHeightFactor = 0.18, headWidthFactor = 0.3;
	const neckHeightFactor = 0.85, neckWidthFactor = 0.15;
	const headTailFactor = 0.8; // 头部高度不超过尾宽的 80%

	// 计算箭头头部尺寸（受尾宽约束）
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

	// 五点箭头头部：沿脊线末段方向后退 headHeight/neckHeight，再垂直展开
	const headEndPnt = getThirdPoint( bonePnts[ bonePnts.length - 2 ], headPnt, 0, headHeight, true );
	const neckEndPnt = getThirdPoint( bonePnts[ bonePnts.length - 2 ], headPnt, 0, neckHeight, true );
	const headLeft = getThirdPoint( headPnt, headEndPnt, Math.PI / 2, headWidth, false );
	const headRight = getThirdPoint( headPnt, headEndPnt, Math.PI / 2, headWidth, true );
	const neckLeft = getThirdPoint( headPnt, neckEndPnt, Math.PI / 2, neckWidth, false );
	const neckRight = getThirdPoint( headPnt, neckEndPnt, Math.PI / 2, neckWidth, true );
	const headPnts = [ neckLeft, headLeft, headPnt, headRight, neckRight ];

	// 体部：沿脊线内部顶点，用角平分线展宽（从尾宽渐变到颈宽）
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
		// 宽度沿路径递减，除以 sin(angle) 补偿角平分线偏移
		const w = ( tw / 2 - ( tempLen / allLen ) * widthDif ) / Math.sin( angle );
		leftBodyPnts.push( getThirdPoint( bonePnts[ i - 1 ], bonePnts[ i ], Math.PI - angle, w, true ) );
		rightBodyPnts.push( getThirdPoint( bonePnts[ i - 1 ], bonePnts[ i ], angle, w, false ) );

	}

	// 左右侧边 B 样条平滑 + 降采样（控制在 shader 64 顶点限制内）
	let leftPnts = [ tailLeft, ...leftBodyPnts, neckLeft ];
	let rightPnts = [ tailRight, ...rightBodyPnts, neckRight ];
	leftPnts = downsample( getQBSplinePoints( leftPnts ), 25 );
	rightPnts = downsample( getQBSplinePoints( rightPnts ), 25 );

	// 合并为闭合多边形
	return [ ...leftPnts, ...headPnts, ...rightPnts.reverse() ];

}
