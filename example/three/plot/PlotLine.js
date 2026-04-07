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
 * 箭头大小固定为 strokeWidth × 2，由 shader 内部处理。
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
