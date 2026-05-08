// arrows/gatheringPlace.js — 集结地（≥3 控制点的圆角合并区域）
//
// 设计：把所有控制点用 Catmull-Rom 闭合插值，得到一条 smooth 闭合曲线。
// 用作"集结区"标绘——本质是带圆角的多边形。

import { catmullRomDense } from './arrowSpine.js';

/**
 * @param {Array<Array<number>>} controlPoints
 * @param {object} [style]
 * @param {number} [style.cornerSegments=12]
 */
export function createGatheringPlace( controlPoints, style = {} ) {

	if ( ! controlPoints || controlPoints.length < 3 ) return controlPoints || [];

	// 闭合：将首点追加到末尾
	const closed = [ ...controlPoints, controlPoints[ 0 ], controlPoints[ 1 ] ];
	const dense = catmullRomDense( closed, {
		alpha: 0.5,
		segments: style.cornerSegments ?? 12,
	} );

	if ( ! dense.points.length ) return controlPoints;

	// 去掉首尾的延拓部分
	const segments = style.cornerSegments ?? 12;
	const result = dense.points.slice( segments, dense.points.length - segments );
	return result.length >= 3 ? result : controlPoints;

}
