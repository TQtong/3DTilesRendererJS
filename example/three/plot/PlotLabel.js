/**
 * PlotLabel.js — 文本标绘
 *
 * 对齐 PlotTextOptions = GisPlotBaseOptions & {
 *   content: string,        — 文字内容
 *   fontColor: string,      — 字体颜色
 *   fontSize: number,       — 字体大小（px）
 *   textAlign: 'left' | 'center' | 'right',
 *   showBorder: boolean,
 *   offsetX: number,
 *   offsetY: number,
 * }
 *
 * options.points[0] = [lon, lat] 为标签中心坐标。
 * shader type 4（采样 label atlas 纹理）。
 */

import { PlotBase } from './PlotBase.js';

export class PlotLabel extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'text';

	}

	getCenterPoints() {

		const p = this.options.points;
		return p && p.length > 0 ? [ p[ 0 ] ] : [];

	}

	getExtentPoints() {

		return this.getCenterPoints();

	}

}
