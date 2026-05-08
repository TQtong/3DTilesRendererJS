// arrows/doubleArrow.js — 双箭头 / 钳形（4 控制点）
//
// 控制点：
//   p0 - 左尾点
//   p1 - 右尾点
//   p2 - 左前线点（左箭头的目标）
//   p3 - 右前线点（右箭头的目标；可选）
//
// 输出：两条独立的 attackArrow 组成"钳形"。
// 返回数组结构由 militaryArrowCompilers 转化为 primitives：
//   { polygons: [polygon1, polygon2] } —— 编译器/渲染层会分别三角化两组多边形。

import { createAttackArrow } from './attackArrow.js';
import { midpoint } from './arrowSpine.js';

/**
 * @param {Array<Array<number>>} controlPoints
 * @param {object} [style]
 * @returns {Array<Array<Array<number>>>} 多多边形数组：[ leftPolygon, rightPolygon ]
 */
export function createDoubleArrow( controlPoints, style = {} ) {

	if ( ! controlPoints || controlPoints.length < 3 ) return [];

	const p0 = controlPoints[ 0 ];
	const p1 = controlPoints[ 1 ];
	const p2 = controlPoints[ 2 ];
	let p3 = controlPoints[ 3 ];

	// 缺省 p3：以 p0p1 中点为对称中心，p2 关于这条线的镜像
	if ( ! p3 ) {

		const mid = midpoint( p0, p1 );
		p3 = [ 2 * mid[ 0 ] - p2[ 0 ], 2 * mid[ 1 ] - p2[ 1 ] ];

	}

	// 左箭头：尾在 p0，目标在 p2，spine 中间引一个偏移点形成弯曲
	// 右箭头：尾在 p1，目标在 p3，spine 中间引一个偏移点形成弯曲
	const center = midpoint( p0, p1 );
	const tipMid = midpoint( p2, p3 );

	const leftMidA = midpoint( p0, center );
	const leftMidB = midpoint( center, tipMid );
	const rightMidA = midpoint( p1, center );
	const rightMidB = midpoint( center, tipMid );

	const leftArrow = createAttackArrow( [ p0, leftMidA, leftMidB, p2 ], style );
	const rightArrow = createAttackArrow( [ p1, rightMidA, rightMidB, p3 ], style );

	const polygons = [];
	if ( leftArrow.length >= 3 ) polygons.push( leftArrow );
	if ( rightArrow.length >= 3 ) polygons.push( rightArrow );
	return polygons;

}
