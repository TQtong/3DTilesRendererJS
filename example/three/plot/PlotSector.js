/**
 * PlotSector.js — 扇形标绘
 *
 * 对齐 PlotSectorOptions = GisPlotBaseOptions & {
 *   strokeStyle: 'solid' | 'dashed',
 *   radius: number,       — 半径（米）
 *   startAngle: number,   — 起始角度（度）
 *   sectorAngle: number,  — 扇形角度（度）
 * }
 *
 * options.points[0] = [lon, lat] 为扇形中心坐标。
 * shader type 5。
 */

import { PlotBase } from './PlotBase.js';
import { DEG2RAD } from './coordUtils.js';

export class PlotSector extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'sector';

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
