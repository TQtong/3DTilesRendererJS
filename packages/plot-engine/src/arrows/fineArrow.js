// arrows/fineArrow.js — 细直箭头（2 控制点）
//
// 形状（5 个顶点的实心箭头）：
//
//                    tip (= p2)
//                   /  \
//                  /    \
//        headLeft *      * headRight
//                 |      |
//          tail   p1     |
//                 |______|
//                 tailLeft  tailRight
//
// 这是一个最简单的"实心头 + 矩形尾"的箭头多边形。

/**
 * @param {Array} p1 - 尾部 [x, y]
 * @param {Array} p2 - 箭头尖端 [x, y]
 * @param {object} [style]
 * @param {number} [style.tailWidthFactor=0.10] - 尾部半宽 / 长度
 * @param {number} [style.headWidthFactor=0.22] - 翼尖半宽 / 长度
 * @param {number} [style.headLengthFactor=0.30] - 头部长度 / 总长
 */
export function createFineArrow( p1, p2, style = {} ) {

	const dx = p2[ 0 ] - p1[ 0 ];
	const dy = p2[ 1 ] - p1[ 1 ];
	const length = Math.hypot( dx, dy );
	if ( length === 0 ) return [];

	// 单位切线（前向）和单位法线（左侧）
	const tx = dx / length;
	const ty = dy / length;
	const nx = - ty;
	const ny = tx;

	const tailHalfW = length * ( style.tailWidthFactor ?? 0.05 );
	const headHalfW = length * ( style.headWidthFactor ?? 0.18 );
	const headLength = length * ( style.headLengthFactor ?? 0.32 );

	// 尾部两点（在 p1 处）
	const tailLeft  = [ p1[ 0 ] + nx * tailHalfW, p1[ 1 ] + ny * tailHalfW ];
	const tailRight = [ p1[ 0 ] - nx * tailHalfW, p1[ 1 ] - ny * tailHalfW ];

	// 颈部两点（在 p2 - tangent × headLength 处，宽度 = tailHalfW，与尾部对齐）
	const neckX = p2[ 0 ] - tx * headLength;
	const neckY = p2[ 1 ] - ty * headLength;
	const neckLeft  = [ neckX + nx * tailHalfW, neckY + ny * tailHalfW ];
	const neckRight = [ neckX - nx * tailHalfW, neckY - ny * tailHalfW ];

	// 头部翼尖两点（同一位置，宽度 = headHalfW > tailHalfW，形成箭头三角）
	const headLeft  = [ neckX + nx * headHalfW, neckY + ny * headHalfW ];
	const headRight = [ neckX - nx * headHalfW, neckY - ny * headHalfW ];

	// 7 顶点闭合多边形（逆时针）：
	//   tailLeft → neckLeft → headLeft → p2(tip) → headRight → neckRight → tailRight
	return [ tailLeft, neckLeft, headLeft, p2, headRight, neckRight, tailRight ];

}
