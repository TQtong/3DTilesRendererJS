// ============================================================
// editor/commands/TranslateShapeCommand.js — 整体平移命令
// 层级：命令层
// 职责：把指定 shape 的所有 coordinates 整体加上 (dx, dy[, dz])
// 依赖：./BaseCommand.js
// 被消费：DragController（拖拽中心控制点提交时触发）
// ============================================================

import { BaseCommand } from './BaseCommand.js';

/**
 * 整体平移一个 shape。do/undo 都用 +delta / -delta 计算，
 * 不依赖快照中的具体坐标值，保证多次撤销 / 重做的数值稳定性。
 *
 * 与 UpdateCoordinatesCommand 的区别：
 * - Translate 携带的是 delta，体积更小，可序列化为简短日志
 * - Translate 之间可以做加法折叠
 */
export class TranslateShapeCommand extends BaseCommand {

	constructor( shapeId, dx, dy, dz = 0, options = {} ) {

		super();
		this.kind = 'translate-shape';
		this.shapeId = shapeId;
		this._dx = Number( dx ) || 0;
		this._dy = Number( dy ) || 0;
		this._dz = Number( dz ) || 0;
		this._coalesceWindowMs = Number( options.coalesceWindowMs ?? 300 );
		this.timestamp = Date.now();

	}

	do( context ) {

		return this._applyDelta( context, this._dx, this._dy, this._dz );

	}

	undo( context ) {

		return this._applyDelta( context, - this._dx, - this._dy, - this._dz );

	}

	_applyDelta( context, dx, dy, dz ) {

		const { shapeStore, plotEngine } = context;
		const current = shapeStore.get( this.shapeId );
		if ( ! current ) return false;

		const original = current.coordinates || [];
		const next = new Array( original.length );
		for ( let index = 0; index < original.length; index ++ ) {

			const point = original[ index ];
			if ( point.length > 2 ) {

				next[ index ] = [
					point[ 0 ] + dx,
					point[ 1 ] + dy,
					point[ 2 ] + dz,
				];

			} else {

				next[ index ] = [ point[ 0 ] + dx, point[ 1 ] + dy ];

			}

		}

		shapeStore.update( this.shapeId, { coordinates: next } );
		plotEngine?.invalidate();
		return true;

	}

	merge( other ) {

		if ( ! ( other instanceof TranslateShapeCommand ) ) return null;
		if ( other.shapeId !== this.shapeId ) return null;
		const dt = other.timestamp - this.timestamp;
		if ( dt < 0 || dt > this._coalesceWindowMs ) return null;

		const merged = new TranslateShapeCommand(
			this.shapeId,
			this._dx + other._dx,
			this._dy + other._dy,
			this._dz + other._dz,
			{ coalesceWindowMs: this._coalesceWindowMs },
		);
		merged.timestamp = other.timestamp;
		return merged;

	}

	get deltaX() { return this._dx; }
	get deltaY() { return this._dy; }
	get deltaZ() { return this._dz; }

}
