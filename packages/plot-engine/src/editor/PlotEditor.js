// ============================================================
// editor/PlotEditor.js — 编辑器总装（PlotEngine 之上的编辑层入口）
// 层级：编辑层（顶层）
// 职责：
//   - 持有 EditorHistory / DragController / EditSession / SelectionHighlight
//   - 把"指针拖拽"翻译成"语义事件"，再翻译成"命令"，最终入栈、应用到 ShapeStore
//   - 维护"选中高亮"与"编辑会话"两个独立但可叠加的状态
//   - 用单条 rAF 循环驱动 EditSession 的 flushIfDirty —— 编辑期所有重渲染都收敛到一帧内
// 依赖：three、./EditorHistory.js、./EditSession.js、./DragController.js、
//        ./HandleLayer.js（仅用于公开导出）、./commands/*
// 被消费：用户业务代码 / plotEngine.js 例子
//
// 坐标约定：
//   shape.coordinates 中的 [x, y, z] 表示逻辑平面 (x, y) 与高度 z；
//   在 3D 世界中对应 (x, z, y)（Y-up）。所有可视化（hot mesh / handles /
//   outline / SelectionHighlight）都遵循该置换。
// ============================================================

import {
	BufferGeometry,
	Float32BufferAttribute,
	Group,
	Line,
	LineBasicMaterial,
	LineLoop,
	Matrix4,
	Plane,
	Raycaster,
	Vector2,
	Vector3,
} from 'three';

import { EditorHistory } from './EditorHistory.js';
import { EditSession } from './EditSession.js';
import { DragController } from './DragController.js';
import { getShapeEditAdapter } from './ShapeEditAdapters.js';
import { UpdateCoordinatesCommand } from './commands/UpdateCoordinatesCommand.js';
import { InsertVertexCommand } from './commands/InsertVertexCommand.js';
import { RemoveVertexCommand } from './commands/RemoveVertexCommand.js';

const _pickRay = new Raycaster();
const _pickNdc = new Vector2();
const _pickPlane = new Plane();
const _pickPlaneNormal = new Vector3();
const _pickPlanePoint = new Vector3();
const _pickWorldHit = new Vector3();
const _pickLocalHit = new Vector3();
const _pickInvMatrix = new Matrix4();
const _editFrameMatrix = new Matrix4();
const _editFrameLocalMatrix = new Matrix4();
const _editFrameParentInverse = new Matrix4();
const _editFrameScaleMatrix = new Matrix4();
const _editFrameTranslateMatrix = new Matrix4();
const _editFrameCenter = new Vector3();
const _selectionFrameMatrix = new Matrix4();
const _surfaceRay = new Raycaster();
const _surfaceRayOrigin = new Vector3();
const _surfaceRayDirection = new Vector3();
const _surfaceRayBase = new Vector3();
const _surfaceRayLocal = new Vector3();
const _surfaceFrameInverse = new Matrix4();

const DEG2RAD = Math.PI / 180;
const METERS_PER_DEGREE_LATITUDE = 111320;
const SURFACE_RAY_HEIGHT = 100000;
const SURFACE_RAY_FAR = SURFACE_RAY_HEIGHT * 2;

/**
 * PlotEditor 是图形编辑功能的对外入口。
 *
 * 总体架构（自上而下）：
 *
 *   PlotEditor                       // 总装：状态机协调 + 命令入栈
 *      │
 *      ├── EditorHistory             // 命令栈
 *      ├── DragController            // 鼠标 / 指针状态机
 *      ├── EditSession               // 当前正在编辑的 shape 的"影子层"
 *      │      ├── HandleLayer        // 顶点 / 中点 / 中心 / 参数手柄
 *      │      └── hot mesh           // 实时反映 working shape 的渲染
 *      └── SelectionHighlight        // 仅"选中"无"编辑"时的高亮线框
 *
 * 与 PlotEngine 的关系：
 *   - PlotEditor 不替换 PlotEngine 的任何渲染逻辑
 *   - 编辑期：把对应 shape 的 cold 渲染（worldPipe / surfacePipe）visible=false，
 *     用 hot mesh + handle + outline 替代
 *   - 提交期：通过 ShapeStore.update 走 PlotEngine 的标准重编译路径
 *
 * 事件：
 *   - 'selection-change'  { shapeId | null }
 *   - 'edit-begin'        { shapeId }
 *   - 'edit-commit'       { shapeId, command }
 *   - 'edit-end'          { shapeId }
 *   - 'edit-cancel'       { shapeId }
 *   - 'history-change'    { canUndo, canRedo, undoSize, redoSize, lastCommand }
 *   - 'drag-start'        { handle, kind }
 *   - 'drag-end'          { handle, kind }
 *   - 'handle-hover'      { handle | null }
 */
export class PlotEditor {

	constructor( options ) {

		if ( ! options?.plotEngine ) {

			throw new Error( 'PlotEditor: options.plotEngine is required.' );

		}

		if ( ! options.camera ) {

			throw new Error( 'PlotEditor: options.camera is required.' );

		}

		if ( ! options.renderer?.domElement ) {

			throw new Error( 'PlotEditor: options.renderer.domElement is required.' );

		}

		this._plotEngine = options.plotEngine;
		this._camera = options.camera;
		this._renderer = options.renderer;
		this._handleSizeScale = Number( options.handleSizeScale ?? 1 );

		this._history = new EditorHistory( {
			capacity: Number( options.maxHistory ?? 200 ),
			autoCoalesce: options.autoCoalesce !== false,
		} );
		this._history.setContext( {
			shapeStore: this._plotEngine.shapeStore,
			plotEngine: this._plotEngine,
			editor: this,
		} );
		this._historyChangeBridge = payload => this._emit( 'history-change', payload );
		this._history.addEventListener( 'change', this._historyChangeBridge );

		this._selectionHighlight = new SelectionHighlight( {
			color: options.selectionStyle?.color ?? 0xffd54f,
			opacity: options.selectionStyle?.opacity ?? 0.95,
		} );
		this._selectedShapeId = null;
		this._selectionMounted = false;
		this._selectionFrameGroup = null;

		this._session = null;
		this._editFrameGroup = null;

		this._dragController = new DragController( {
			domElement: this._renderer.domElement,
			camera: this._camera,
			workingFrame: this._plotEngine.group,
			callbacks: {
				onHandleHover: handle => this._onHandleHover( handle ),
				onDragStart: ( handle, kind ) => this._onDragStart( handle, kind ),
				onDragMove: ( handle, localPoint ) => this._onDragMove( handle, localPoint ),
				onDragEnd: ( handle, kind ) => this._onDragEnd( handle, kind ),
				onInsertVertex: ( midpointHandle, localPoint ) => this._onInsertVertex( midpointHandle, localPoint ),
				onRemoveVertex: handle => this._onRemoveVertex( handle ),
			},
		} );

		this._listeners = new Map();

		this._rafHandle = null;
		this._rafEnabled = false;
		this._tickBound = () => this._tick();

		this._dragBeforeCoords = null;
		this._dragBeforeStyle = null;
		this._dragInProgress = false;

		if ( options.autoStart !== false ) this.start();

	}

	// ── 启停 ────────────────────────────────────────────────

	start() {

		this._dragController.enable();
		this._startRaf();

	}

	stop() {

		this._dragController.disable();
		this._stopRaf();

	}

	// ── 公共属性 ────────────────────────────────────────────

	get history() { return this._history; }
	get canUndo() { return this._history.canUndo; }
	get canRedo() { return this._history.canRedo; }
	get selectedShapeId() { return this._selectedShapeId; }
	get isEditing() { return this._session !== null; }
	get editingShapeId() { return this._session?.shapeId ?? null; }

	// ── 选中（不进入编辑） ──────────────────────────────────

	select( shapeId ) {

		const shape = this._plotEngine.shapeStore.get( shapeId );
		if ( ! shape ) return false;

		if ( this._session && this._session.shapeId !== shapeId ) {

			this.cancelEdit();

		}

		this._selectedShapeId = shapeId;
		this._mountSelectionHighlight( shape );
		this._emit( 'selection-change', { shapeId } );
		return true;

	}

	deselect() {

		if ( this._session ) this.cancelEdit();
		if ( this._selectedShapeId == null ) return;
		this._unmountSelectionHighlight();
		this._selectedShapeId = null;
		this._emit( 'selection-change', { shapeId: null } );

	}

	// ── 编辑会话 ────────────────────────────────────────────

	beginEdit( shapeId ) {

		if ( this._session?.shapeId === shapeId ) return true;

		const shape = this._plotEngine.shapeStore.get( shapeId );
		if ( ! shape ) {

			console.warn( `[PlotEditor] beginEdit: shape "${ shapeId }" not found.` );
			return false;

		}

		if ( ! getShapeEditAdapter( shape.kind ) ) {

			console.warn( `[PlotEditor] beginEdit: no edit adapter for kind "${ shape.kind }".` );
			return false;

		}

		if ( this._session ) this.endEdit();

		if ( this._selectedShapeId !== shapeId ) this.select( shapeId );
		this._unmountSelectionHighlight();

		const editTransform = this._createEditTransform( shape );

		try {

			this._session = new EditSession( {
				plotEngine: this._plotEngine,
				shapeId,
				mountGroup: editTransform.mountGroup,
				handleSizeScale: this._handleSizeScale,
				shapeToDisplayPoint: editTransform.shapeToDisplayPoint,
				displayToShapePoint: editTransform.displayToShapePoint,
				shapeToDisplayShape: editTransform.shapeToDisplayShape,
				shapeToOutlineShape: editTransform.shapeToOutlineShape,
			} );

		} catch ( error ) {

			console.error( '[PlotEditor] failed to create EditSession:', error );
			this._session = null;
			this._restoreSelectionHighlight();
			return false;

		}

		this._dragController.setWorkingFrame( this._session.sessionGroup );
		this._dragController.setHandleLayer( this._session.handleLayer );

		this._startRaf();

		this._emit( 'edit-begin', { shapeId } );
		return true;

	}

	endEdit() {

		if ( ! this._session ) return false;
		const shapeId = this._session.shapeId;
		const diff = this._session.computeDiff();

		if ( diff.coordinatesChanged || diff.styleChanged ) {

			const command = this._buildCommitCommand( shapeId, diff );
			if ( command ) this._history.execute( command );

		}

		this._teardownSession();
		this._restoreSelectionHighlight();
		this._emit( 'edit-end', { shapeId } );
		return true;

	}

	cancelEdit() {

		if ( ! this._session ) return false;
		const shapeId = this._session.shapeId;
		this._teardownSession();
		this._restoreSelectionHighlight();
		this._emit( 'edit-cancel', { shapeId } );
		this._emit( 'edit-end', { shapeId } );
		return true;

	}

	// ── 拾取 ─────────────────────────────────────────────────

	/**
	 * 给定屏幕坐标（CSS 像素，相对于浏览器视口），返回命中的 shape id；
	 * 没有命中返回 null。
	 *
	 * 实现策略：
	 *   1) 把 (clientX, clientY) 转 NDC，由 camera 构造一条射线
	 *   2) 对每个 shape：
	 *      - 计算其挂载点（plotEngine.group / target.object3D）的世界矩阵
	 *      - 把 shape 的"水平面"（局部 Y = z 高度）变换到世界，与射线相交
	 *      - 把命中点反变换到 shape 局部坐标 (sx, sz_height, sy)
	 *      - 取 (sx, sy) 与 shape.bounds 做包围盒测试
	 *      - 进一步对各 kind 做精确判定（圆 / 扇形 / 多边形 / 矩形）
	 *   3) 在所有命中候选中，选离 camera 最近的 shape
	 *
	 * 设计取舍：
	 *   不直接用 raycast 命中 cold 渲染对象——因为 WorldPipe 把同色 shape 合批，
	 *   命中后无法反推到具体 shapeId。采用"水平面 + bounds + 精确判定"的方式，
	 *   兼容所有 attachment 模式，且对万级 shape 仍可在 O(n) 完成。
	 *
	 * @param {number} clientX
	 * @param {number} clientY
	 * @returns {string|number|null}
	 */
	pickShapeAt( clientX, clientY ) {

		const dom = this._renderer.domElement;
		const rect = dom.getBoundingClientRect();
		_pickNdc.x = ( ( clientX - rect.left ) / rect.width ) * 2 - 1;
		_pickNdc.y = - ( ( clientY - rect.top ) / rect.height ) * 2 + 1;
		_pickRay.setFromCamera( _pickNdc, this._camera );

		const cameraPosition = this._camera.position;
		let bestId = null;
		let bestDistance = Infinity;

		this._plotEngine.shapeStore.forEachRaw( shape => {

			const candidate = this._testShapePick( shape );
			if ( candidate == null ) return;

			const dist = candidate.distance;
			if ( dist < bestDistance ) {

				bestDistance = dist;
				bestId = shape.id;

			}

		} );

		// cameraPosition 当前没用到（distance 已在 _testShapePick 内部计算），
		// 留作未来 extension 的占位
		void cameraPosition;
		return bestId;

	}

	/**
	 * 对单个 shape 做拾取测试。返回 { distance } 表示命中（distance 是
	 * 命中点到 camera 的距离，用于深度排序），或 null 表示未命中。
	 *
	 * @param {object} shape
	 * @returns {{distance:number}|null}
	 */
	_testShapePick( shape ) {

		// 取出挂载点矩阵
		const mountMatrix = this._resolveShapeWorldMatrix( shape, _editFrameMatrix );
		if ( ! mountMatrix ) return null;

		// 计算 shape 的 z 高度（取 coordinates 里的 z 或 style 中的 altitude）
		const altitude = this._getShapeAltitude( shape );

		// 平面法线 = mount frame 的局部 +Y 在世界中的方向
		_pickPlaneNormal.set( 0, 1, 0 ).transformDirection( mountMatrix ).normalize();
		// 平面经过点 = mount frame 的 (0, altitude, 0)
		if ( this._getShapeCoordinateCenter( shape, _editFrameCenter ) ) {

			_pickPlanePoint.set( _editFrameCenter.x, altitude, _editFrameCenter.y );

		} else {

			_pickPlanePoint.set( 0, altitude, 0 );

		}

		_pickPlanePoint.applyMatrix4( mountMatrix );
		_pickPlane.setFromNormalAndCoplanarPoint( _pickPlaneNormal, _pickPlanePoint );

		// 与射线求交
		const intersect = _pickRay.ray.intersectPlane( _pickPlane, _pickWorldHit );
		if ( ! intersect ) return null;

		// 世界 → mount 局部
		_pickInvMatrix.copy( mountMatrix ).invert();
		_pickLocalHit.copy( _pickWorldHit ).applyMatrix4( _pickInvMatrix );
		// world (x, y=h, z) → shape (sx, sy)
		const sx = _pickLocalHit.x;
		const sy = _pickLocalHit.z;

		// 调用 kind 的精确测试
		if ( ! this._isPointInsideShape( shape, sx, sy ) ) return null;

		const distance = _pickWorldHit.distanceTo( this._camera.position );
		return { distance };

	}

	_getShapeAltitude( shape ) {

		const coords = shape.coordinates || [];
		for ( const point of coords ) {

			if ( point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) ) return Number( point[ 2 ] );

		}

		const style = shape.style || {};
		for ( const key of [ 'altitude', 'elevation', 'z' ] ) {

			const value = style[ key ];
			if ( Number.isFinite( Number( value ) ) ) return Number( value );

		}

		return 0;

	}

	_isPointInsideShape( shape, sx, sy ) {

		const kind = shape.kind;
		const coords = shape.coordinates || [];
		const style = shape.style || {};

		switch ( kind ) {

			case 'point': {

				const center = coords[ 0 ];
				if ( ! center ) return false;
				const tolerance = Math.max( Number( style.size ?? 8 ), 8 );
				// size 是像素单位，这里只能给一个相对宽松的命中判定 —— 用蛮粗的距离阈值
				return Math.hypot( sx - center[ 0 ], sy - center[ 1 ] ) <= tolerance;

			}

			case 'line':
			case 'polyline': {

				const tolerance = Number( style.strokeWidth ?? 0 );
				const distance = pointToPolylineDistance( coords, sx, sy );
				return distance <= Math.max( tolerance, 1e-6 );

			}

			case 'polygon': {

				return pointInPolygon( coords, sx, sy );

			}

			case 'rectangle': {

				const a = coords[ 0 ];
				const b = coords[ 1 ];
				if ( ! a || ! b ) return false;
				const minX = Math.min( a[ 0 ], b[ 0 ] );
				const minY = Math.min( a[ 1 ], b[ 1 ] );
				const maxX = Math.max( a[ 0 ], b[ 0 ] );
				const maxY = Math.max( a[ 1 ], b[ 1 ] );
				return sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;

			}

			case 'circle': {

				const center = coords[ 0 ];
				if ( ! center ) return false;
				const radius = Number( style.radius ?? 0 );
				if ( radius <= 0 ) return false;
				return Math.hypot( sx - center[ 0 ], sy - center[ 1 ] ) <= radius;

			}

			case 'sector': {

				const center = coords[ 0 ];
				if ( ! center ) return false;
				const radius = Number( style.radius ?? 0 );
				if ( radius <= 0 ) return false;
				const dx = sx - center[ 0 ];
				const dy = sy - center[ 1 ];
				const r = Math.hypot( dx, dy );
				if ( r > radius ) return false;
				const startAngle = Number( style.startAngle ?? 0 );
				const sectorAngle = Number( style.sectorAngle ?? Math.PI * 0.5 );
				const angle = Math.atan2( dy, dx );
				return isAngleInSector( angle, startAngle, sectorAngle );

			}

			case 'arrow': {

				if ( coords.length < 2 ) return false;
				const a = coords[ 0 ];
				const b = coords[ coords.length - 1 ];
				const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
				if ( length === 0 ) return false;
				const width = Math.max( Number( style.width ?? length * 0.08 ), 1e-6 );
				const headLength = Math.max( Number( style.headLength ?? Math.min( length * 0.3, width * 4 ) ), 1e-6 );
				return isPointInArrow( a, b, width, headLength, sx, sy );

			}

			default: {

				// 兜底：bounds 测试（精度差但保证能 pick）
				const minX = Math.min( ...coords.map( point => point[ 0 ] ) );
				const minY = Math.min( ...coords.map( point => point[ 1 ] ) );
				const maxX = Math.max( ...coords.map( point => point[ 0 ] ) );
				const maxY = Math.max( ...coords.map( point => point[ 1 ] ) );
				return sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;

			}

		}

	}

	// ── 命令栈直接入口 ──────────────────────

	executeCommand( command ) {

		return this._history.execute( command );

	}

	undo() {

		const ok = this._history.undo();
		if ( ok ) this._refreshSessionAfterExternalChange();
		return ok;

	}

	redo() {

		const ok = this._history.redo();
		if ( ok ) this._refreshSessionAfterExternalChange();
		return ok;

	}

	// ── 事件 ────────────────────────────────────────────────

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

	// ── 销毁 ────────────────────────────────────────────────

	dispose() {

		this.cancelEdit();
		this.deselect();
		this._stopRaf();
		this._dragController.dispose();
		this._selectionHighlight.dispose();
		this._history.removeEventListener( 'change', this._historyChangeBridge );
		this._history.clear();
		this._listeners.clear();

	}

	// ── 内部：DragController 回调 ──────────────────────────

	_onHandleHover( handle ) {

		this._emit( 'handle-hover', { handle } );

	}

	_onDragStart( handle, kind ) {

		if ( ! this._session ) return;
		const w = this._session.workingShape;
		this._dragBeforeCoords = w.coordinates.map( point => point.slice() );
		this._dragBeforeStyle = { ...w.style };
		this._dragInProgress = true;
		this._emit( 'drag-start', { handle, kind } );

	}

	_onDragMove( handle, localPoint ) {

		if ( ! this._session || ! handle ) return;
		const adapter = this._session.adapter;
		const working = this._session.workingShape;
		const shapePoint = this._session.displayPointToShape( localPoint );

		let patch = null;

		if ( handle.type === 'center' ) {

			const center = adapter.getCenter( working );
			const dx = shapePoint[ 0 ] - center[ 0 ];
			const dy = shapePoint[ 1 ] - center[ 1 ];
			if ( dx !== 0 || dy !== 0 ) {

				patch = adapter.translate( working, dx, dy );

			}

		} else {

			patch = adapter.applyHandleDrag( working, handle.handleId, shapePoint );

		}

		if ( patch ) this._session.setWorkingPatch( patch );

	}

	_onDragEnd( handle, kind ) {

		this._dragInProgress = false;

		if ( ! this._session ) return;
		const shapeId = this._session.shapeId;
		const before = this._dragBeforeCoords;
		this._dragBeforeCoords = null;
		this._dragBeforeStyle = null;
		this._emit( 'drag-end', { handle, kind } );

		if ( ! before ) return;
		const after = this._session.workingShape.coordinates;
		if ( coordinatesEqual( before, after ) ) return;

		const command = new UpdateCoordinatesCommand( shapeId, before, after );
		const ok = this._history.execute( command );
		if ( ok ) {

			this._session.refreshColdHiding?.();
			this._syncSessionInitialFromStore();
			this._emit( 'edit-commit', { shapeId, command } );

		}

	}

	_onInsertVertex( midpointHandle, localPoint ) {

		if ( ! this._session ) return null;

		const adapter = this._session.adapter;
		const workingBefore = this._session.workingShape;
		const shapePoint = this._session.displayPointToShape( localPoint );
		const result = adapter.insertVertex?.( workingBefore, midpointHandle.handleId, shapePoint );
		if ( ! result || ! result.coordinates ) return null;

		const insertedIndex = Number( result.insertedIndex ?? -1 );
		if ( insertedIndex < 0 ) return null;

		this._session.setWorkingPatch( { coordinates: result.coordinates } );

		const beforeForCommand = this._dragBeforeCoords
			? this._dragBeforeCoords
			: workingBefore.coordinates.map( point => point.slice() );
		const command = new InsertVertexCommand(
			this._session.shapeId,
			insertedIndex,
			shapePoint,
			beforeForCommand,
		);
		const ok = this._history.execute( command );
		if ( ! ok ) return null;

		this._syncSessionInitialFromStore();
		this._session.refreshColdHiding?.();

		this._dragBeforeCoords = result.coordinates.map( point => point.slice() );

		this._emit( 'edit-commit', { shapeId: this._session.shapeId, command } );

		this._session.flushIfDirty();

		return `vertex:${ insertedIndex }`;

	}

	_onRemoveVertex( handle ) {

		if ( ! this._session ) return false;
		const adapter = this._session.adapter;
		const working = this._session.workingShape;

		if ( ! adapter.canRemoveVertex?.( working, handle.handleId ) ) return false;
		const result = adapter.removeVertex?.( working, handle.handleId );
		if ( ! result || ! result.coordinates ) return false;

		const removedIndex = Number( result.removedIndex ?? handle.handleId.split( ':' )[ 1 ] );
		const command = new RemoveVertexCommand(
			this._session.shapeId,
			removedIndex,
			working.coordinates.map( point => point.slice() ),
		);
		const ok = this._history.execute( command );
		if ( ! ok ) return false;

		this._session.setWorkingShape( {
			...working,
			coordinates: result.coordinates,
		} );
		this._syncSessionInitialFromStore();
		this._session.refreshColdHiding?.();
		this._session.flushIfDirty();

		this._emit( 'edit-commit', { shapeId: this._session.shapeId, command } );
		return true;

	}

	// ── 内部：会话生命周期辅助 ──────────────────────────────

	_syncSessionInitialFromStore() {

		if ( ! this._session ) return;
		const fresh = this._plotEngine.shapeStore.get( this._session.shapeId );
		if ( ! fresh ) return;
		this._session._initialShape = {
			id: fresh.id,
			kind: fresh.kind,
			coordinates: ( fresh.coordinates || [] ).map( point => point.length > 2
				? [ point[ 0 ], point[ 1 ], point[ 2 ] ]
				: [ point[ 0 ], point[ 1 ] ] ),
			style: { ...( fresh.style || {} ) },
			attachment: { ...( fresh.attachment || {} ) },
			revision: fresh.revision ?? 0,
		};

	}

	_refreshSessionAfterExternalChange() {

		if ( this._session ) {

			const fresh = this._plotEngine.shapeStore.get( this._session.shapeId );
			if ( fresh ) {

				this._session.setWorkingShape( fresh );
				this._syncSessionInitialFromStore();
				this._session.refreshColdHiding?.();
				this._session.flushIfDirty();

			} else {

				this.cancelEdit();

			}

		}

		if ( this._selectedShapeId != null ) {

			const fresh = this._plotEngine.shapeStore.get( this._selectedShapeId );
			if ( fresh ) {

				this._mountSelectionHighlight( fresh );

			} else {

				this._unmountSelectionHighlight();
				this._selectedShapeId = null;
				this._emit( 'selection-change', { shapeId: null } );

			}

		}

	}

	_teardownSession() {

		if ( ! this._session ) return;
		this._dragController.setHandleLayer( null );
		this._dragController.setWorkingFrame( this._plotEngine.group );
		this._session.dispose();
		this._session = null;
		this._disposeTempFrameGroup( '_editFrameGroup' );
		this._dragBeforeCoords = null;
		this._dragBeforeStyle = null;
		this._dragInProgress = false;

	}

	_restoreSelectionHighlight() {

		if ( this._session || this._selectedShapeId == null ) return;
		const shape = this._plotEngine.shapeStore.get( this._selectedShapeId );
		if ( shape ) {

			this._mountSelectionHighlight( shape );
			return;

		}

		this._unmountSelectionHighlight();
		this._selectedShapeId = null;
		this._emit( 'selection-change', { shapeId: null } );

	}

	_createEditTransform( shape ) {

		const projected = this._createProjectedTransform( shape, '_editFrameGroup', 'PlotEditor.ProjectedEditFrame' );
		if ( projected ) return projected;

		this._disposeTempFrameGroup( '_editFrameGroup' );
		const mountGroup = this._resolveMountGroup( shape );
		return {
			mountGroup,
			shapeToDisplayPoint: point => clonePoint( point ),
			displayToShapePoint: point => clonePoint( point ),
			shapeToDisplayShape: source => cloneShapeForDisplay( source ),
			shapeToOutlineShape: source => cloneShapeForDisplay( source ),
		};

	}

	_createProjectedTransform( shape, frameProperty, frameName ) {

		const mode = shape.attachment?.mode ?? 'world';
		if ( mode !== 'surface' && mode !== 'tiles' ) return null;

		const target = this._resolveTarget( shape );
		if ( ! target || ! this._isCartographicTarget( target ) ) return null;
		if ( ! this._getShapeCoordinateCenter( shape, _editFrameCenter ) ) return null;

		const frameMatrix = this._resolveProjectedFrameWorldMatrix( shape, _editFrameMatrix );
		if ( ! frameMatrix ) return null;

		const frameGroup = this._updateTempFrameGroup( frameProperty, frameName, frameMatrix );
		const originLon = _editFrameCenter.x;
		const originLat = _editFrameCenter.y;
		const latRad = originLat * DEG2RAD;
		const metersPerLon = Math.max(
			Math.abs( Math.cos( latRad ) ) * METERS_PER_DEGREE_LATITUDE,
			1e-6,
		);
		const metersPerLat = METERS_PER_DEGREE_LATITUDE;
		const metersPerStyleUnit = Math.sqrt( metersPerLon * metersPerLat );

		const shapeToDisplayPoint = point => {

			const x = ( Number( point[ 0 ] ) - originLon ) * metersPerLon;
			const y = ( Number( point[ 1 ] ) - originLat ) * metersPerLat;
			const sampledHeight = this._sampleSurfaceHeight( target, frameGroup, x, y );
			return [ x, y, sampledHeight ?? 0 ];

		};

		const sourceDistance = ( a, b ) => Math.hypot(
			( Number( b[ 0 ] ) - Number( a[ 0 ] ) ) * metersPerLon,
			( Number( b[ 1 ] ) - Number( a[ 1 ] ) ) * metersPerLat,
		);

		const lerpSourcePoint = ( a, b, t ) => [
			Number( a[ 0 ] ) + ( Number( b[ 0 ] ) - Number( a[ 0 ] ) ) * t,
			Number( a[ 1 ] ) + ( Number( b[ 1 ] ) - Number( a[ 1 ] ) ) * t,
			( Number( a[ 2 ] ) || 0 ) + ( ( Number( b[ 2 ] ) || 0 ) - ( Number( a[ 2 ] ) || 0 ) ) * t,
		];

		const densifySourcePolyline = ( points, closed = false, maxSegmentLength = 2 ) => {

			const result = [];
			const count = points.length;
			if ( count === 0 ) return result;
			const edgeCount = closed ? count : Math.max( 0, count - 1 );
			for ( let index = 0; index < edgeCount; index ++ ) {

				const a = points[ index ];
				const b = points[ ( index + 1 ) % count ];
				const segmentCount = Math.max( 1, Math.min( 128, Math.ceil( sourceDistance( a, b ) / maxSegmentLength ) ) );
				for ( let step = 0; step < segmentCount; step ++ ) {

					if ( result.length > 0 && step === 0 ) continue;
					result.push( lerpSourcePoint( a, b, step / segmentCount ) );

				}

			}

			if ( ! closed && count > 0 ) result.push( clonePoint( points[ count - 1 ] ) );
			return result;

		};

		const sourceCirclePoints = ( center, radius, startAngle = 0, span = Math.PI * 2, includeEnd = true ) => {

			const radiusMeters = Math.max( Math.abs( Number( radius ) || 0 ) * metersPerStyleUnit, 1e-6 );
			const segments = Math.max( 24, Math.min( 160, Math.ceil( Math.abs( span ) * radiusMeters / 2 ) ) );
			const points = [];
			const sampleCount = includeEnd ? segments + 1 : segments;
			for ( let index = 0; index < sampleCount; index ++ ) {

				const t = includeEnd ? index / segments : index / sampleCount;
				const angle = startAngle + span * t;
				points.push( [
					Number( center[ 0 ] ) + Math.cos( angle ) * radius,
					Number( center[ 1 ] ) + Math.sin( angle ) * radius,
					center[ 2 ] ?? 0,
				] );

			}

			return points;

		};

		const sourceArrowPoints = source => {

			const coords = source.coordinates || [];
			const a = coords[ 0 ];
			const b = coords[ coords.length - 1 ];
			if ( ! a || ! b ) return [];
			const dx = Number( b[ 0 ] ) - Number( a[ 0 ] );
			const dy = Number( b[ 1 ] ) - Number( a[ 1 ] );
			const length = Math.hypot( dx, dy );
			if ( length === 0 ) return [];
			const width = Number( source.style?.width ?? length * 0.08 );
			const headLength = Number( source.style?.headLength ?? Math.min( length * 0.3, width * 4 ) );
			const ux = dx / length;
			const uy = dy / length;
			const nx = - uy;
			const ny = ux;
			const neckX = Number( b[ 0 ] ) - ux * headLength;
			const neckY = Number( b[ 1 ] ) - uy * headLength;
			const z = a[ 2 ] ?? 0;
			return [
				[ Number( a[ 0 ] ) + nx * width * 0.35, Number( a[ 1 ] ) + ny * width * 0.35, z ],
				[ neckX + nx * width, neckY + ny * width, z ],
				[ Number( b[ 0 ] ), Number( b[ 1 ] ), z ],
				[ neckX - nx * width, neckY - ny * width, z ],
				[ Number( a[ 0 ] ) - nx * width * 0.35, Number( a[ 1 ] ) - ny * width * 0.35, z ],
			];

		};

		const buildDisplayCoordinates = source => {

			const coords = source.coordinates || [];
			switch ( source.kind ) {

				case 'line':
				case 'polyline':
					return densifySourcePolyline( coords, false ).map( shapeToDisplayPoint );

				case 'polygon':
					return densifySourcePolyline( coords, true ).map( shapeToDisplayPoint );

				case 'rectangle': {

					const a = coords[ 0 ];
					const b = coords[ 1 ];
					if ( ! a || ! b ) return [];
					const z = a[ 2 ] ?? b[ 2 ] ?? 0;
					const minX = Math.min( Number( a[ 0 ] ), Number( b[ 0 ] ) );
					const minY = Math.min( Number( a[ 1 ] ), Number( b[ 1 ] ) );
					const maxX = Math.max( Number( a[ 0 ] ), Number( b[ 0 ] ) );
					const maxY = Math.max( Number( a[ 1 ] ), Number( b[ 1 ] ) );
					return densifySourcePolyline( [
						[ minX, minY, z ],
						[ maxX, minY, z ],
						[ maxX, maxY, z ],
						[ minX, maxY, z ],
					], true ).map( shapeToDisplayPoint );

				}

				case 'circle': {

					const center = coords[ 0 ];
					if ( ! center ) return [];
					return sourceCirclePoints( center, Number( source.style?.radius ?? 1 ), 0, Math.PI * 2, false ).map( shapeToDisplayPoint );

				}

				case 'sector': {

					const center = coords[ 0 ];
					if ( ! center ) return [];
					const radius = Number( source.style?.radius ?? 1 );
					const startAngle = Number( source.style?.startAngle ?? 0 );
					const sectorAngle = Number( source.style?.sectorAngle ?? Math.PI * 0.5 );
					return [
						clonePoint( center ),
						...sourceCirclePoints( center, radius, startAngle, sectorAngle, true ),
					].map( shapeToDisplayPoint );

				}

				case 'arrow':
					return densifySourcePolyline( sourceArrowPoints( source ), true ).map( shapeToDisplayPoint );

				default:
					return coords.map( shapeToDisplayPoint );

			}

		};

		const displayToShapePoint = point => [
			Number( point[ 0 ] ) / metersPerLon + originLon,
			Number( point[ 1 ] ) / metersPerLat + originLat,
			point.length > 2 ? Number( point[ 2 ] ) || 0 : 0,
		];

		const shapeToDisplayShape = source => ( {
			...source,
			kind: shouldDisplayAsPolygon( source.kind ) ? 'polygon' : source.kind,
			coordinates: buildDisplayCoordinates( source ),
			style: scaleDisplayStyle( source.style, metersPerStyleUnit ),
			attachment: { mode: 'world' },
		} );

		const shapeToOutlineShape = shapeToDisplayShape;

		return {
			mountGroup: frameGroup,
			shapeToDisplayPoint,
			displayToShapePoint,
			shapeToDisplayShape,
			shapeToOutlineShape,
		};

	}

	_resolveMountGroup( shape ) {

		const direct = this._resolveDirectMountGroup( shape );
		if ( direct ) return direct;

		const projectedMatrix = this._resolveProjectedWorldMatrix( shape, _editFrameMatrix );
		if ( projectedMatrix ) {

			return this._updateTempFrameGroup( '_editFrameGroup', 'PlotEditor.ProjectedEditFrame', projectedMatrix );

		}

		return this._plotEngine.group;

	}

	_resolveShapeWorldMatrix( shape, out ) {

		const direct = this._resolveDirectMountGroup( shape );
		if ( direct ) {

			direct.updateMatrixWorld?.( true );
			return out.copy( direct.matrixWorld );

		}

		const projectedMatrix = this._resolveProjectedWorldMatrix( shape, out );
		if ( projectedMatrix ) return projectedMatrix;

		this._plotEngine.group.updateMatrixWorld?.( true );
		return out.copy( this._plotEngine.group.matrixWorld );

	}

	_resolveDirectMountGroup( shape ) {

		const mode = shape.attachment?.mode ?? 'world';
		if ( mode === 'world' ) return this._plotEngine.group;

		const target = this._resolveTarget( shape );
		if ( ! target ) return null;

		if ( target.type === 'object' && target.object3D ) return target.object3D;
		if ( target.object3D ) return target.object3D;
		if ( target.source?.isObject3D ) return target.source;
		return null;

	}

	_resolveTarget( shape ) {

		const targetId = shape.attachment?.targetId;
		if ( targetId == null ) return null;
		return this._plotEngine.targetRegistry?.get?.( targetId ) || null;

	}

	_resolveProjectedWorldMatrix( shape, out ) {

		const mode = shape.attachment?.mode ?? 'world';
		if ( mode !== 'surface' && mode !== 'tiles' ) return null;

		const target = this._resolveTarget( shape );
		if ( ! target || ! this._isCartographicTarget( target ) ) return null;

		const ellipsoid = this._getTargetEllipsoid( target );
		const targetGroup = this._getTargetGroup( target );
		if ( ! ellipsoid?.getObjectFrame || ! targetGroup ) return null;
		if ( ! this._getShapeCoordinateCenter( shape, _editFrameCenter ) ) return null;

		const lonDeg = _editFrameCenter.x;
		const latDeg = _editFrameCenter.y;
		const lonRad = lonDeg * DEG2RAD;
		const latRad = latDeg * DEG2RAD;

		ellipsoid.getObjectFrame( latRad, lonRad, 0, 0, 0, 0, out );
		targetGroup.updateMatrixWorld?.( true );
		out.premultiply( targetGroup.matrixWorld );

		const metersPerLon = Math.max(
			Math.abs( Math.cos( latRad ) ) * METERS_PER_DEGREE_LATITUDE,
			1e-6,
		);
		_editFrameScaleMatrix.makeScale( metersPerLon, 1, METERS_PER_DEGREE_LATITUDE );
		_editFrameTranslateMatrix.makeTranslation( - lonDeg, 0, - latDeg );
		out.multiply( _editFrameScaleMatrix );
		out.multiply( _editFrameTranslateMatrix );
		return out;

	}

	_isCartographicTarget( target ) {

		const kind = target.options?.geoReference?.kind;
		return kind === 'cartographic' || kind === 'placed-cartographic';

	}

	_getTargetEllipsoid( target ) {

		return target.tilesRenderer?.ellipsoid ||
			target.source?.ellipsoid ||
			target.ellipsoid ||
			null;

	}

	_getTargetGroup( target ) {

		return target.tilesRenderer?.group ||
			target.source?.group ||
			target.group ||
			null;

	}

	_sampleSurfaceHeight( target, frameGroup, x, y ) {

		const raycastTargets = this._getSurfaceRaycastTargets( target );
		if ( raycastTargets.length === 0 ) return null;

		frameGroup.updateMatrixWorld?.( true );
		_surfaceRayOrigin.set( x, SURFACE_RAY_HEIGHT, y ).applyMatrix4( frameGroup.matrixWorld );
		_surfaceRayDirection.set( 0, - 1, 0 ).transformDirection( frameGroup.matrixWorld ).normalize();
		_surfaceRay.set( _surfaceRayOrigin, _surfaceRayDirection );
		_surfaceRay.near = 0;
		_surfaceRay.far = SURFACE_RAY_FAR;

		const hits = _surfaceRay.intersectObjects( raycastTargets, false );
		if ( hits.length === 0 ) return null;

		_surfaceFrameInverse.copy( frameGroup.matrixWorld ).invert();
		_surfaceRayLocal.copy( hits[ 0 ].point ).applyMatrix4( _surfaceFrameInverse );
		return _surfaceRayLocal.y;

	}

	_getSurfaceRaycastTargets( target ) {

		const result = [];
		const pushMeshes = root => {

			root?.traverse?.( object => {

				if ( ! object.visible || ! object.isMesh || ! object.geometry || object.isPoints ) return;
				result.push( object );

			} );

		};

		const loadedEntries = this._plotEngine.tiledPipe?._loadedTiles?.get?.( target.id );
		if ( loadedEntries ) {

			for ( const entry of loadedEntries.values() ) {

				if ( entry.visible === false ) continue;
				pushMeshes( entry.scene );

			}

		}

		if ( result.length === 0 ) pushMeshes( this._getTargetGroup( target ) );
		for ( const object of result ) object.updateMatrixWorld?.( true );
		return result;

	}

	_getShapeCoordinateCenter( shape, out ) {

		const coords = shape.coordinates || [];
		let count = 0;
		let sumX = 0;
		let sumY = 0;
		let sumZ = 0;
		let zCount = 0;

		for ( const point of coords ) {

			const x = Number( point[ 0 ] );
			const y = Number( point[ 1 ] );
			if ( ! Number.isFinite( x ) || ! Number.isFinite( y ) ) continue;
			sumX += x;
			sumY += y;
			count ++;

			const z = Number( point[ 2 ] );
			if ( Number.isFinite( z ) ) {

				sumZ += z;
				zCount ++;

			}

		}

		if ( count === 0 ) return false;
		out.set(
			sumX / count,
			sumY / count,
			zCount > 0 ? sumZ / zCount : 0,
		);
		return true;

	}

	_updateTempFrameGroup( property, name, worldMatrix ) {

		const parent = this._plotEngine.group.parent || this._plotEngine.group;
		let group = this[ property ];
		if ( ! group ) {

			group = new Group();
			group.name = name;
			group.matrixAutoUpdate = false;
			this[ property ] = group;

		}

		if ( group.parent !== parent ) {

			group.removeFromParent();
			parent.add( group );

		}

		parent.updateMatrixWorld?.( true );
		_editFrameParentInverse.copy( parent.matrixWorld ).invert();
		_editFrameLocalMatrix.multiplyMatrices( _editFrameParentInverse, worldMatrix );
		group.matrix.copy( _editFrameLocalMatrix );
		group.matrixWorldNeedsUpdate = true;
		group.updateMatrixWorld?.( true );
		return group;

	}

	_disposeTempFrameGroup( property ) {

		const group = this[ property ];
		if ( ! group ) return;
		group.removeFromParent();
		this[ property ] = null;

	}

	_buildCommitCommand( shapeId, diff ) {

		if ( diff.coordinatesChanged ) {

			return new UpdateCoordinatesCommand( shapeId, diff.beforeCoordinates, diff.afterCoordinates );

		}

		return null;

	}

	// ── 选中高亮 ────────────────────────────────────────────

	_mountSelectionHighlight( shape ) {

		const transform = this._createSelectionTransform( shape );
		const displayShape = ( transform.shapeToOutlineShape || transform.shapeToDisplayShape )( shape );
		this._selectionHighlight.update( displayShape );
		const mountGroup = transform.mountGroup;
		if ( this._selectionHighlight.group.parent !== mountGroup ) {

			this._selectionHighlight.group.removeFromParent();
			mountGroup.add( this._selectionHighlight.group );

		}

		this._selectionMounted = true;

	}

	_unmountSelectionHighlight() {

		if ( ! this._selectionMounted ) return;
		this._selectionHighlight.group.removeFromParent();
		this._selectionMounted = false;
		this._disposeTempFrameGroup( '_selectionFrameGroup' );

	}

	_createSelectionTransform( shape ) {

		const projected = this._createProjectedTransform( shape, '_selectionFrameGroup', 'PlotEditor.ProjectedSelectionFrame' );
		if ( projected ) return projected;

		this._disposeTempFrameGroup( '_selectionFrameGroup' );
		const mountGroup = this._resolveDirectMountGroup( shape ) || this._plotEngine.group;
		return {
			mountGroup,
			shapeToDisplayPoint: point => clonePoint( point ),
			displayToShapePoint: point => clonePoint( point ),
			shapeToDisplayShape: source => cloneShapeForDisplay( source ),
			shapeToOutlineShape: source => cloneShapeForDisplay( source ),
		};

	}

	_resolveSelectionMountGroup( shape ) {

		const direct = this._resolveDirectMountGroup( shape );
		if ( direct ) {

			this._disposeTempFrameGroup( '_selectionFrameGroup' );
			return direct;

		}

		const projectedMatrix = this._resolveProjectedWorldMatrix( shape, _selectionFrameMatrix );
		if ( projectedMatrix ) {

			return this._updateTempFrameGroup( '_selectionFrameGroup', 'PlotEditor.ProjectedSelectionFrame', projectedMatrix );

		}

		this._disposeTempFrameGroup( '_selectionFrameGroup' );
		return this._plotEngine.group;

	}

	// ── rAF 循环 ────────────────────────────────────────────

	_startRaf() {

		if ( this._rafEnabled ) return;
		this._rafEnabled = true;
		const raf = typeof globalThis.requestAnimationFrame === 'function'
			? globalThis.requestAnimationFrame.bind( globalThis )
			: callback => setTimeout( () => callback( performance.now?.() ?? Date.now() ), 16 );
		this._rafImpl = raf;
		this._rafHandle = this._rafImpl( this._tickBound );

	}

	_stopRaf() {

		this._rafEnabled = false;
		if ( this._rafHandle != null && typeof globalThis.cancelAnimationFrame === 'function' ) {

			globalThis.cancelAnimationFrame( this._rafHandle );

		}

		this._rafHandle = null;

	}

	_tick() {

		if ( ! this._rafEnabled ) return;

		if ( this._session ) {

			this._session.flushIfDirty();

		}

		if ( this._selectionMounted && this._selectedShapeId != null ) {

			const shape = this._plotEngine.shapeStore.get( this._selectedShapeId );
			if ( shape && this._selectionHighlight.lastRevision !== shape.revision ) {

				this._mountSelectionHighlight( shape );

			}

		}

		this._rafHandle = this._rafImpl( this._tickBound );

	}

	// ── 事件派发 ────────────────────────────────────────────

	_emit( event, payload ) {

		const bucket = this._listeners.get( event );
		if ( ! bucket ) return;
		for ( const callback of [ ...bucket ] ) {

			try {

				callback( payload );

			} catch ( error ) {

				console.error( `[PlotEditor] listener error on "${ event }":`, error );

			}

		}

	}

}

// ============================================================
// SelectionHighlight —— 选中高亮（独立于编辑会话的轻量线框）
// 坐标置换：shape (x, y, z) → world (x, z, y)
// ============================================================

class SelectionHighlight {

	constructor( options = {} ) {

		this.group = new Group();
		this.group.name = 'PlotEditor.SelectionHighlight';

		this._material = new LineBasicMaterial( {
			color: options.color ?? 0xffd54f,
			opacity: options.opacity ?? 0.95,
			transparent: ( options.opacity ?? 0.95 ) < 1,
			depthTest: false,
			depthWrite: false,
		} );

		this._line = null;
		this.lastRevision = -1;

	}

	update( shape ) {

		this._disposeLine();
		const positions = this._buildPositions( shape );
		if ( ! positions || positions.length === 0 ) {

			this.lastRevision = shape.revision ?? 0;
			return;

		}

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );

		const closed = isClosedKind( shape.kind );
		const line = closed ? new LineLoop( geometry, this._material ) : new Line( geometry, this._material );
		line.renderOrder = 997;
		line.frustumCulled = false;
		line.raycast = () => {};

		this._line = line;
		this.group.add( line );
		this.lastRevision = shape.revision ?? 0;

	}

	dispose() {

		this._disposeLine();
		this._material.dispose();
		this.group.removeFromParent();

	}

	_disposeLine() {

		if ( ! this._line ) return;
		this.group.remove( this._line );
		this._line.geometry?.dispose();
		this._line = null;

	}

	_buildPositions( shape ) {

		const coords = shape.coordinates || [];
		if ( coords.length === 0 ) return null;

		switch ( shape.kind ) {

			case 'line':
			case 'polyline':
			case 'polygon':
			case 'arrow':
				return flattenCoords( coords );

			case 'rectangle': {

				const [ a, b ] = coords;
				if ( ! a || ! b ) return null;
				const z = a[ 2 ] ?? 0;
				return [
					a[ 0 ], z, a[ 1 ],
					b[ 0 ], z, a[ 1 ],
					b[ 0 ], z, b[ 1 ],
					a[ 0 ], z, b[ 1 ],
				];

			}

			case 'circle': {

				const center = coords[ 0 ];
				if ( ! center ) return null;
				const radius = Number( shape.style?.radius ?? 0 );
				if ( radius <= 0 ) return null;
				return sampleCircle( center, radius, 0, Math.PI * 2, 48 );

			}

			case 'sector': {

				const center = coords[ 0 ];
				if ( ! center ) return null;
				const radius = Number( shape.style?.radius ?? 0 );
				if ( radius <= 0 ) return null;
				const startAngle = Number( shape.style?.startAngle ?? 0 );
				const sectorAngle = Number( shape.style?.sectorAngle ?? Math.PI );
				const positions = [];
				const z = center[ 2 ] ?? 0;
				positions.push( center[ 0 ], z, center[ 1 ] );
				const samples = sampleCircle( center, radius, startAngle, startAngle + sectorAngle, 32 );
				for ( let index = 0; index < samples.length; index ++ ) positions.push( samples[ index ] );
				positions.push( center[ 0 ], z, center[ 1 ] );
				return positions;

			}

			case 'point':
				return null;

			default:
				return flattenCoords( coords );

		}

	}

}

// ── 辅助 ────────────────────────────────────────────────────

function isClosedKind( kind ) {

	return kind === 'polygon' || kind === 'rectangle' || kind === 'circle';

}

function shouldDisplayAsPolygon( kind ) {

	return kind === 'polygon' ||
		kind === 'rectangle' ||
		kind === 'circle' ||
		kind === 'sector' ||
		kind === 'arrow';

}

function flattenCoords( coords ) {

	const out = new Array( coords.length * 3 );
	for ( let index = 0; index < coords.length; index ++ ) {

		const point = coords[ index ];
		// shape (x, y, z) → world (x, z, y)
		out[ index * 3 + 0 ] = point[ 0 ];
		out[ index * 3 + 1 ] = point[ 2 ] ?? 0;
		out[ index * 3 + 2 ] = point[ 1 ];

	}

	return out;

}

function sampleCircle( center, radius, startAngle, endAngle, segments ) {

	const positions = new Array( ( segments + 1 ) * 3 );
	const z = center[ 2 ] ?? 0;
	const span = endAngle - startAngle;
	for ( let index = 0; index <= segments; index ++ ) {

		const t = segments === 0 ? 0 : index / segments;
		const angle = startAngle + span * t;
		// shape (cx + cos*r, cy + sin*r, z) → world (sx, sz, sy)
		positions[ index * 3 + 0 ] = center[ 0 ] + Math.cos( angle ) * radius;
		positions[ index * 3 + 1 ] = z;
		positions[ index * 3 + 2 ] = center[ 1 ] + Math.sin( angle ) * radius;

	}

	return positions;

}

function clonePoint( point ) {

	return point?.length > 2
		? [ point[ 0 ], point[ 1 ], point[ 2 ] ]
		: [ point?.[ 0 ] ?? 0, point?.[ 1 ] ?? 0 ];

}

function cloneShapeForDisplay( shape ) {

	return {
		...shape,
		coordinates: ( shape.coordinates || [] ).map( clonePoint ),
		style: { ...( shape.style || {} ) },
		attachment: { ...( shape.attachment || {} ) },
	};

}

function scaleDisplayStyle( style = {}, scale = 1 ) {

	const result = { ...style };
	for ( const key of [ 'radius', 'width', 'headLength', 'strokeWidth', 'strokeWidthWorld', 'boundsPadding' ] ) {

		const value = Number( result[ key ] );
		if ( Number.isFinite( value ) ) result[ key ] = value * scale;

	}

	return result;

}

function coordinatesEqual( a, b ) {

	if ( a === b ) return true;
	if ( ! a || ! b ) return false;
	if ( a.length !== b.length ) return false;
	for ( let index = 0; index < a.length; index ++ ) {

		const pa = a[ index ];
		const pb = b[ index ];
		if ( pa.length !== pb.length ) return false;
		for ( let dim = 0; dim < pa.length; dim ++ ) {

			if ( pa[ dim ] !== pb[ dim ] ) return false;

		}

	}

	return true;

}

// ── 拾取相关的几何测试 ─────────────────────────────────────

function pointInPolygon( coords, x, y ) {

	let inside = false;
	const n = coords.length;
	if ( n < 3 ) return false;
	for ( let i = 0, j = n - 1; i < n; j = i ++ ) {

		const xi = coords[ i ][ 0 ];
		const yi = coords[ i ][ 1 ];
		const xj = coords[ j ][ 0 ];
		const yj = coords[ j ][ 1 ];
		const intersect = ( ( yi > y ) !== ( yj > y ) ) &&
			( x < ( xj - xi ) * ( y - yi ) / ( ( yj - yi ) || 1e-12 ) + xi );
		if ( intersect ) inside = ! inside;

	}

	return inside;

}

function pointToPolylineDistance( coords, x, y ) {

	let best = Infinity;
	for ( let i = 0; i < coords.length - 1; i ++ ) {

		const distance = pointToSegmentDistance( coords[ i ], coords[ i + 1 ], x, y );
		if ( distance < best ) best = distance;

	}

	return best;

}

function pointToSegmentDistance( a, b, x, y ) {

	const dx = b[ 0 ] - a[ 0 ];
	const dy = b[ 1 ] - a[ 1 ];
	const lengthSquared = dx * dx + dy * dy;
	if ( lengthSquared === 0 ) return Math.hypot( x - a[ 0 ], y - a[ 1 ] );
	let t = ( ( x - a[ 0 ] ) * dx + ( y - a[ 1 ] ) * dy ) / lengthSquared;
	t = Math.max( 0, Math.min( 1, t ) );
	const px = a[ 0 ] + t * dx;
	const py = a[ 1 ] + t * dy;
	return Math.hypot( x - px, y - py );

}

function isAngleInSector( angle, startAngle, sectorAngle ) {

	const TWO_PI = Math.PI * 2;
	const normalize = value => {

		let v = value % TWO_PI;
		if ( v < 0 ) v += TWO_PI;
		return v;

	};

	const a = normalize( angle - startAngle );
	const span = ( ( sectorAngle % TWO_PI ) + TWO_PI ) % TWO_PI;
	return a <= span;

}

function isPointInArrow( a, b, width, headLength, x, y ) {

	const ax = a[ 0 ], ay = a[ 1 ];
	const bx = b[ 0 ], by = b[ 1 ];
	const dx = bx - ax;
	const dy = by - ay;
	const length = Math.hypot( dx, dy );
	if ( length === 0 ) return false;
	const ux = dx / length;
	const uy = dy / length;
	// 法线向量
	const nx = - uy;
	const ny = ux;
	const neckX = bx - ux * headLength;
	const neckY = by - uy * headLength;
	// 简化处理：用 5 边形包络（与 HandleLayer 中 outline 一致）
	const polygon = [
		[ ax + nx * width * 0.35, ay + ny * width * 0.35 ],
		[ neckX + nx * width, neckY + ny * width ],
		[ bx, by ],
		[ neckX - nx * width, neckY - ny * width ],
		[ ax - nx * width * 0.35, ay - ny * width * 0.35 ],
	];
	return pointInPolygon( polygon, x, y );

}
