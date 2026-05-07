// ============================================================
// editor/EditSession.js — 单 shape 的编辑会话（"hot" 影子层）
// 层级：编辑层
// 职责：维护正在编辑的 shape 的影子拷贝、隐藏 cold 渲染、
//       提供 hot 层 mesh 的实时刷新、把最终编辑结果交回上层提交
// 依赖：three（既有项目栈），./HandleLayer.js，./ShapeEditAdapters.js，
//        plot-engine 内部的 createPrimitiveObject / disposeObjectTree
// 被消费：PlotEditor
// ============================================================

import { Group } from 'three';

import {
	createPrimitiveObject,
	disposeObjectTree,
} from '../pipes/primitiveFactory.js';

import { HandleLayer } from './HandleLayer.js';
import { getShapeEditAdapter } from './ShapeEditAdapters.js';

/**
 * 一次"编辑会话"对应一个正在被编辑的 shape。
 *
 * 设计核心是 MapTalks 的 shadow + Mapbox GL Draw 的 hot/cold：
 *
 *  1. 入会话时
 *     - 从 ShapeStore 拿 shape 的最新值，深拷贝为 _workingShape（影子）
 *     - 把 PlotEngine 的 cold 渲染中对应这个 shape id 的子对象 visible=false
 *
 *  2. 编辑期
 *     - 拖拽事件只更新 _workingShape.coordinates / .style
 *     - 通过 _dirty 标志告诉宿主"下一帧需要刷新 hot mesh 和 handle"
 *
 *  3. 提交
 *     - commit() 把 _workingShape 与 _initialShape 比较，差异部分形成命令
 *
 *  4. 取消
 *     - cancel() 直接销毁 hot 层并恢复 cold 可见性，ShapeStore 一字未改
 */
export class EditSession {

	constructor( options ) {

		this._plotEngine = options.plotEngine;
		this._shapeStore = options.plotEngine.shapeStore;
		this._compilerRegistry = options.plotEngine.compilerRegistry;
		this._shapeId = options.shapeId;
		this._mountGroup = options.mountGroup;
		this._shapeToDisplayPoint = typeof options.shapeToDisplayPoint === 'function'
			? options.shapeToDisplayPoint
			: point => point.length > 2 ? [ point[ 0 ], point[ 1 ], point[ 2 ] ] : [ point[ 0 ], point[ 1 ] ];
		this._displayToShapePoint = typeof options.displayToShapePoint === 'function'
			? options.displayToShapePoint
			: point => point.length > 2 ? [ point[ 0 ], point[ 1 ], point[ 2 ] ] : [ point[ 0 ], point[ 1 ] ];
		this._shapeToDisplayShape = typeof options.shapeToDisplayShape === 'function'
			? options.shapeToDisplayShape
			: shape => this._cloneShape( shape );
		this._shapeToOutlineShape = typeof options.shapeToOutlineShape === 'function'
			? options.shapeToOutlineShape
			: this._shapeToDisplayShape;

		const initial = this._shapeStore.get( this._shapeId );
		if ( ! initial ) {

			throw new Error( `EditSession: shape "${ this._shapeId }" not found.` );

		}

		this._adapter = getShapeEditAdapter( initial.kind );
		if ( ! this._adapter ) {

			throw new Error( `EditSession: no edit adapter for kind "${ initial.kind }".` );

		}

		this._initialShape = this._cloneShape( initial );
		this._workingShape = this._cloneShape( initial );

		this._sessionGroup = new Group();
		this._sessionGroup.name = `PlotEditor.Session.${ this._shapeId }`;
		this._sessionGroup.matrixAutoUpdate = true;
		this._mountGroup.add( this._sessionGroup );

		this._hotMesh = null;

		this._handleLayer = new HandleLayer( {
			sizeScale: Number( options.handleSizeScale ?? 1 ),
		} );
		this._sessionGroup.add( this._handleLayer.group );

		this._dirty = true;

		this._coldHiddenObjects = [];
		this._hideColdRenderingForShape();
		this._hideTiledRenderingForShape();

		this.flushIfDirty();

	}

	get shapeId() { return this._shapeId; }

	get workingShape() { return this._cloneShape( this._workingShape ); }

	get adapter() { return this._adapter; }

	get handleLayer() { return this._handleLayer; }

	get sessionGroup() { return this._sessionGroup; }

	displayPointToShape( point ) {

		return this._displayToShapePoint( point );

	}

	setWorkingPatch( patch ) {

		if ( ! patch ) return;
		if ( patch.coordinates ) {

			this._workingShape.coordinates = patch.coordinates.map( point => point.length > 2
				? [ point[ 0 ], point[ 1 ], point[ 2 ] ]
				: [ point[ 0 ], point[ 1 ] ] );

		}

		if ( patch.style ) {

			this._workingShape.style = { ...this._workingShape.style, ...patch.style };

		}

		this._dirty = true;

	}

	setWorkingShape( shape ) {

		this._workingShape = this._cloneShape( shape );
		this._dirty = true;

	}

	invalidate() {

		this._dirty = true;

	}

	flushIfDirty() {

		if ( ! this._dirty ) return;
		this._dirty = false;
		this._rebuildHotMesh();
		this._rebuildHandlesAndOutline();

	}

	computeDiff() {

		const beforeCoordinates = this._initialShape.coordinates.map( point => point.slice() );
		const afterCoordinates = this._workingShape.coordinates.map( point => point.slice() );
		const beforeStyle = { ...this._initialShape.style };
		const afterStyle = { ...this._workingShape.style };

		return {
			beforeCoordinates,
			afterCoordinates,
			beforeStyle,
			afterStyle,
			coordinatesChanged: ! coordinatesEqual( beforeCoordinates, afterCoordinates ),
			styleChanged: ! shallowEqual( beforeStyle, afterStyle ),
		};

	}

	refreshColdHiding() {

		this._coldHiddenObjects = this._coldHiddenObjects.filter( entry => {

			return entry.object && entry.object.parent != null;

		} );

		const tracked = new Set( this._coldHiddenObjects.map( entry => entry.object ) );
		const candidates = [];

		const visit = root => {

			if ( ! root ) return;
			root.traverse( object => {

				if ( object.userData?.plotShapeId === this._shapeId &&
					object.visible &&
					! tracked.has( object ) ) {

					candidates.push( object );

				}

			} );

		};

		visit( this._plotEngine.worldPipe?.group );
		const surfacePipe = this._plotEngine.surfacePipe;
		if ( surfacePipe?._groups ) {

			for ( const group of surfacePipe._groups.values() ) visit( group );

		}

		for ( const object of candidates ) {

			this._coldHiddenObjects.push( {
				object,
				originalVisible: object.visible,
			} );
			object.visible = false;

		}

	}

	dispose() {

		for ( const entry of this._coldHiddenObjects ) {

			if ( entry.object ) entry.object.visible = entry.originalVisible;

		}

		this._showTiledRenderingForShape();
		this._coldHiddenObjects.length = 0;

		if ( this._hotMesh ) {

			this._sessionGroup.remove( this._hotMesh );
			disposeObjectTree( this._hotMesh, { disposeMaterials: true } );
			this._hotMesh = null;

		}

		this._handleLayer.dispose();
		this._sessionGroup.removeFromParent();

	}

	// ── 内部 ──

	_cloneShape( shape ) {

		return {
			id: shape.id,
			kind: shape.kind,
			coordinates: ( shape.coordinates || [] ).map( point => point.length > 2
				? [ point[ 0 ], point[ 1 ], point[ 2 ] ]
				: [ point[ 0 ], point[ 1 ] ] ),
			style: { ...( shape.style || {} ) },
			attachment: { ...( shape.attachment || {} ) },
			revision: shape.revision ?? 0,
		};

	}

	_rebuildHotMesh() {

		const displayShape = this._shapeToDisplayShape( this._workingShape );
		const tempShape = {
			...displayShape,
			revision: ( this._workingShape.revision ?? 0 ) + 1,
		};
		let compiled = null;
		try {

			compiled = this._compilerRegistry.compile( tempShape );

		} catch ( error ) {

			console.warn( '[EditSession] compile failed during edit:', error );
			return;

		}

		if ( ! compiled ) return;

		const newMesh = createPrimitiveObject( compiled );
		if ( ! newMesh ) return;

		configureEditOverlayObject( newMesh );
		newMesh.raycast = () => {};
		newMesh.frustumCulled = false;
		newMesh.renderOrder = 998;

		if ( this._hotMesh ) {

			this._sessionGroup.remove( this._hotMesh );
			disposeObjectTree( this._hotMesh, { disposeMaterials: true } );

		}

		this._hotMesh = newMesh;
		this._sessionGroup.add( this._hotMesh );

	}

	_rebuildHandlesAndOutline() {

		const handles = this._adapter.getEditableHandles( this._workingShape ).map( handle => ( {
			...handle,
			position: this._shapeToDisplayPoint( handle.position ),
		} ) );
		const displayShape = this._shapeToOutlineShape( this._workingShape );
		this._handleLayer.updateHandles( handles );
		this._handleLayer.updateOutline( displayShape.kind, displayShape );

	}

	_hideColdRenderingForShape() {

		const visit = root => {

			if ( ! root ) return;
			root.traverse( object => {

				if ( object.userData?.plotShapeId === this._shapeId && object.visible ) {

					this._coldHiddenObjects.push( {
						object,
						originalVisible: object.visible,
					} );
					object.visible = false;

				}

			} );

		};

		visit( this._plotEngine.worldPipe?.group );
		const surfacePipe = this._plotEngine.surfacePipe;
		if ( surfacePipe?._groups ) {

			for ( const group of surfacePipe._groups.values() ) {

				visit( group );

			}

		}

	}

	_hideTiledRenderingForShape() {

		this._plotEngine.tiledPipe?.setShapeHidden?.( this._shapeId, true );

	}

	_showTiledRenderingForShape() {

		this._plotEngine.tiledPipe?.setShapeHidden?.( this._shapeId, false );

	}

}

// ── 辅助比较函数 ────────────────────────────────────────────

function configureEditOverlayObject( object ) {

	object.traverse?.( child => {

		const material = child.material;
		if ( Array.isArray( material ) ) {

			for ( const entry of material ) configureEditOverlayMaterial( entry );

		} else {

			configureEditOverlayMaterial( material );

		}

	} );

}

function configureEditOverlayMaterial( material ) {

	if ( ! material ) return;
	material.depthTest = false;
	material.depthWrite = false;
	material.needsUpdate = true;

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

function shallowEqual( a, b ) {

	if ( a === b ) return true;
	if ( ! a || ! b ) return false;
	const keysA = Object.keys( a );
	const keysB = Object.keys( b );
	if ( keysA.length !== keysB.length ) return false;
	for ( const key of keysA ) {

		if ( a[ key ] !== b[ key ] ) return false;

	}

	return true;

}
