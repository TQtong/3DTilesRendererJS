// ============================================================
// editor/DragController.js — 编辑期的指针 / 鼠标状态机
// 层级：编辑层
// 职责：监听 renderer.domElement 的 pointer 事件，做 raycast 命中 handle，
//       维护 idle / hover / drag 三态，把 drag 解出的局部坐标喂给 EditSession，
//       松手时把最终编辑结果交回 PlotEditor 完成命令入栈
// 依赖：three（Raycaster / Plane / Vector2 / Vector3）
// 被消费：PlotEditor
//
// 坐标约定：
//   编辑器使用与 PlotEngine 一致的 Y-up 世界系。shape.coordinates 中的
//   [x, y, z] 对应世界 (x, z, y) ——  z 为高度。本控制器在
//   _anchorDragPlane / _pickLocalPointOnDragPlane 中完成两套坐标系互转。
// ============================================================

import {
	Matrix4,
	Plane,
	Raycaster,
	Vector2,
	Vector3,
} from 'three';

const _planeNormal = new Vector3( 0, 1, 0 );
const _ndc = new Vector2();
const _hitPoint = new Vector3();
const _localHitPoint = new Vector3();
const _invMatrix = new Matrix4();
const _worldPoint = new Vector3();

const STATE_IDLE = 'idle';
const STATE_HOVER = 'hover';
const STATE_DRAG_VERTEX = 'drag-vertex';
const STATE_DRAG_INSERT = 'drag-insert';
const STATE_DRAG_CENTER = 'drag-center';
const STATE_DRAG_PARAM = 'drag-param';

/**
 * DragController 不直接修改 ShapeStore；它把所有"语义事件"通过回调上报给 PlotEditor：
 *  - onHandleHover(handle | null)
 *  - onDragStart(handle, kind)
 *  - onDragMove(handle, localPoint)  —— localPoint 已转换为 shape 坐标 [x, y, z]
 *  - onDragEnd(handle, kind)
 *  - onInsertVertex(midpointHandle, localPoint) → resolvedHandleId
 *  - onRemoveVertex(handle)
 */
export class DragController {

	constructor( options ) {

		this._domElement = options.domElement;
		this._camera = options.camera;
		this._workingFrame = options.workingFrame;
		this._callbacks = options.callbacks || {};

		this._handleLayer = null;

		this._raycaster = new Raycaster();
		this._raycaster.params.Points.threshold = 0;
		this._raycaster.params.Line.threshold = 0;

		this._dragPlane = new Plane();

		this._state = STATE_IDLE;
		this._activeHandle = null;
		this._dragStartLocalPoint = new Vector3();
		this._lastHoverKey = '';

		this._lastClickTime = 0;
		this._lastClickHandleId = '';
		this._doubleClickThresholdMs = 300;

		this._onPointerDown = this._handlePointerDown.bind( this );
		this._onPointerMove = this._handlePointerMove.bind( this );
		this._onPointerUp = this._handlePointerUp.bind( this );
		this._onContextMenu = this._handleContextMenu.bind( this );

		this._enabled = false;

	}

	setHandleLayer( handleLayer ) {

		this._handleLayer = handleLayer || null;
		this._setHover( null );
		this._state = STATE_IDLE;
		this._activeHandle = null;

	}

	setWorkingFrame( frame ) {

		this._workingFrame = frame;

	}

	enable() {

		if ( this._enabled ) return;
		this._enabled = true;
		this._domElement.addEventListener( 'pointerdown', this._onPointerDown );
		this._domElement.addEventListener( 'pointermove', this._onPointerMove );
		window.addEventListener( 'pointerup', this._onPointerUp );
		this._domElement.addEventListener( 'contextmenu', this._onContextMenu );

	}

	disable() {

		if ( ! this._enabled ) return;
		this._enabled = false;
		this._domElement.removeEventListener( 'pointerdown', this._onPointerDown );
		this._domElement.removeEventListener( 'pointermove', this._onPointerMove );
		window.removeEventListener( 'pointerup', this._onPointerUp );
		this._domElement.removeEventListener( 'contextmenu', this._onContextMenu );
		this._setHover( null );
		this._state = STATE_IDLE;
		this._activeHandle = null;

	}

	dispose() {

		this.disable();
		this._handleLayer = null;
		this._callbacks = {};

	}

	// ── 内部 ──

	_updateNdc( event ) {

		const rect = this._domElement.getBoundingClientRect();
		_ndc.x = ( ( event.clientX - rect.left ) / rect.width ) * 2 - 1;
		_ndc.y = - ( ( event.clientY - rect.top ) / rect.height ) * 2 + 1;

	}

	_raycastHandle() {

		if ( ! this._handleLayer ) return null;
		const targets = this._handleLayer.getRaycastTargets();
		if ( targets.length === 0 ) return null;
		this._raycaster.setFromCamera( _ndc, this._camera );
		const intersections = this._raycaster.intersectObjects( targets, false );
		if ( intersections.length === 0 ) return null;
		const hit = intersections[ 0 ];
		const instanceId = hit.instanceId ?? -1;
		if ( instanceId < 0 ) return null;
		return this._handleLayer.resolveHit( hit.object, instanceId );

	}

	/**
	 * 在 dragPlane 上拾取命中点，并将其从世界坐标转换为 shape 坐标系
	 * (x, y, z) ←→ (worldX, worldZ, worldY)。
	 *
	 * @param {boolean} updateRayFromNdc
	 * @returns {{x:number, y:number, z:number}|null}
	 */
	_pickLocalPointOnDragPlane( updateRayFromNdc = false ) {

		if ( updateRayFromNdc ) this._raycaster.setFromCamera( _ndc, this._camera );
		const ray = this._raycaster.ray;
		const intersect = ray.intersectPlane( this._dragPlane, _hitPoint );
		if ( ! intersect ) return null;

		this._workingFrame.updateMatrixWorld( true );
		// 世界 → workingFrame 局部（使用模块级缓存的临时矩阵，避免高频分配）
		_invMatrix.copy( this._workingFrame.matrixWorld ).invert();
		_localHitPoint.copy( _hitPoint ).applyMatrix4( _invMatrix );
		// (worldX, worldY, worldZ) → shape (sx=worldX, sy=worldZ, sz=worldY)
		return {
			x: _localHitPoint.x,
			y: _localHitPoint.z,
			z: _localHitPoint.y,
		};

	}

	/**
	 * 在 dragStart 时锚定拖拽平面：
	 *   - 平面法线 = workingFrame 局部 +Y 在世界中的方向
	 *   - 平面经过点 = handle 的世界位置（由 shape (x,y,z) 转换为世界 (x,z,y)）
	 */
	_anchorDragPlane( handle ) {

		this._workingFrame.updateMatrixWorld( true );

		_planeNormal.set( 0, 1, 0 ).transformDirection( this._workingFrame.matrixWorld ).normalize();

		const bucket = this._findBucket( handle.type );
		if ( ! bucket ) return false;
		const point = bucket.positions[ handle.instanceId ];
		if ( ! point ) return false;

		// shape (x, y, z) → world local (x, z, y)
		const sz = point.length > 2 ? Number( point[ 2 ] ) || 0 : 0;
		_worldPoint.set( point[ 0 ], sz, point[ 1 ] ).applyMatrix4( this._workingFrame.matrixWorld );

		this._dragPlane.setFromNormalAndCoplanarPoint( _planeNormal, _worldPoint );
		return true;

	}

	_findBucket( type ) {

		if ( ! this._handleLayer ) return null;
		return this._handleLayer._buckets.get( type ) || null;

	}

	_setHover( handle ) {

		const key = handle ? `${ handle.type }:${ handle.handleId }` : '';
		if ( key === this._lastHoverKey ) return;
		this._lastHoverKey = key;
		this._handleLayer?.setHovered( handle );
		this._callbacks.onHandleHover?.( handle );
		if ( handle ) {

			this._domElement.style.cursor = handle.type === 'center'
				? 'move'
				: handle.type === 'midpoint'
					? 'copy'
					: 'pointer';

		} else if ( this._state === STATE_IDLE ) {

			this._domElement.style.cursor = '';

		}

	}

	_handlePointerDown( event ) {

		if ( ! this._handleLayer ) return;
		if ( event.button !== 0 ) return;

		this._updateNdc( event );
		const handle = this._raycastHandle();
		if ( ! handle ) return;

		event.preventDefault();
		event.stopPropagation();
		this._domElement.setPointerCapture?.( event.pointerId );

		if ( ! this._anchorDragPlane( handle ) ) return;

		const now = performance.now?.() ?? Date.now();
		const isDoubleClick = ( now - this._lastClickTime ) < this._doubleClickThresholdMs &&
			this._lastClickHandleId === handle.handleId;
		this._lastClickTime = now;
		this._lastClickHandleId = handle.handleId;
		const isRemoveGesture = handle.type === 'vertex' && ( event.altKey || isDoubleClick );
		if ( isRemoveGesture ) {

			this._callbacks.onRemoveVertex?.( handle );
			this._setHover( null );
			return;

		}

		const localStart = this._pickLocalPointOnDragPlane();
		if ( ! localStart ) return;
		this._dragStartLocalPoint.set( localStart.x, localStart.y, localStart.z );

		// 中点 → 立即插入顶点 → 转入 DRAG_INSERT
		if ( handle.type === 'midpoint' ) {

			const resolvedHandleId = this._callbacks.onInsertVertex?.( handle, [ localStart.x, localStart.y, localStart.z ] );
			if ( resolvedHandleId ) {

				const newHandle = {
					type: 'vertex',
					handleId: resolvedHandleId,
					instanceId: -1,
				};
				this._activeHandle = newHandle;
				this._state = STATE_DRAG_INSERT;
				this._callbacks.onDragStart?.( newHandle, this._state );
				return;

			}

		}

		this._activeHandle = handle;
		this._state =
			handle.type === 'vertex' ? STATE_DRAG_VERTEX :
			handle.type === 'center' ? STATE_DRAG_CENTER :
				STATE_DRAG_PARAM;
		this._domElement.style.cursor = 'grabbing';
		this._callbacks.onDragStart?.( handle, this._state );

	}

	_handlePointerMove( event ) {

		if ( ! this._handleLayer ) return;

		this._updateNdc( event );

		if ( this._state === STATE_DRAG_VERTEX ||
			this._state === STATE_DRAG_INSERT ||
			this._state === STATE_DRAG_CENTER ||
			this._state === STATE_DRAG_PARAM ) {

			const local = this._pickLocalPointOnDragPlane( true );
			if ( ! local ) return;
			event.preventDefault();
			event.stopPropagation();
			this._callbacks.onDragMove?.( this._activeHandle, [ local.x, local.y, local.z ] );
			return;

		}

		const hit = this._raycastHandle();
		this._setHover( hit );
		this._state = hit ? STATE_HOVER : STATE_IDLE;

	}

	_handlePointerUp( event ) {

		try {

			this._domElement.releasePointerCapture?.( event.pointerId );

		} catch ( unused ) { /* ignored */ }

		if ( this._state === STATE_DRAG_VERTEX ||
			this._state === STATE_DRAG_INSERT ||
			this._state === STATE_DRAG_CENTER ||
			this._state === STATE_DRAG_PARAM ) {

			const finishedHandle = this._activeHandle;
			const finishedKind = this._state;
			this._activeHandle = null;
			this._state = STATE_IDLE;
			this._domElement.style.cursor = '';
			this._callbacks.onDragEnd?.( finishedHandle, finishedKind );
			this._setHover( null );

		}

	}

	_handleContextMenu( event ) {

		if ( this._handleLayer ) event.preventDefault();

	}

}
