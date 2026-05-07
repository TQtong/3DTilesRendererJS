// ============================================================
// editor/EditorHistory.js — 命令栈与撤销/重做
// 层级：编辑层
// 职责：维护 do/undo 双栈、容量上限、自动折叠相邻命令、对外发事件
// 依赖：./commands/BaseCommand.js
// 被消费：PlotEditor、用户业务代码（按钮 / 快捷键回调）
// ============================================================

import { BaseCommand } from './commands/BaseCommand.js';

/**
 * 命令栈管理器。
 *
 * 设计参考：
 * - VSCode 的 IUndoRedoService —— 双栈 + 大小限制
 * - deck.gl editable-layers 的 editAction stream —— 命令是状态转移函数
 * - Mapbox GL Draw 的 history —— 提供 stop_history / restart 钩子用于"非历史性"操作
 *
 * 事件：
 * - 'change' { canUndo, canRedo, lastCommand }
 * - 'execute' { command }
 * - 'undo' { command }
 * - 'redo' { command }
 */
export class EditorHistory {

	constructor( options = {} ) {

		this._capacity = Math.max( 1, options.capacity ?? 200 );
		this._autoCoalesce = options.autoCoalesce !== false;

		this._undoStack = [];
		this._redoStack = [];

		this._enabled = true;
		this._listeners = new Map();

		this._context = null;

	}

	setContext( context ) {

		this._context = context;

	}

	get enabled() { return this._enabled; }
	set enabled( value ) { this._enabled = Boolean( value ); }

	get canUndo() { return this._enabled && this._undoStack.length > 0; }
	get canRedo() { return this._enabled && this._redoStack.length > 0; }

	get undoSize() { return this._undoStack.length; }
	get redoSize() { return this._redoStack.length; }

	getStackSnapshot() {

		return {
			undo: this._undoStack.map( command => command.toJSON() ),
			redo: this._redoStack.map( command => command.toJSON() ),
		};

	}

	/**
	 * 执行一条命令并入栈。
	 *
	 * 流程：
	 *   1) 命令.do(context) 若失败，直接 return false，不入栈也不清 redo 栈
	 *   2) 成功后清空 redo 栈
	 *   3) 若开启 autoCoalesce 且能与栈顶合并，则替换栈顶
	 *   4) 容量裁剪
	 *   5) 派发事件
	 */
	execute( command ) {

		if ( ! this._enabled ) return false;
		if ( ! ( command instanceof BaseCommand ) ) return false;

		const ok = command.do( this._context );
		if ( ! ok ) return false;

		if ( this._redoStack.length > 0 ) this._redoStack.length = 0;

		let pushed = command;
		if ( this._autoCoalesce && this._undoStack.length > 0 ) {

			const top = this._undoStack[ this._undoStack.length - 1 ];
			const merged = top.merge?.( command );
			if ( merged ) {

				this._undoStack[ this._undoStack.length - 1 ] = merged;
				pushed = merged;
				this._emit( 'execute', { command } );
				this._emit( 'change', this._buildChangePayload() );
				return true;

			}

		}

		this._undoStack.push( command );
		while ( this._undoStack.length > this._capacity ) this._undoStack.shift();

		this._emit( 'execute', { command: pushed } );
		this._emit( 'change', this._buildChangePayload() );
		return true;

	}

	undo() {

		if ( ! this.canUndo ) return false;
		const command = this._undoStack.pop();
		const ok = command.undo( this._context );
		if ( ! ok ) {

			this._undoStack.push( command );
			return false;

		}

		this._redoStack.push( command );
		this._emit( 'undo', { command } );
		this._emit( 'change', this._buildChangePayload() );
		return true;

	}

	redo() {

		if ( ! this.canRedo ) return false;
		const command = this._redoStack.pop();
		const ok = command.do( this._context );
		if ( ! ok ) {

			this._redoStack.push( command );
			return false;

		}

		this._undoStack.push( command );
		this._emit( 'redo', { command } );
		this._emit( 'change', this._buildChangePayload() );
		return true;

	}

	clear() {

		const hadAnything = this._undoStack.length > 0 || this._redoStack.length > 0;
		this._undoStack.length = 0;
		this._redoStack.length = 0;
		if ( hadAnything ) this._emit( 'change', this._buildChangePayload() );

	}

	addEventListener( event, callback ) {

		if ( typeof callback !== 'function' ) return;
		let bucket = this._listeners.get( event );
		if ( ! bucket ) {

			bucket = new Set();
			this._listeners.set( event, bucket );

		}

		bucket.add( callback );

	}

	removeEventListener( event, callback ) {

		this._listeners.get( event )?.delete( callback );

	}

	_buildChangePayload() {

		return {
			canUndo: this.canUndo,
			canRedo: this.canRedo,
			lastCommand: this._undoStack[ this._undoStack.length - 1 ] || null,
			undoSize: this._undoStack.length,
			redoSize: this._redoStack.length,
		};

	}

	_emit( event, payload ) {

		const bucket = this._listeners.get( event );
		if ( ! bucket ) return;
		for ( const callback of [ ...bucket ] ) {

			try {

				callback( payload );

			} catch ( error ) {

				console.error( '[EditorHistory] listener error:', error );

			}

		}

	}

}
