/**
 * PlotPoint.js — 点标绘
 *
 * 对齐 PlotPointOptions = GisPlotBaseOptions & {
 *   pointStyle: 'circle' | 'square',
 *   size: number,      // 直径（米）
 * }
 *
 * options.points[0] = [lon, lat] 为点的中心坐标。
 * shader type 6。
 */

import { PlotBase } from './PlotBase.js';

export class PlotPoint extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'point';

	}

	getSnapshot() {

		const s = super.getSnapshot();
		return s;

	}

	getCenterPoints() {

		const p = this.options.points;
		return p && p.length > 0 ? [ p[ 0 ] ] : [];

	}

	getExtentPoints() {

		return this.getCenterPoints();

	}

}
