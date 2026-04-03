/**
 * PlotRectangle.js — 矩形标绘
 *
 * 对齐 PlotRectangleOptions = GisPlotBaseOptions & {
 *   strokeStyle: 'solid' | 'dashed',
 * }
 *
 * 扩展字段（SDF 渲染需要）：
 *   width:  number  — 宽度（米）
 *   height: number  — 高度（米）
 *
 * options.points[0] = [lon, lat] 为矩形中心坐标。
 * shader type 0（sdBox SDF）。
 */

import { PlotBase } from './PlotBase.js';
import { DEG2RAD } from './coordUtils.js';

export class PlotRectangle extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'rectangle';

	}

	// getExtentPoints() {

	// 	const p = this.options.points;
	// 	if ( ! p || p.length === 0 ) return [];
	// 	const lon = p[ 0 ][ 0 ], lat = p[ 0 ][ 1 ];
	// 	const hw = ( this.options.width || 0 ) / 2;
	// 	const hh = ( this.options.height || 0 ) / 2;
	// 	const dLon = hw / ( 111320 * Math.cos( lat * DEG2RAD ) );
	// 	const dLat = hh / 111320;
	// 	return [
	// 		[ lon, lat ],
	// 		[ lon - dLon, lat - dLat ],
	// 		[ lon + dLon, lat + dLat ],
	// 	];

	// }

}
