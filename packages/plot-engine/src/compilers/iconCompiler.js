// ============================================================
// compilers/iconCompiler.js — 通用 icon 与 milsymbol（占位）
// ============================================================
//
// kind: 'icon' / 'milsymbol'
//
// shape.style:
//   icon:        url 或预加载的 HTMLImageElement / ImageBitmap
//   sidc:        MIL-STD 2525 SIDC 编码（仅 milsymbol；引擎运行时如有 milsymbol 库则栅格化）
//   width/height: 世界尺寸
//   rotation:    弧度
//   color:       overlay tint
//

import { expandBounds } from '../utils/bounds.js';

function styleBlock( style ) {

	return {
		fill: [ 1, 1, 1, 1 ],
		stroke: [ 1, 1, 1, 1 ],
		strokeWidth: style.strokeWidth ?? 1,
		opacity: style.opacity ?? 1,
	};

}

function compileIcon( shape ) {

	const coordinates = shape.coordinates || [];
	if ( coordinates.length < 1 ) return null;

	const anchor = [ Number( coordinates[ 0 ][ 0 ] ), Number( coordinates[ 0 ][ 1 ] ) ];
	const heightPoint = coordinates.find( point => point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) );
	const height = heightPoint ? Number( heightPoint[ 2 ] ) : Number( shape.style?.altitude ?? 0 );

	const style = shape.style || {};
	const width = Number( style.width ?? 1 );
	const heightSize = Number( style.height ?? width );
	const halfW = width * 0.5;
	const halfH = heightSize * 0.5;
	const bounds = [
		anchor[ 0 ] - halfW,
		anchor[ 1 ] - halfH,
		anchor[ 0 ] + halfW,
		anchor[ 1 ] + halfH,
	];

	return {
		id: shape.id,
		kind: shape.kind,
		revision: shape.revision,
		shape,
		attachment: { mode: 'world', ...shape.attachment },
		style,
		height,
		bounds: expandBounds( bounds, style.boundsPadding ?? 0 ),
		sdf: { type: 6, payload: [], style: styleBlock( style ) },
		primitives: [ {
			kind: 'icon',
			anchor,
			width,
			height: heightSize,
			altitude: height,
			rotation: Number( style.rotation ?? 0 ),
			source: style.icon ?? null,
			sidc: style.sidc ?? null,
			color: style.color ?? '#ffffff',
		} ],
	};

}

export function registerIconCompiler( registry ) {

	registry.register( 'icon', compileIcon );
	registry.register( 'milsymbol', compileIcon );
	return registry;

}
