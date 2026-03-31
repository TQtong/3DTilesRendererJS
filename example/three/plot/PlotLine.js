/**
 * PlotLine.js — 折线标绘
 *
 * 对齐 PlotLineOptions = GisPlotBaseOptions & {
 *   strokeStyle: 'solid' | 'dashed' | 'dotted',
 *   endpointStyle: 'round' | 'square',
 *   showArrow: boolean,
 *   startArrowStyle: PlotArrowStyle | null,
 *   endArrowStyle: PlotArrowStyle | null,
 * }
 *
 * 额外扩展：arrowSize（箭头大小，SDF 渲染需要）。
 * options.points = [[lon, lat], ...] 为折线顶点。
 * shader type 3。
 */

import { PlotBase } from './PlotBase.js';

export class PlotLine extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'line';

	}

}
