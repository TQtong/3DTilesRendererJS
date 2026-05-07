// ============================================================
// editor/commands/InsertVertexCommand.js — 在折线 / 多边形上插入顶点
// 层级：命令层
// 职责：在指定 index 位置插入新顶点，并把整个 coordinates 替换写回
// 依赖：./BaseCommand.js
// 被消费：DragController（点击中点 handle 时触发）
// ============================================================

import { BaseCommand, cloneCoordinates } from './BaseCommand.js';

/**
 * 在 polyline / polygon / line 上插入顶点。
 *
 * 与 OpenLayers ol/interaction/Modify 的实现一致：每条边的中点是一个虚拟 handle，
 * 按下中点即调用本命令，把虚拟点"实化"为真实顶点；之后立即转入对该新顶点的拖拽。
 */
export class InsertVertexCommand extends BaseCommand {

	constructor( shapeId, insertIndex, point, beforeCoords ) {

		super();
		this.kind = 'insert-vertex';
		this.shapeId = shapeId;
		this._insertIndex = insertIndex | 0;
		this._point = point.length > 2
			? [ Number( point[ 0 ] ), Number( point[ 1 ] ), Number( point[ 2 ] ) ]
			: [ Number( point[ 0 ] ), Number( point[ 1 ] ) ];
		this._before = cloneCoordinates( beforeCoords );

		this._after = this._computeAfter();
		this.timestamp = Date.now();

	}

	_computeAfter() {

		const after = cloneCoordinates( this._before );
		const clamped = Math.max( 0, Math.min( this._insertIndex, after.length ) );
		const pointCopy = this._point.length > 2
			? [ this._point[ 0 ], this._point[ 1 ], this._point[ 2 ] ]
			: [ this._point[ 0 ], this._point[ 1 ] ];
		after.splice( clamped, 0, pointCopy );
		return after;

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

	merge() { return null; }

	get insertedIndex() { return this._insertIndex; }
	get insertedPoint() { return this._point.slice(); }
	get afterCoordinates() { return cloneCoordinates( this._after ); }

}
