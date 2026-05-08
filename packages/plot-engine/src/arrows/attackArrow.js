// arrows/attackArrow.js — 突击箭头（≥2 控制点稳健版）
//
// 算法（参考 cesium-plot-js 但带稳健性修复）：
//   1. 控制点 [p0, p1, ..., pN-1] 全部当 spine waypoints
//   2. 尾部 tailLeft/Right：在 p0 处垂直于 p0→p1 方向偏移 tailHalfWidth
//   3. 头部 5 点几何（headLeft, neckLeft, tip, neckRight, headRight）锚定在最后一段方向
//   4. 体部内部点（p1..pN-2）：用角平分线偏移，宽度按 cosine 缓变
//      - 防 sharp turn 处 1/sin(angle) 爆炸：clamp sin >= 0.4
//   5. 左右侧边显式包含 tailLeft 和 neckLeft（首末锚点）
//   6. 用 Catmull-Rom 平滑左右侧边（α=0.5，端点严格保留）
//   7. 自交检测：穿插自动按 0.7^attempt 收宽递归
//
// 与 cesium-plot-js 的关键差异：
//   - 控制点解释：cesium 用 cp[0],cp[1] 作尾宽，cp[2..N-1] 是脊线
//     本实现：cp[0..N-1] 全部是脊线，尾宽由 style.tailWidth 给出
//   - 平滑：cesium 用 B 样条（端点不穿过），本实现用 Catmull-Rom（端点严格穿过）
//   - 鲁棒性：clamp sin(angle) 防 1/sin 爆炸；自交检测兜底

import { catmullRomDense } from './arrowSpine.js';
import { hasSelfIntersection, crossEachOther } from './arrowOffsetting.js';

const HEAD_HEIGHT_FACTOR = 0.18;     // 头部高度 / 总长
const HEAD_HALF_WIDTH_FACTOR = 0.65; // 头部翼半距 / headHeight（半宽，乘 2 得全宽）
const NECK_HEIGHT_FACTOR = 0.85;     // 内颈高度 / headHeight
const NECK_HALF_WIDTH_FACTOR = 0.32; // 内颈半距 / headHeight
const HEAD_TAIL_FACTOR = 0.7;        // 头部高度上限 / 尾宽

const EPSILON = 1e-9;

function distance2D( a, b ) {

	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

}

function unit( vec ) {

	const len = Math.hypot( vec[ 0 ], vec[ 1 ] ) || EPSILON;
	return [ vec[ 0 ] / len, vec[ 1 ] / len ];

}

function leftNormal( dir ) {

	// 单位切线 → 单位左法线（90° 逆时针旋转）
	return [ - dir[ 1 ], dir[ 0 ] ];

}

function smoothSide( points, segments = 16 ) {

	if ( points.length <= 2 ) return points.slice();
	const dense = catmullRomDense( points, { alpha: 0.5, segments } );
	return dense.points.length > 0 ? dense.points : points.slice();

}

/**
 * @param {Array<Array<number>>} controlPoints - ≥3 控制点（脊线 waypoints）
 * @param {object} [style]
 * @param {number} [style.tailWidth] - 尾部全宽
 * @param {number} [style.maxHeadHeight]
 */
export function createAttackArrow( controlPoints, style = {} ) {

	if ( ! controlPoints || controlPoints.length < 3 ) return [];

	const N = controlPoints.length;
	const cp = controlPoints;

	// ── 累计长度 ──
	const segLens = [];
	let totalLen = 0;
	for ( let i = 1; i < N; i ++ ) {

		const d = distance2D( cp[ i - 1 ], cp[ i ] );
		segLens.push( d );
		totalLen += d;

	}

	if ( totalLen <= 0 ) return [];

	// ── 头部尺寸 ──
	const firstSeg = segLens[ 0 ];
	const tailWidth = style.tailWidth ?? Math.max( totalLen * 0.16, firstSeg * 1.2 );
	const tailHalfW = tailWidth * 0.5;

	let headHeight = totalLen * HEAD_HEIGHT_FACTOR;
	if ( headHeight > tailWidth * HEAD_TAIL_FACTOR ) headHeight = tailWidth * HEAD_TAIL_FACTOR;
	headHeight = Math.min( headHeight, segLens[ segLens.length - 1 ] * 0.95 );
	if ( style.maxHeadHeight && headHeight > style.maxHeadHeight ) headHeight = style.maxHeadHeight;

	const neckHeight = headHeight * NECK_HEIGHT_FACTOR;
	const headHalfW = headHeight * HEAD_HALF_WIDTH_FACTOR;
	const neckHalfW = headHeight * NECK_HALF_WIDTH_FACTOR;

	// ── 尾部：在 cp[0] 处垂直于 cp[0]→cp[1] 方向 ──
	const firstDir = unit( [ cp[ 1 ][ 0 ] - cp[ 0 ][ 0 ], cp[ 1 ][ 1 ] - cp[ 0 ][ 1 ] ] );
	const firstN = leftNormal( firstDir );
	const tailLeft = [ cp[ 0 ][ 0 ] + firstN[ 0 ] * tailHalfW, cp[ 0 ][ 1 ] + firstN[ 1 ] * tailHalfW ];
	const tailRight = [ cp[ 0 ][ 0 ] - firstN[ 0 ] * tailHalfW, cp[ 0 ][ 1 ] - firstN[ 1 ] * tailHalfW ];

	// ── 头部 5 点：锚定在最后一段（cp[N-2]→cp[N-1]）方向 ──
	const lastDir = unit( [ cp[ N - 1 ][ 0 ] - cp[ N - 2 ][ 0 ], cp[ N - 1 ][ 1 ] - cp[ N - 2 ][ 1 ] ] );
	const lastN = leftNormal( lastDir );
	const tip = cp[ N - 1 ];

	// 头部锚点（沿最后一段方向退后）
	const headBack = [ tip[ 0 ] - lastDir[ 0 ] * headHeight, tip[ 1 ] - lastDir[ 1 ] * headHeight ];
	const neckBack = [ tip[ 0 ] - lastDir[ 0 ] * neckHeight, tip[ 1 ] - lastDir[ 1 ] * neckHeight ];

	const headLeft  = [ headBack[ 0 ] + lastN[ 0 ] * headHalfW, headBack[ 1 ] + lastN[ 1 ] * headHalfW ];
	const headRight = [ headBack[ 0 ] - lastN[ 0 ] * headHalfW, headBack[ 1 ] - lastN[ 1 ] * headHalfW ];
	const neckLeft  = [ neckBack[ 0 ] + lastN[ 0 ] * neckHalfW, neckBack[ 1 ] + lastN[ 1 ] * neckHalfW ];
	const neckRight = [ neckBack[ 0 ] - lastN[ 0 ] * neckHalfW, neckBack[ 1 ] - lastN[ 1 ] * neckHalfW ];

	// ── 体部偏移：在 cp[1..N-2] 用角平分线 ──
	const buildOnce = ( widthScale ) => {

		const tw = tailHalfW * widthScale;
		const nw = neckHalfW * widthScale;

		const leftCtrl = [ tailLeft ];
		const rightCtrl = [ tailRight ];

		let acc = 0;
		for ( let i = 1; i < N - 1; i ++ ) {

			acc += segLens[ i - 1 ];
			const t = totalLen > 0 ? Math.min( 1, acc / totalLen ) : 0;
			// cosine 缓变：t=0 → tw，t=1 → nw
			const w = nw + ( tw - nw ) * 0.5 * ( 1 + Math.cos( Math.PI * t ) );

			const inDir  = unit( [ cp[ i ][ 0 ] - cp[ i - 1 ][ 0 ], cp[ i ][ 1 ] - cp[ i - 1 ][ 1 ] ] );
			const outDir = unit( [ cp[ i + 1 ][ 0 ] - cp[ i ][ 0 ], cp[ i + 1 ][ 1 ] - cp[ i ][ 1 ] ] );
			const inN  = leftNormal( inDir );
			const outN = leftNormal( outDir );

			// 角平分线方向 = (inN + outN) 归一化
			let bx = inN[ 0 ] + outN[ 0 ];
			let by = inN[ 1 ] + outN[ 1 ];
			let bLen = Math.hypot( bx, by );
			if ( bLen < 0.01 ) {

				// 反平行（180° 急转）兜底
				bx = inN[ 0 ];
				by = inN[ 1 ];
				bLen = 1;

			}

			bx /= bLen;
			by /= bLen;

			// 宽度补偿：sin(half_interior_angle) = inN · bisector
			const sinHalf = Math.abs( inN[ 0 ] * bx + inN[ 1 ] * by );
			const sinClamp = Math.max( sinHalf, 0.4 ); // 防止锐角处爆炸
			const wAdj = w / sinClamp;

			leftCtrl.push( [ cp[ i ][ 0 ] + bx * wAdj, cp[ i ][ 1 ] + by * wAdj ] );
			rightCtrl.push( [ cp[ i ][ 0 ] - bx * wAdj, cp[ i ][ 1 ] - by * wAdj ] );

		}

		leftCtrl.push( neckLeft );
		rightCtrl.push( neckRight );

		const left = smoothSide( leftCtrl, 16 );
		const right = smoothSide( rightCtrl, 16 );
		return { left, right };

	};

	let result = buildOnce( 1 );
	for ( let attempt = 1; attempt <= 3; attempt ++ ) {

		const ok = ! hasSelfIntersection( result.left ) &&
			! hasSelfIntersection( result.right ) &&
			! crossEachOther( result.left, result.right );
		if ( ok ) break;
		result = buildOnce( Math.pow( 0.7, attempt ) );

	}

	// ── 装配多边形 ──
	//   leftCtrl[start..end]（已含 tailLeft, neckLeft）→ headLeft → tip → headRight
	//   → rightCtrl[end..start].reverse()（已含 neckRight, tailRight）
	return [
		...result.left,
		headLeft,
		tip,
		headRight,
		...result.right.reverse(),
	];

}
