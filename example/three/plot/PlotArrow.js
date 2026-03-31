/**
 * PlotArrow.js — 箭头标绘
 *
 * 对齐 PlotArrowOptions = GisPlotBaseOptions & {
 *   strokeStyle: 'solid' | 'dashed',
 *   arrowType: 'straight' | 'curved' | 'fine' | 'attack',
 *   headSize: number,
 * }
 *
 * options.points = [[lon, lat], ...] 为控制点。
 * CPU 端由 ArrowUtils 生成多边形顶点 → generatedCoords，复用 polygon type 2 渲染。
 */

import { PlotBase } from './PlotBase.js';
import { createFineArrow, createCurvedArrow, createAttackArrow } from './ArrowUtils.js';

export class PlotArrow extends PlotBase {

	constructor( options = {} ) {

		super( options );
		this.category = 'arrow';
		/** ArrowUtils 生成的闭合多边形顶点（由 generateCoords 填充） */
		this.generatedCoords = [];

	}

	/**
	 * 根据 arrowType 和控制点生成闭合多边形顶点。
	 * 在 GroundDecalManager._rebuildShapeData() 中被调用。
	 * @returns {Array<[number, number]>} 生成的多边形顶点
	 */
	generateCoords() {

		const cp = this.options.points;
		if ( ! cp || cp.length < 2 ) return [];

		const arrowType = this.options.arrowType || 'straight';

		if ( arrowType === 'fine' ) {

			this.generatedCoords = createFineArrow( cp[ 0 ], cp[ 1 ] );

		} else if ( arrowType === 'curved' ) {

			this.generatedCoords = createCurvedArrow( cp );

		} else if ( arrowType === 'attack' && cp.length >= 3 ) {

			this.generatedCoords = createAttackArrow( cp );

		} else {

			this.generatedCoords = createFineArrow( cp[ 0 ], cp[ cp.length - 1 ] );

		}

		return this.generatedCoords;

	}

	getSnapshot() {

		const s = super.getSnapshot();
		s.generatedCoords = this.generatedCoords.map( c => [ ...c ] );
		return s;

	}

}
