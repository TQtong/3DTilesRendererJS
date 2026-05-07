// ============================================================
// editor/commands/UpdateCoordinatesCommand.js — 整体替换坐标命令
// 层级：命令层
// 职责：把指定 shape 的 coordinates 整体替换为新数组（顶点拖拽提交时使用）
// 依赖：./BaseCommand.js
// 被消费：DragController（pointerup 时压栈）、用户编程接口
// ============================================================

import { BaseCommand, cloneCoordinates } from './BaseCommand.js';

/**
 * 整体替换 shape.coordinates 的命令。
 *
 * 使用场景：
 * - 顶点拖拽结束（pointerup）—— before 是按下时的快照，after 是松手时的最终坐标
 * - 中心控制点平移结束 —— 由 TranslateShapeCommand 产生，但内部也走这条路径
 * - 程序化批量编辑
 */
export class UpdateCoordinatesCommand extends BaseCommand {

	constructor( shapeId, beforeCoords, afterCoords, options = {} ) {

		super();
		this.kind = 'update-coordinates';
		this.shapeId = shapeId;
		this._before = cloneCoordinates( beforeCoords );
		this._after = cloneCoordinates( afterCoords );
		this._coalesceWithPrevious = options.coalesceWithPrevious === true;
		this._coalesceWindowMs = Number( options.coalesceWindowMs ?? 300 );
		this.timestamp = Date.now();

	}

	do( context ) {

		const { shapeStore, plotEngine } = context;
		if ( ! shapeStore.has( this.shapeId ) ) return false;

		shapeStore.update( this.shapeId, { coordinates: cloneCoordinates( this._after ) } );
		plotEngine?.invalidate();
		return true;

	}

	undo( context ) {

		const { shapeStore, plotEngine } = context;
		if ( ! shapeStore.has( this.shapeId ) ) return false;

		shapeStore.update( this.shapeId, { coordinates: cloneCoordinates( this._before ) } );
		plotEngine?.invalidate();
		return true;

	}

	merge( other ) {

		if ( ! ( other instanceof UpdateCoordinatesCommand ) ) return null;
		if ( other.shapeId !== this.shapeId ) return null;
		if ( ! other._coalesceWithPrevious && ! this._coalesceWithPrevious ) return null;
		const dt = other.timestamp - this.timestamp;
		if ( dt < 0 || dt > this._coalesceWindowMs ) return null;

		const merged = new UpdateCoordinatesCommand(
			this.shapeId,
			this._before,
			other._after,
			{
				coalesceWithPrevious: true,
				coalesceWindowMs: this._coalesceWindowMs,
			},
		);
		merged.timestamp = other.timestamp;
		return merged;

	}

	get beforeCoordinates() { return cloneCoordinates( this._before ); }
	get afterCoordinates() { return cloneCoordinates( this._after ); }

}
