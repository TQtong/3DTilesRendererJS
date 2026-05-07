// ============================================================
// editor/commands/BaseCommand.js — 命令基类
// 层级：命令层
// 职责：定义所有 Command 的最小接口（do / undo / merge 可选）
// 依赖：无
// 被消费：所有具体 Command 子类、EditorHistory
// ============================================================

/**
 * 所有编辑命令的抽象基类。
 *
 * 设计动机参考 deck.gl `editable-layers` 的 editAction 模型：
 * 每个命令携带足够的 before / after 状态，使得 undo / redo 是纯粹的状态回放，
 * 不依赖外部隐式状态。
 *
 * 子类约定：
 * - constructor 中固化所有需要回放的快照（深拷贝）
 * - do(context) 必须幂等：重复调用结果一致
 * - undo(context) 也必须幂等
 * - 可选实现 merge(other) 用于命令折叠（例如同一拖拽帧内的连续 Translate）
 */
export class BaseCommand {

	constructor() {

		this.kind = 'base';
		this.shapeId = null;
		this.timestamp = 0;

	}

	/**
	 * 应用命令。子类必须 override。
	 *
	 * @param {object} context - 包含 { shapeStore, plotEngine, editor } 的上下文
	 * @returns {boolean} 应用是否成功
	 */
	do( context ) { // eslint-disable-line no-unused-vars

		throw new Error( 'BaseCommand.do() must be implemented by subclass.' );

	}

	/**
	 * 撤销命令。子类必须 override。
	 *
	 * @param {object} context
	 * @returns {boolean}
	 */
	undo( context ) { // eslint-disable-line no-unused-vars

		throw new Error( 'BaseCommand.undo() must be implemented by subclass.' );

	}

	/**
	 * 尝试将本命令与另一个命令合并为一个，避免 undo 栈被密集小操作淹没。
	 *
	 * 默认实现：拒绝合并。子类可按需 override。
	 *
	 * @param {BaseCommand} other
	 * @param {object} options
	 * @returns {BaseCommand|null}
	 */
	merge( other, options = {} ) { // eslint-disable-line no-unused-vars

		return null;

	}

	toJSON() {

		return {
			kind: this.kind,
			shapeId: this.shapeId,
			timestamp: this.timestamp,
		};

	}

}

/**
 * 深拷贝坐标数组。所有 Command 的 before/after 快照必须使用此函数，
 * 避免与 ShapeStore 内部数组共享引用导致 undo 时拿到污染数据。
 *
 * @param {Array<Array<number>>} coordinates
 * @returns {Array<Array<number>>}
 */
export function cloneCoordinates( coordinates ) {

	if ( ! Array.isArray( coordinates ) ) return [];
	const result = new Array( coordinates.length );
	for ( let index = 0; index < coordinates.length; index ++ ) {

		const point = coordinates[ index ];
		result[ index ] = point.length > 2
			? [ point[ 0 ], point[ 1 ], point[ 2 ] ]
			: [ point[ 0 ], point[ 1 ] ];

	}

	return result;

}

/**
 * 深拷贝 style 对象。
 *
 * @param {object} style
 * @returns {object}
 */
export function cloneStyle( style ) {

	return { ...( style || {} ) };

}
