// arrows/curvedArrow.js — 弯曲单线箭头（≥2 控制点）
//
// 与 attackArrow 同算法，但宽度全程恒定（thinner body）+ 简单 3 点头部（无 inner neck）。
// 适合"路径标注"型箭头。

import { catmullRomDense } from './arrowSpine.js';

const EPSILON = 1e-9;

function distance2D( a, b ) {

	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

}

function unit( vec ) {

	const len = Math.hypot( vec[ 0 ], vec[ 1 ] ) || EPSILON;
	return [ vec[ 0 ] / len, vec[ 1 ] / len ];

}

function leftNormal( dir ) {

	return [ - dir[ 1 ], dir[ 0 ] ];

}

function smoothSide( points, segments = 16 ) {

	if ( points.length <= 2 ) return points.slice();
	const dense = catmullRomDense( points, { alpha: 0.5, segments } );
	return dense.points.length > 0 ? dense.points : points.slice();

}

/**
 * @param {Array<Array<number>>} controlPoints
 * @param {object} [style]
 */
export function createCurvedArrow( controlPoints, style = {} ) {

	if ( ! controlPoints || controlPoints.length < 2 ) return [];

	const N = controlPoints.length;
	const cp = controlPoints;

	// 累计长度
	const segLens = [];
	let totalLen = 0;
	for ( let i = 1; i < N; i ++ ) {

		const d = distance2D( cp[ i - 1 ], cp[ i ] );
		segLens.push( d );
		totalLen += d;

	}

	if ( totalLen <= 0 ) return [];

	// 头部尺寸（更细的 body + 较大的头部）
	const bodyHalfW = ( style.bodyWidth ?? totalLen * 0.05 ) * 0.5;
	const headLength = Math.min( style.headLength ?? totalLen * 0.18, segLens[ segLens.length - 1 ] * 0.95 );
	const headHalfW = ( style.headWidth ?? totalLen * 0.14 ) * 0.5;

	// 尾部
	const firstDir = unit( [ cp[ 1 ][ 0 ] - cp[ 0 ][ 0 ], cp[ 1 ][ 1 ] - cp[ 0 ][ 1 ] ] );
	const firstN = leftNormal( firstDir );
	const tailLeft = [ cp[ 0 ][ 0 ] + firstN[ 0 ] * bodyHalfW, cp[ 0 ][ 1 ] + firstN[ 1 ] * bodyHalfW ];
	const tailRight = [ cp[ 0 ][ 0 ] - firstN[ 0 ] * bodyHalfW, cp[ 0 ][ 1 ] - firstN[ 1 ] * bodyHalfW ];

	// 头部 3 点
	const lastDir = unit( [ cp[ N - 1 ][ 0 ] - cp[ N - 2 ][ 0 ], cp[ N - 1 ][ 1 ] - cp[ N - 2 ][ 1 ] ] );
	const lastN = leftNormal( lastDir );
	const tip = cp[ N - 1 ];
	const headBack = [ tip[ 0 ] - lastDir[ 0 ] * headLength, tip[ 1 ] - lastDir[ 1 ] * headLength ];
	const headLeft  = [ headBack[ 0 ] + lastN[ 0 ] * headHalfW, headBack[ 1 ] + lastN[ 1 ] * headHalfW ];
	const headRight = [ headBack[ 0 ] - lastN[ 0 ] * headHalfW, headBack[ 1 ] - lastN[ 1 ] * headHalfW ];

	// 颈部锚点（与 body 同宽，确保 body 与 head 平滑连接）
	const neckLeft  = [ headBack[ 0 ] + lastN[ 0 ] * bodyHalfW, headBack[ 1 ] + lastN[ 1 ] * bodyHalfW ];
	const neckRight = [ headBack[ 0 ] - lastN[ 0 ] * bodyHalfW, headBack[ 1 ] - lastN[ 1 ] * bodyHalfW ];

	// 体部偏移（角平分线，宽度恒定）
	const leftCtrl = [ tailLeft ];
	const rightCtrl = [ tailRight ];
	for ( let i = 1; i < N - 1; i ++ ) {

		const inDir  = unit( [ cp[ i ][ 0 ] - cp[ i - 1 ][ 0 ], cp[ i ][ 1 ] - cp[ i - 1 ][ 1 ] ] );
		const outDir = unit( [ cp[ i + 1 ][ 0 ] - cp[ i ][ 0 ], cp[ i + 1 ][ 1 ] - cp[ i ][ 1 ] ] );
		const inN  = leftNormal( inDir );
		const outN = leftNormal( outDir );

		let bx = inN[ 0 ] + outN[ 0 ];
		let by = inN[ 1 ] + outN[ 1 ];
		let bLen = Math.hypot( bx, by );
		if ( bLen < 0.01 ) { bx = inN[ 0 ]; by = inN[ 1 ]; bLen = 1; }
		bx /= bLen; by /= bLen;

		const sinHalf = Math.abs( inN[ 0 ] * bx + inN[ 1 ] * by );
		const sinClamp = Math.max( sinHalf, 0.4 );
		const wAdj = bodyHalfW / sinClamp;

		leftCtrl.push( [ cp[ i ][ 0 ] + bx * wAdj, cp[ i ][ 1 ] + by * wAdj ] );
		rightCtrl.push( [ cp[ i ][ 0 ] - bx * wAdj, cp[ i ][ 1 ] - by * wAdj ] );

	}

	leftCtrl.push( neckLeft );
	rightCtrl.push( neckRight );

	const left = smoothSide( leftCtrl, 16 );
	const right = smoothSide( rightCtrl, 16 );

	return [
		...left,
		headLeft,
		tip,
		headRight,
		...right.reverse(),
	];

}
