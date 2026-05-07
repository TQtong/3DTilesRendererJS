// ============================================================
// editor/commands/BatchCommand.js — 复合命令
// 层级：命令层
// 职责：把 N 条命令打包成一条原子命令，撤销时一次性回滚全部
// 依赖：./BaseCommand.js
// 被消费：用户业务代码（例如：批量删除多个 shape 的同一类顶点）
// ============================================================

import { BaseCommand } from './BaseCommand.js';

/**
 * 复合命令：把多条子命令视为一个原子单元。
 * 入栈一条 BatchCommand 后，undo / redo 一次只前进 / 回退一格。
 */
export class BatchCommand extends BaseCommand {

	constructor( commands, label = 'batch' ) {

		super();
		this.kind = 'batch';
		this.shapeId = null;
		this._commands = Array.isArray( commands ) ? commands.slice() : [];
		this._label = String( label );
		this.timestamp = Date.now();

	}

	do( context ) {

		const succeeded = [];
		for ( let index = 0; index < this._commands.length; index ++ ) {

			const command = this._commands[ index ];
			const ok = command.do( context );
			if ( ! ok ) {

				for ( let rollback = succeeded.length - 1; rollback >= 0; rollback -- ) {

					succeeded[ rollback ].undo( context );

				}

				return false;

			}

			succeeded.push( command );

		}

		return true;

	}

	undo( context ) {

		let allOk = true;
		for ( let index = this._commands.length - 1; index >= 0; index -- ) {

			const ok = this._commands[ index ].undo( context );
			if ( ! ok ) allOk = false;

		}

		return allOk;

	}

	get commands() { return this._commands.slice(); }
	get label() { return this._label; }

}
