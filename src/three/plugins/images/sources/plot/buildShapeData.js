/**
 * @fileoverview 将矢量标绘 shapes 编码为 1D Float32 纹理数据。
 *
 * 提供两种模式：
 * - **RTT 模式** (`screenSpace=false`)：strokeWidth 等按 `pxDeg` 转换为度数，供 TileSdfShader 的固定分辨率 pass 使用。
 * - **屏幕空间模式** (`screenSpace=true`)：strokeWidth 等保持像素值，着色器用 `fwidth()` 实时转换。
 *
 * 支持 `refLonLat` 选项（RTC）：坐标值减去参考点后存储，消除 float32 精度不足问题。
 *
 * @module images/sources/plot/buildShapeData
 */

import { DataTexture, FloatType, RGBAFormat, NearestFilter, LinearSRGBColorSpace, MathUtils } from 'three';

const DEG2RAD = MathUtils.DEG2RAD;
const MAX_LINE_POINTS = 64;

/**
 * @param {string | undefined} color
 * @returns {[number, number, number, number]} RGBA linear 0..1
 */
export function parseColor( color ) {

	if ( ! color || color === 'transparent' ) return [ 0, 0, 0, 0 ];

	if ( typeof color === 'string' && color.startsWith( '#' ) ) {

		let hex = color.slice( 1 );
		if ( hex.length === 3 ) hex = hex[ 0 ] + hex[ 0 ] + hex[ 1 ] + hex[ 1 ] + hex[ 2 ] + hex[ 2 ];
		return [
			parseInt( hex.slice( 0, 2 ), 16 ) / 255,
			parseInt( hex.slice( 2, 4 ), 16 ) / 255,
			parseInt( hex.slice( 4, 6 ), 16 ) / 255,
			1.0,
		];

	}

	return [ 1, 1, 1, 1 ];

}

/**
 * @param {string | null | undefined} style
 * @returns {number}
 */
export function arrowInt( style ) {

	if ( ! style ) return 0;
	// Supported styles only. Shader branches: 1=triangle, 3=diamond, 5=circle, 7=bar.
	return { 'filledArrow': 1, 'filledDiamond': 3, 'filledCircle': 5, 'bar': 7 }[ style ] || 0;

}

/**
 * @param {number[]} a [minLon, minLat, maxLon, maxLat]
 * @param {number[]} b
 * @returns {boolean}
 */
export function boundsIntersect( a, b ) {

	if ( ! a || ! b ) return false;
	return ! ( a[ 2 ] < b[ 0 ] || a[ 0 ] > b[ 2 ] || a[ 3 ] < b[ 1 ] || a[ 1 ] > b[ 3 ] );

}

function appendLineShapeData( arr, pts, opts, strokeOp, op, rLo, rLa ) {

	const vc = pts.length;
	if ( vc < 2 ) return 0;

	const sw = opts.strokeWidth || 3;
	const hwPx = sw / 2;
	const sa = arrowInt( opts.startArrowStyle );
	const ea = arrowInt( opts.endArrowStyle );

	let sumLat = 0;
	for ( const c of pts ) sumLat += c[ 1 ];
	const cosMidLat = Math.cos( ( sumLat / vc ) * DEG2RAD );

	let dashLen_m = 0, gapLen_m = 0;
	if ( opts.strokeStyle === 'dashed' ) {

		dashLen_m = 10;
		gapLen_m = 10;

	} else if ( opts.strokeStyle === 'dotted' ) {

		dashLen_m = 0;
		gapLen_m = - 5;

	}

	const lineColor = parseColor( opts.strokeColor || opts.fillColor || '#ffffff' );
	lineColor[ 3 ] *= strokeOp;

	const meterScaleX = cosMidLat * 111320;
	const meterScaleY = 111320;
	const segmentLengths = new Array( vc - 1 );
	for ( let i = 0; i < vc - 1; i ++ ) {

		const a = pts[ i ];
		const b = pts[ i + 1 ];
		segmentLengths[ i ] = Math.hypot(
			( b[ 0 ] - a[ 0 ] ) * meterScaleX,
			( b[ 1 ] - a[ 1 ] ) * meterScaleY,
		);

	}

	let shapeCount = 0;
	let chunkStart = 0;
	let arcOffset = 0;
	while ( chunkStart < vc - 1 ) {

		const chunkVc = Math.min( MAX_LINE_POINTS, vc - chunkStart );
		const chunkEnd = chunkStart + chunkVc;
		const chunkSa = chunkStart === 0 ? sa : 0;
		const chunkEa = chunkEnd === vc ? ea : 0;
		const total = 20 + chunkVc * 2;

		arr.push(
			3, total,
			lineColor[ 0 ], lineColor[ 1 ], lineColor[ 2 ], lineColor[ 3 ],
			0, 0, 0, 0,
			0, op,
			chunkVc, hwPx, chunkSa, chunkEa, dashLen_m, gapLen_m, cosMidLat, arcOffset,
		);
		for ( let i = chunkStart; i < chunkEnd; i ++ ) {

			const c = pts[ i ];
			arr.push( c[ 0 ] - rLo, c[ 1 ] - rLa );

		}

		shapeCount ++;
		if ( chunkEnd >= vc ) break;

		for ( let i = chunkStart; i < chunkEnd - 1; i ++ ) {

			arcOffset += segmentLengths[ i ];

		}

		chunkStart = chunkEnd - 1;

	}

	return shapeCount;

}

/**
 * 将 `tileBounds` 内相交的图元编码为 1D Float32 纹理。
 *
 * @param {Map<number, object>} shapes shape 集合
 * @param {number[]} tileBounds [minLon, minLat, maxLon, maxLat] 度
 * @param {object} options
 * @param {boolean} [options.screenSpace=false] true 时像素相关量保持像素值
 * @param {number} [options.resolution=256] RTT 模式下纹理分辨率
 * @param {function} [options.getShapeBounds] 返回 shape 外包盒
 * @param {Map} [options.labelTiles] 文字 atlas UV 信息
 * @param {number[]} [options.refLonLat] [refLon, refLat] RTC 参考点（度），坐标减去此值后存储
 * @returns {DataTexture | null}
 */
export function buildShapeData( shapes, tileBounds, options = {} ) {

	const {
		screenSpace = false,
		resolution = 256,
		getShapeBounds = null,
		labelTiles = null,
		refLonLat = null,
	} = options;

	const rLo = refLonLat ? refLonLat[ 0 ] : 0;
	const rLa = refLonLat ? refLonLat[ 1 ] : 0;

	const midLat = ( tileBounds[ 1 ] + tileBounds[ 3 ] ) / 2;
	const metersPerDegLon = 111320 * Math.cos( midLat * DEG2RAD );
	const metersPerDegLat = 111320;

	const pxDeg = screenSpace ? 1 : ( tileBounds[ 2 ] - tileBounds[ 0 ] ) / resolution;

	let shapeCount = 0;
	const arr = [ 0 ];

	for ( const [ id, shape ] of shapes ) {

		const opts = shape.options;
		if ( opts.visible === false ) continue;

		const shapeBounds = getShapeBounds ? getShapeBounds( shape ) : null;
		if ( shapeBounds && ! boundsIntersect( shapeBounds, tileBounds ) ) continue;
		if ( ! shapeBounds && getShapeBounds ) continue;

		const fill = parseColor( opts.fillColor );
		const stroke = parseColor( opts.strokeColor );

		const fillOp = opts.fillOpacity !== undefined ? opts.fillOpacity / 100 : 1;
		const strokeOp = opts.strokeOpacity !== undefined ? opts.strokeOpacity / 100 : 1;
		fill[ 3 ] *= fillOp;
		stroke[ 3 ] *= strokeOp;

		const swVal = ( opts.strokeWidth || 0 ) * pxDeg;
		const op = 1.0;
		const pts = opts.points || [];
		const cat = shape.category;

		if ( cat === 'point' ) {

			if ( pts.length === 0 ) continue;
			const hsLon = ( opts.size || 0 ) / 2 / metersPerDegLon;
			const hsLat = ( opts.size || 0 ) / 2 / metersPerDegLat;
			const ps = opts.pointStyle === 'square' ? 1 : 0;
			arr.push( 6, 17, ...fill, ...stroke, swVal, op,
				pts[ 0 ][ 0 ] - rLo, pts[ 0 ][ 1 ] - rLa,
				hsLon, hsLat, ps );
			shapeCount ++;

		} else if ( cat === 'line' ) {

			shapeCount += appendLineShapeData( arr, pts, opts, strokeOp, op, rLo, rLa );

		} else if ( cat === 'polygon' || cat === 'rectangle' ) {

			const vc = pts.length;
			if ( vc < 3 ) continue;
			const total = 13 + vc * 2;
			arr.push( 2, total, ...fill, ...stroke, swVal, op, vc );
			for ( const c of pts ) arr.push( c[ 0 ] - rLo, c[ 1 ] - rLa );
			shapeCount ++;

		} else if ( cat === 'circle' ) {

			if ( pts.length === 0 ) continue;
			const rlLon = ( opts.radius || 0 ) / metersPerDegLon;
			const rlLat = ( opts.radius || 0 ) / metersPerDegLat;
			arr.push( 1, 16, ...fill, ...stroke, swVal, op,
				pts[ 0 ][ 0 ] - rLo, pts[ 0 ][ 1 ] - rLa,
				rlLon, rlLat );
			shapeCount ++;

		} else if ( cat === 'sector' ) {

			if ( pts.length === 0 ) continue;
			const rlLon = ( opts.radius || 0 ) / metersPerDegLon;
			const rlLat = ( opts.radius || 0 ) / metersPerDegLat;
			arr.push( 5, 18, ...fill, ...stroke, swVal, op,
				pts[ 0 ][ 0 ] - rLo, pts[ 0 ][ 1 ] - rLa,
				rlLon, rlLat,
				( opts.startAngle || 0 ) * DEG2RAD,
				( opts.sectorAngle || 0 ) * DEG2RAD );
			shapeCount ++;

		} else if ( cat === 'text' ) {

			if ( pts.length === 0 || ! labelTiles ) continue;
			const tile = labelTiles.get( id );
			if ( ! tile ) continue;
			arr.push( 4, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, op,
				pts[ 0 ][ 0 ] - rLo + tile.centerLonOffsetDeg,
				pts[ 0 ][ 1 ] - rLa + tile.centerLatOffsetDeg,
				tile.halfWDeg,
				tile.halfHDeg,
				tile.cosRotation,
				tile.sinRotation,
				tile.u0, tile.v0, tile.u1, tile.v1 );
			shapeCount ++;

		} else if ( cat === 'arrow' ) {

			const verts = shape.generateCoords();
			const vc = verts.length;
			if ( vc < 3 ) continue;
			const total = 13 + vc * 2;
			arr.push( 2, total, ...fill, ...stroke, swVal, op, vc );
			for ( const c of verts ) arr.push( c[ 0 ] - rLo, c[ 1 ] - rLa );
			shapeCount ++;

		}

	}

	if ( shapeCount === 0 ) return null;

	arr[ 0 ] = shapeCount;

	const data = new Float32Array( arr );
	const texWidth = Math.ceil( data.length / 4 );
	const padded = new Float32Array( texWidth * 4 );
	padded.set( data );

	const tex = new DataTexture( padded, texWidth, 1, RGBAFormat, FloatType );
	tex.minFilter = NearestFilter;
	tex.magFilter = NearestFilter;
	tex.colorSpace = LinearSRGBColorSpace;
	tex.needsUpdate = true;
	return tex;

}
