// arrows/swallowtailArrow.js — 燕尾箭头（2 控制点 + 尾部 V 形切口）
//
// 形状：在 fineArrow 基础上，把尾部"平边"换成 V 形凹槽（向 p2 方向凹进）。

/**
 * @param {Array} p1 - 尾部 [x, y]
 * @param {Array} p2 - 箭头尖端 [x, y]
 * @param {object} [style]
 * @param {number} [style.swallowtailDepth=0.4] - 燕尾凹陷深度（占 headLength 比例）
 */
export function createSwallowtailArrow( p1, p2, style = {} ) {

	const dx = p2[ 0 ] - p1[ 0 ];
	const dy = p2[ 1 ] - p1[ 1 ];
	const length = Math.hypot( dx, dy );
	if ( length === 0 ) return [];

	const tx = dx / length;
	const ty = dy / length;
	const nx = - ty;
	const ny = tx;

	const tailHalfW = length * ( style.tailWidthFactor ?? 0.05 );
	const headHalfW = length * ( style.headWidthFactor ?? 0.18 );
	const headLength = length * ( style.headLengthFactor ?? 0.32 );
	const swallowDepth = headLength * ( style.swallowtailDepth ?? 0.4 );

	const tailLeft  = [ p1[ 0 ] + nx * tailHalfW, p1[ 1 ] + ny * tailHalfW ];
	const tailRight = [ p1[ 0 ] - nx * tailHalfW, p1[ 1 ] - ny * tailHalfW ];

	// V 形凹陷的内尖端：在尾部中心处沿 forward 方向推进 swallowDepth
	const tailNotch = [ p1[ 0 ] + tx * swallowDepth, p1[ 1 ] + ty * swallowDepth ];

	const neckX = p2[ 0 ] - tx * headLength;
	const neckY = p2[ 1 ] - ty * headLength;
	const neckLeft  = [ neckX + nx * tailHalfW, neckY + ny * tailHalfW ];
	const neckRight = [ neckX - nx * tailHalfW, neckY - ny * tailHalfW ];

	const headLeft  = [ neckX + nx * headHalfW, neckY + ny * headHalfW ];
	const headRight = [ neckX - nx * headHalfW, neckY - ny * headHalfW ];

	// 8 顶点闭合多边形：
	//   tailLeft → neckLeft → headLeft → tip → headRight → neckRight → tailRight → tailNotch
	return [ tailLeft, neckLeft, headLeft, p2, headRight, neckRight, tailRight, tailNotch ];

}
