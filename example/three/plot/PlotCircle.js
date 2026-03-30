/**
 * PlotCircle.js — 圆标绘
 *
 * 基于 GisPlotBaseOptions 扩展：
 *   radius: number  — 半径（米）
 *
 * options.points[0] = [lon, lat] 为圆心坐标。
 * shader type 1。
 *
 * 注：参考 types.ts 中无 circle 类别，此为本系统的扩展类型。
 */

import { PlotBase } from './PlotBase.js';
import { DEG2RAD } from './coordUtils.js';

export class PlotCircle extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'circle';

	}

	getExtentPoints() {

		const p = this.options.points;
		if ( ! p || p.length === 0 ) return [];
		const lon = p[ 0 ][ 0 ], lat = p[ 0 ][ 1 ];
		const r = this.options.radius || 0;
		const dLon = r / ( 111320 * Math.cos( lat * DEG2RAD ) );
		const dLat = r / 111320;
		return [
			[ lon - dLon, lat - dLat ],
			[ lon + dLon, lat + dLat ],
		];

	}

}
