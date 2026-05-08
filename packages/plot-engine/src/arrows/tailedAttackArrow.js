// arrows/tailedAttackArrow.js — 带尾突击箭头
//
// 在 attack 基础上加燕尾切口（尾部 V 形凹槽）。
// 控制点 ≥ 2。

import { createAttackArrow } from './attackArrow.js';

/**
 * @param {Array<Array<number>>} controlPoints
 * @param {object} [style]
 * @param {number} [style.tailDepth=0.4] - 燕尾凹陷深度（占尾宽比例）
 */
export function createTailedAttackArrow( controlPoints, style = {} ) {

	const polygon = createAttackArrow( controlPoints, style );
	if ( polygon.length < 6 ) return polygon;

	// polygon[0] = tail-left（offsetSidesAlongNormals.left[0]）
	// polygon[last] = tail-right（offsetSidesAlongNormals.right.reverse() 的最后一个）
	const tailLeft = polygon[ 0 ];
	const tailRight = polygon[ polygon.length - 1 ];

	const midX = ( tailLeft[ 0 ] + tailRight[ 0 ] ) * 0.5;
	const midY = ( tailLeft[ 1 ] + tailRight[ 1 ] ) * 0.5;

	// 多边形几何质心（用于推断"内向"方向）
	let cx = 0, cy = 0;
	for ( const point of polygon ) {

		cx += point[ 0 ];
		cy += point[ 1 ];

	}

	cx /= polygon.length;
	cy /= polygon.length;

	const dx = cx - midX;
	const dy = cy - midY;
	const length = Math.hypot( dx, dy ) || 1;
	const tailWidth = Math.hypot( tailRight[ 0 ] - tailLeft[ 0 ], tailRight[ 1 ] - tailLeft[ 1 ] );
	const depth = ( style.tailDepth ?? 0.45 ) * tailWidth;

	const notch = [ midX + dx / length * depth, midY + dy / length * depth ];

	// 在 tailRight 之后追加 notch；多边形隐式闭合时形成 tail-right → notch → tail-left 的 V 型切口
	return [ ...polygon, notch ];

}
