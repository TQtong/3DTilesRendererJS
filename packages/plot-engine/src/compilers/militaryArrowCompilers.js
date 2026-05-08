// ============================================================
// compilers/militaryArrowCompilers.js — 军标箭头家族编译器
// ============================================================
// 把 P1 的 7 种箭头算法包装成 CompilerRegistry 兼容的 compiler。
// 所有军标箭头最终输出都走 polygon 路径渲染（vector channel）。
// ============================================================

import { boundsFromPoints, expandBounds } from '../utils/bounds.js';
import { createFineArrow } from '../arrows/fineArrow.js';
import { createSwallowtailArrow } from '../arrows/swallowtailArrow.js';
import { createCurvedArrow } from '../arrows/curvedArrow.js';
import { createAttackArrow } from '../arrows/attackArrow.js';
import { createTailedAttackArrow } from '../arrows/tailedAttackArrow.js';
import { createDoubleArrow } from '../arrows/doubleArrow.js';
import { createGatheringPlace } from '../arrows/gatheringPlace.js';
import { SDF_TYPES } from './defaultCompilers.js';

function point2( point ) {

	return [ Number( point[ 0 ] ), Number( point[ 1 ] ) ];

}

function flatPoints( points ) {

	const result = [];
	for ( const point of points ) {

		result.push( Number( point[ 0 ] ), Number( point[ 1 ] ) );

	}

	return result;

}

function parseColor( value, fallback ) {

	if ( Array.isArray( value ) ) {

		return [
			value[ 0 ] ?? fallback[ 0 ],
			value[ 1 ] ?? fallback[ 1 ],
			value[ 2 ] ?? fallback[ 2 ],
			value[ 3 ] ?? fallback[ 3 ],
		];

	}

	if ( typeof value === 'number' ) {

		return [
			( ( value >> 16 ) & 255 ) / 255,
			( ( value >> 8 ) & 255 ) / 255,
			( value & 255 ) / 255,
			1,
		];

	}

	if ( typeof value === 'string' && value.startsWith( '#' ) ) {

		let hex = value.slice( 1 );
		if ( hex.length === 3 ) hex = hex.split( '' ).map( c => c + c ).join( '' );
		return [
			parseInt( hex.slice( 0, 2 ), 16 ) / 255,
			parseInt( hex.slice( 2, 4 ), 16 ) / 255,
			parseInt( hex.slice( 4, 6 ), 16 ) / 255,
			1,
		];

	}

	return [ ...fallback ];

}

function styleBlock( style ) {

	const fill = parseColor( style.fillColor ?? style.color, [ 1, 1, 1, 0.35 ] );
	const stroke = parseColor( style.strokeColor ?? style.color, [ 1, 1, 1, 1 ] );
	fill[ 3 ] *= style.fillOpacity ?? style.opacity ?? 1;
	stroke[ 3 ] *= style.strokeOpacity ?? style.opacity ?? 1;
	return {
		fill,
		stroke,
		strokeWidth: style.strokeWidth ?? 1,
		opacity: style.opacity ?? 1,
	};

}

function wrapAsPolygon( shape, polygonPointsOrList, kindOverride = null ) {

	if ( ! polygonPointsOrList ) return null;

	// 支持单多边形（数组的元素是 [x,y]）或多多边形（数组的元素是另一个数组）
	const isMulti = Array.isArray( polygonPointsOrList[ 0 ] ) && Array.isArray( polygonPointsOrList[ 0 ][ 0 ] );
	const polygons = isMulti ? polygonPointsOrList : [ polygonPointsOrList ];
	const validPolygons = polygons.filter( poly => Array.isArray( poly ) && poly.length >= 3 );
	if ( validPolygons.length === 0 ) return null;

	const style = shape.style || {};
	const padding = style.boundsPadding ?? style.strokeWidthWorld ?? 0;

	let mergedBounds = null;
	for ( const poly of validPolygons ) {

		const bounds = boundsFromPoints( poly );
		if ( ! bounds ) continue;
		if ( ! mergedBounds ) mergedBounds = bounds;
		else {

			mergedBounds[ 0 ] = Math.min( mergedBounds[ 0 ], bounds[ 0 ] );
			mergedBounds[ 1 ] = Math.min( mergedBounds[ 1 ], bounds[ 1 ] );
			mergedBounds[ 2 ] = Math.max( mergedBounds[ 2 ], bounds[ 2 ] );
			mergedBounds[ 3 ] = Math.max( mergedBounds[ 3 ], bounds[ 3 ] );

		}

	}

	if ( ! mergedBounds ) return null;

	const heightPoint = shape.coordinates?.find?.( point =>
		point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ),
	);
	const height = heightPoint
		? Number( heightPoint[ 2 ] )
		: Number( style.altitude ?? style.elevation ?? style.z ?? 0 );

	// 给 polygon 顶点附上同样的高度，确保 height-aware polygon 三角化分支生效
	const primitives = validPolygons.map( poly => {

		const points3D = poly.map( point => [ point[ 0 ], point[ 1 ], height ] );
		return {
			kind: 'polygon',
			points: points3D.map( point => [ point[ 0 ], point[ 1 ] ] ),
			points3D,
		};

	} );

	// SDF payload：使用第一个多边形（单 SDF type 限制；多多边形时 SDF 仅近似）
	const sdfPolygon = validPolygons[ 0 ];

	return {
		id: shape.id,
		kind: kindOverride ?? shape.kind,
		revision: shape.revision,
		shape,
		attachment: { mode: 'world', ...shape.attachment },
		style,
		height,
		bounds: expandBounds( mergedBounds, padding ),
		sdf: {
			type: SDF_TYPES.polygon,
			payload: [ sdfPolygon.length, ...flatPoints( sdfPolygon ) ],
			style: styleBlock( style ),
		},
		primitives,
	};

}

// 对 shape.coordinates 数组中的每一项调用 point2，但保留高度
function coordsToXY( coordinates ) {

	return ( coordinates || [] ).map( point2 );

}

function compileFineArrow( shape ) {

	const coords = coordsToXY( shape.coordinates );
	if ( coords.length < 2 ) return null;
	const polygon = createFineArrow( coords[ 0 ], coords[ coords.length - 1 ], shape.style );
	return wrapAsPolygon( shape, polygon );

}

function compileSwallowtailArrow( shape ) {

	const coords = coordsToXY( shape.coordinates );
	if ( coords.length < 2 ) return null;
	const polygon = createSwallowtailArrow( coords[ 0 ], coords[ coords.length - 1 ], shape.style );
	return wrapAsPolygon( shape, polygon );

}

function compileCurvedArrow( shape ) {

	const coords = coordsToXY( shape.coordinates );
	if ( coords.length < 2 ) return null;
	const polygon = createCurvedArrow( coords, shape.style );
	return wrapAsPolygon( shape, polygon );

}

function compileAttackArrow( shape ) {

	const coords = coordsToXY( shape.coordinates );
	if ( coords.length < 2 ) return null;
	if ( coords.length === 2 ) {

		const polygon = createFineArrow( coords[ 0 ], coords[ 1 ], shape.style );
		return wrapAsPolygon( shape, polygon );

	}

	const polygon = createAttackArrow( coords, shape.style );
	return wrapAsPolygon( shape, polygon );

}

function compileTailedAttackArrow( shape ) {

	const coords = coordsToXY( shape.coordinates );
	if ( coords.length < 3 ) {

		// 退化到 fine 箭头
		if ( coords.length < 2 ) return null;
		const polygon = createFineArrow( coords[ 0 ], coords[ coords.length - 1 ], shape.style );
		return wrapAsPolygon( shape, polygon );

	}

	const polygon = createTailedAttackArrow( coords, shape.style );
	return wrapAsPolygon( shape, polygon );

}

function compileDoubleArrow( shape ) {

	const coords = coordsToXY( shape.coordinates );
	if ( coords.length < 3 ) return null;
	const polygon = createDoubleArrow( coords, shape.style );
	return wrapAsPolygon( shape, polygon );

}

function compileGatheringPlace( shape ) {

	const coords = coordsToXY( shape.coordinates );
	if ( coords.length < 3 ) return null;
	const polygon = createGatheringPlace( coords, shape.style );
	return wrapAsPolygon( shape, polygon );

}

export function registerMilitaryArrowCompilers( registry ) {

	registry.register( 'arrow-fine', compileFineArrow );
	registry.register( 'arrow-swallowtail', compileSwallowtailArrow );
	registry.register( 'arrow-curved', compileCurvedArrow );
	registry.register( 'arrow-attack', compileAttackArrow );
	registry.register( 'arrow-tailed-attack', compileTailedAttackArrow );
	registry.register( 'arrow-double', compileDoubleArrow );
	registry.register( 'gathering-place', compileGatheringPlace );
	return registry;

}
