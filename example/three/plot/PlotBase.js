/**
 * PlotBase.js — 标绘对象基类
 *
 * 数据结构对齐 GisPlotBaseOptions：
 *   options = {
 *     points: [[lon, lat], ...],   // 图形的顶点坐标数组
 *     strokeColor: string,         // 描边颜色
 *     strokeWidth: number,         // 描边宽度
 *     strokeOpacity: number,       // 描边不透明度 (0-100)
 *     fillColor: string,           // 填充颜色
 *     fillOpacity: number,         // 填充不透明度 (0-100)
 *     visible: boolean,            // 是否可见
 *   }
 *
 * 子类在 options 中扩展各自特有的字段（如 size、radius、arrowType 等）。
 */

/** 自增图形 ID */
let _nextId = 1;

export class PlotBase {

	/**
	 * @param {object} options - 标绘选项（包含 points 和所有样式参数）
	 */
	constructor( options = {} ) {

		this.id = _nextId ++;
		this.category = '';
		this.options = { ...options };

	}

	/** 合并更新 options */
	update( patch ) {

		Object.assign( this.options, patch );

	}

	/** 深拷贝快照 */
	getSnapshot() {

		const o = { ...this.options };
		if ( o.points ) o.points = o.points.map( p => [ ...p ] );
		return { type: this.category, options: o };

	}

	/** 用于计算 ENU 参考中心的坐标点 */
	getCenterPoints() {

		return this.options.points || [];

	}

	/** 用于计算最大空间范围的坐标点（子类可覆盖以扩展半径等） */
	getExtentPoints() {

		return this.options.points || [];

	}

}
