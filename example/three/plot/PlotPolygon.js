/**
 * PlotPolygon.js — 多边形标绘
 *
 * 对齐 PlotPolygonOptions = GisPlotBaseOptions & {
 *   strokeStyle: 'solid' | 'dashed',
 *   fillStyle: 'solid' | 'diagonal' | 'grid',
 * }
 *
 * options.points = [[lon, lat], ...] 为多边形顶点（至少 3 个，shader 最多 64 个）。
 * shader type 2。
 */

import { PlotBase } from './PlotBase.js';

export class PlotPolygon extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'polygon';

	}

}
