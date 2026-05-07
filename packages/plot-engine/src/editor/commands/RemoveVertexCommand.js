// ============================================================
// editor/commands/RemoveVertexCommand.js — 删除顶点
// 层级：命令层
// 职责：从指定 shape 的 coordinates 中删除指定 index 的顶点
// 依赖：./BaseCommand.js
// 被消费：DragController（顶点 handle 上 alt+click / dblclick）
// ============================================================

import { BaseCommand, cloneCoordinates } from './BaseCommand.js';

/**
 * 删除一个顶点。每种 shape 的最低顶点数约束由 ShapeEditAdapter 在调用前检查，
 * 命令本身只负责状态翻转，不做合法性裁剪。
 *
 * 例：polygon 必须 ≥ 3 个顶点；line 必须 ≥ 2 个；rectangle 不允许删（只能 resize）。
 */
export class RemoveVertexCommand extends BaseCommand {

	constructor( shapeId, removeIndex, beforeCoords ) {

		super();
		this.kind = 'remove-vertex';
		this.shapeId = shapeId;
		this._removeIndex = removeIndex | 0;
		this._before = cloneCoordinates( beforeCoords );
		this._removedPoint = this._before[ this._removeIndex ]
			? this._before[ this._removeIndex ].slice()
			: null;
		this._after = this._computeAfter();
		this.timestamp = Date.now();

	}

	_computeAfter() {

		const after = cloneCoordinates( this._before );
		if ( this._removeIndex >= 0 && this._removeIndex < after.length ) {

			after.splice( this._removeIndex, 1 );

		}

		return after;

	}

	do( context ) {

		const { shapeStore, plotEngine } = context;
		if ( ! shapeStore.has( this.shapeId ) ) return false;
		if ( ! this._removedPoint ) return false;

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

	merge() { return null; }

	get removedIndex() { return this._removeIndex; }
	get removedPoint() { return this._removedPoint ? this._removedPoint.slice() : null; }

}
