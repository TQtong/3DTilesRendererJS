/**
 * PlotLabel.js — 文本框标绘
 *
 * options = {
 *   points: [[lon, lat]],
 *   content: string,
 *   fontColor: string,
 *   fontSize: number,
 *   fillColor: string,
 *   fillOpacity: number,
 *   strokeColor: string,
 *   strokeWidth: number,
 *   textAlign: 'left' | 'center' | 'right',
 *   verticalAlign: 'top' | 'middle' | 'bottom',
 *   anchorX: 'left' | 'center' | 'right',
 *   anchorY: 'top' | 'middle' | 'bottom',
 *   boxWidth: number,
 *   boxHeight: number,
 *   padding: number,
 *   layoutDirection: 'horizontal' | 'vertical-rl' | 'vertical-lr',
 *   rotation: number,
 *   offsetX: number,
 *   offsetY: number,
 * }
 *
 * options.points[0] is the textbox anchor point in lon / lat degrees.
 * `textAlign` / `verticalAlign` control content alignment inside the box.
 * `anchorX` / `anchorY` control where the box sits relative to the anchor point.
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
