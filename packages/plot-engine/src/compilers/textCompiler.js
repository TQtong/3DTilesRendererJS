// ============================================================
// compilers/textCompiler.js — 文本（Canvas atlas 烤制）
// ============================================================
//
// kind: 'text-label' / 'text-leader'
//
// shape.style:
//   text       - 字符串
//   fontSize   - 文本高度（世界单位 / 像素）
//   fontFamily
//   fontColor  - 字色
//   bgColor    - 背景色（半透明可选）
//   anchor     - 'center' | 'left' | 'right' | 'top' | 'bottom' 等组合
//   leaderTo   - 引出线终点 [x, y]（仅 text-leader）
//

import { boundsFromPoints, expandBounds } from '../utils/bounds.js';

function styleBlock( style ) {

	return {
		fill: [ 1, 1, 1, 1 ],
		stroke: [ 1, 1, 1, 1 ],
		strokeWidth: style.strokeWidth ?? 1,
		opacity: style.opacity ?? 1,
	};

}

function compileTextLabel( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 1 ) return null;

	const anchor = [ Number( coordinates[ 0 ][ 0 ] ), Number( coordinates[ 0 ][ 1 ] ) ];
	const heightPoint = coordinates.find( point => point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) );
	const height = heightPoint ? Number( heightPoint[ 2 ] ) : Number( shape.style?.altitude ?? 0 );
	const style = shape.style || {};
	const fontSize = Number( style.fontSize ?? 1 );
	const text = String( style.text ?? '' );
	if ( text.length === 0 ) return null;

	// 估算 bounds（基于字符数 × fontSize × 0.6，作为 worst-case 包围盒）
	const approxWidth = text.length * fontSize * 0.65;
	const approxHeight = fontSize * 1.4;
	const halfW = approxWidth * 0.5;
	const halfH = approxHeight * 0.5;
	const bounds = [
		anchor[ 0 ] - halfW,
		anchor[ 1 ] - halfH,
		anchor[ 0 ] + halfW,
		anchor[ 1 ] + halfH,
	];

	const primitives = [ {
		kind: 'text',
		anchor,
		text,
		fontSize,
		fontFamily: style.fontFamily ?? 'sans-serif',
		fontColor: style.fontColor ?? '#ffffff',
		bgColor: style.bgColor ?? 'rgba(15,23,42,0.65)',
		padding: style.padding ?? fontSize * 0.25,
		strokeColor: style.strokeColor ?? null,
		strokeWidth: style.strokeWidth ?? 0,
		height,
	} ];

	if ( shape.kind === 'text-leader' && style.leaderTo ) {

		const leaderTo = [ Number( style.leaderTo[ 0 ] ), Number( style.leaderTo[ 1 ] ) ];
		primitives.push( {
			kind: 'text-leader-line',
			from: leaderTo,
			to: anchor,
			height,
			color: style.leaderColor ?? style.fontColor ?? '#ffffff',
			width: style.leaderWidth ?? Math.max( fontSize * 0.05, 1e-6 ),
		} );

		const leaderBounds = boundsFromPoints( [ leaderTo, anchor ] );
		if ( leaderBounds ) {

			bounds[ 0 ] = Math.min( bounds[ 0 ], leaderBounds[ 0 ] );
			bounds[ 1 ] = Math.min( bounds[ 1 ], leaderBounds[ 1 ] );
			bounds[ 2 ] = Math.max( bounds[ 2 ], leaderBounds[ 2 ] );
			bounds[ 3 ] = Math.max( bounds[ 3 ], leaderBounds[ 3 ] );

		}

	}

	return {
		id: shape.id,
		kind: shape.kind,
		revision: shape.revision,
		shape,
		attachment: { mode: 'world', ...shape.attachment },
		style,
		height,
		bounds: expandBounds( bounds, style.boundsPadding ?? 0 ),
		sdf: { type: 4, payload: [], style: styleBlock( style ) },
		primitives,
	};

}

export function registerTextCompiler( registry ) {

	registry.register( 'text-label', compileTextLabel );
	registry.register( 'text-leader', compileTextLabel );
	return registry;

}
