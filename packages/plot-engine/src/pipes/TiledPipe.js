import {
	AlwaysStencilFunc,
	BackSide,
	Box3,
	BufferGeometry,
	DecrementWrapStencilOp,
	DoubleSide,
	Float32BufferAttribute,
	FrontSide,
	Group,
	IncrementWrapStencilOp,
	KeepStencilOp,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	NotEqualStencilFunc,
	Shape,
	ShapeGeometry,
	ShapeUtils,
	Vector2,
	Vector3,
	ZeroStencilOp,
} from 'three';
import { buildRasterPlotTexture, canBuildRasterPlotTexture } from '../RasterPlotTexture.js';
import { buildSdfTexture } from '../SdfDataBuilder.js';
import { SpatialIndex } from '../SpatialIndex.js';
import { cloneBounds } from '../utils/bounds.js';
import {
	clearWrappedTiledSdfMaterial,
	disposeWrappedTiledSdfMaterial,
	updateWrappedTiledSdfMaterial,
	wrapTiledSdfMaterial,
} from './tiledSdfMaterial.js';

const _box = /* @__PURE__ */ new Box3();
const _size = /* @__PURE__ */ new Vector3();
const _position = /* @__PURE__ */ new Vector3();
const _projectedPosition = [ 0, 0, 0 ];

// meshOverlay 模式专用：临时容器
const _tmpInverseMatrix = /* @__PURE__ */ new Matrix4();
const noopRaycast = () => {};

// stencil shadow volume 的上下盖高度：volume 必须把所有可能的地形高度都包进来。
// 取 ±20km 足以覆盖珠峰 / 马里亚纳海沟，且不会因为太大引起严重的 depth 精度问题
// （配合 logarithmic depth buffer 即可）。
const VOLUME_TOP_ALTITUDE = 20000;
const VOLUME_BOTTOM_ALTITUDE = - 5000;

// 渲染顺序：volume 必须在地形之后绘制
const STENCIL_BACK_RENDER_ORDER = 1;
const STENCIL_FRONT_RENDER_ORDER = 2;
const STENCIL_COLOR_RENDER_ORDER = 3;

/**
 * 在 lon/lat 平面上计算 polygon 有符号面积（鞋带公式）。
 * > 0 → CCW，< 0 → CW。共线 / 退化时返回 0。
 *
 * @param {Array<Array<number>>} ring
 * @returns {number}
 */
function computePolygonSignedArea( ring ) {

	let area = 0;
	const n = ring.length;
	for ( let i = 0; i < n; i ++ ) {

		const a = ring[ i ];
		const b = ring[ ( i + 1 ) % n ];
		area += a[ 0 ] * b[ 1 ] - b[ 0 ] * a[ 1 ];

	}

	return 0.5 * area;

}

/**
 * 把一个 cartographic 多边形（lon/lat 平面）拉成"上下贯穿"的 3D 阴影体。
 *
 * 阴影体由三部分组成：
 *   - 顶盖（top cap）：在 VOLUME_TOP_ALTITUDE 高度三角化原多边形
 *   - 底盖（bottom cap）：同样三角化但 winding 反向（让法线朝下）
 *   - 侧墙（side walls）：每条原边变成一个垂直矩形（两个三角形）
 *
 * Cesium GroundPrimitive 的核心套路：
 *   - 渲染地形（depth 写入）
 *   - 渲染阴影体的"背面"，stencil += 1 (on Z-fail)
 *   - 渲染阴影体的"正面"，stencil -= 1 (on Z-fail)
 *   - 至此 stencil ≠ 0 的像素 == 它的地形像素正好在多边形 2D 投影内
 *   - 渲染阴影体的任意面，开 stencilFunc=NOT_EQUAL ref=0，把多边形颜色覆盖上去
 *
 * 这样做的好处：
 *   - 不需要 raycast 采样地形（依赖深度缓冲做"分类"，比 raycast 稳得多）
 *   - 不需要按 tile 切，整个 polygon 一份 mesh，无 LOD 跳变
 *   - 边缘只受阴影体几何精度限制（顶点级），相机怎么动都不会抖
 *
 * 返回 null 表示反投影失败（缺少 surfaceAdapter 或某顶点投影失败）。
 *
 * @param {Array<Array<number>>} outline2D - polygon 在 (lon, lat) 平面的外轮廓
 * @param {object} target - PlotTarget（必须有 surfaceAdapter.unprojectPosition）
 * @param {object} adapter - target.options.surfaceAdapter
 * @returns {Float32Array|null}
 */
function buildShadowVolumePositions( outline2D, target, adapter ) {

	let n = outline2D.length;
	if ( n < 3 ) return null;

	// 0) winding 检测：若输入是 CW（在 lon/lat 平面看）则反向，确保后面所有
	//    "CCW from above"、"CCW from outside"等推导前提成立。否则 stencil
	//    incr/decr 计数会错号（虽然 NotEqual ref=0 仍会通过，但侧墙的法线
	//    朝向会反 → BackSide/FrontSide 命中错位 → stencil ≠ 0 的像素集会被
	//    错误地泛化到整个 volume 的可见面 → 渲染出"柱体"）
	const ccw = computePolygonSignedArea( outline2D ) >= 0;
	const ring = ccw ? outline2D : outline2D.slice().reverse();

	// 1) 计算每个轮廓顶点的"顶"和"底"世界坐标
	const top = new Array( n );
	const bot = new Array( n );
	for ( let i = 0; i < n; i ++ ) {

		const [ lon, lat ] = ring[ i ];
		const t = [ 0, 0, 0 ];
		const b = [ 0, 0, 0 ];
		if ( ! adapter.unprojectPosition( [ lon, lat, VOLUME_TOP_ALTITUDE ], null, target, t ) ) return null;
		if ( ! adapter.unprojectPosition( [ lon, lat, VOLUME_BOTTOM_ALTITUDE ], null, target, b ) ) return null;
		top[ i ] = t;
		bot[ i ] = b;

	}

	// 2) 三角化（在 lon/lat 平面，使用规范化后的 CCW 环）
	const contour = ring.map( point => new Vector2( point[ 0 ], point[ 1 ] ) );
	const triangles = ShapeUtils.triangulateShape( contour, [] );
	if ( triangles.length === 0 ) return null;

	const positions = [];

	// 3) 顶盖：保持原 winding（CCW 从上方看）→ 法线朝外（朝上）
	for ( const tri of triangles ) {

		positions.push(
			top[ tri[ 0 ] ][ 0 ], top[ tri[ 0 ] ][ 1 ], top[ tri[ 0 ] ][ 2 ],
			top[ tri[ 1 ] ][ 0 ], top[ tri[ 1 ] ][ 1 ], top[ tri[ 1 ] ][ 2 ],
			top[ tri[ 2 ] ][ 0 ], top[ tri[ 2 ] ][ 1 ], top[ tri[ 2 ] ][ 2 ],
		);

	}

	// 4) 底盖：反向 winding → 法线朝外（朝下）
	for ( const tri of triangles ) {

		positions.push(
			bot[ tri[ 2 ] ][ 0 ], bot[ tri[ 2 ] ][ 1 ], bot[ tri[ 2 ] ][ 2 ],
			bot[ tri[ 1 ] ][ 0 ], bot[ tri[ 1 ] ][ 1 ], bot[ tri[ 1 ] ][ 2 ],
			bot[ tri[ 0 ] ][ 0 ], bot[ tri[ 0 ] ][ 1 ], bot[ tri[ 0 ] ][ 2 ],
		);

	}

	// 5) 侧墙：每条边一个矩形（两个三角形），CCW 从外侧看
	//    顶点顺序 (top_i, bot_i, bot_j) + (top_i, bot_j, top_j)
	for ( let i = 0; i < n; i ++ ) {

		const j = ( i + 1 ) % n;
		const ti = top[ i ], tj = top[ j ];
		const bi = bot[ i ], bj = bot[ j ];

		positions.push(
			ti[ 0 ], ti[ 1 ], ti[ 2 ],
			bi[ 0 ], bi[ 1 ], bi[ 2 ],
			bj[ 0 ], bj[ 1 ], bj[ 2 ],
		);
		positions.push(
			ti[ 0 ], ti[ 1 ], ti[ 2 ],
			bj[ 0 ], bj[ 1 ], bj[ 2 ],
			tj[ 0 ], tj[ 1 ], tj[ 2 ],
		);

	}

	return new Float32Array( positions );

}

/**
 * 阴影体的"背面" stencil pass material：
 *   - 只走背面（BackSide）
 *   - 不写颜色、不写深度
 *   - 在深度测试失败（fragment 落在地形之后）时把 stencil += 1
 *
 * 几何意义：从 camera 看出去，背面落在地形之后说明 "我们正穿出阴影体"——
 * 如果终点（地形）位于阴影体内部，就会有一个未被对应正面抵消的背面 → stencil ≠ 0
 */
function makeBackStencilMaterial() {

	return new MeshBasicMaterial( {
		side: BackSide,
		colorWrite: false,
		depthWrite: false,
		depthTest: true,
		stencilWrite: true,
		stencilFunc: AlwaysStencilFunc,
		stencilRef: 0,
		stencilFuncMask: 0xff,
		stencilFail: KeepStencilOp,
		stencilZFail: IncrementWrapStencilOp,
		stencilZPass: KeepStencilOp,
	} );

}

/**
 * 阴影体的"正面" stencil pass material：
 *   - 只走正面（FrontSide）
 *   - 不写颜色、不写深度
 *   - 在深度测试失败时把 stencil -= 1
 *
 * 几何意义：从 camera 看出去，正面落在地形之后说明"我们曾经从这里入过阴影体
 * 但地形位于阴影体之外"——所以应该把 back face 的 +1 抵消掉。
 */
function makeFrontStencilMaterial() {

	return new MeshBasicMaterial( {
		side: FrontSide,
		colorWrite: false,
		depthWrite: false,
		depthTest: true,
		stencilWrite: true,
		stencilFunc: AlwaysStencilFunc,
		stencilRef: 0,
		stencilFuncMask: 0xff,
		stencilFail: KeepStencilOp,
		stencilZFail: DecrementWrapStencilOp,
		stencilZPass: KeepStencilOp,
	} );

}

/**
 * 颜色覆盖 pass material：
 *   - **DoubleSide**：相机在 polygon 的垂直立柱"内部"时（即站在 polygon 的
 *     2D 投影正上方且高度 < volume top），FrontSide 命中不到任何 CCW 三角形，
 *     polygon 就会消失。DoubleSide 让正反面都参与绘制；同一像素被两次扫到时，
 *     第一次的 `stencilZPass: ZERO` 已经把 stencil 清零，第二次 NotEqual ref=0
 *     测试就会失败 → 自动只画一次，不会出现透明叠加加深的问题。
 *   - 关闭深度测试 / 写入：让色块直接画在最上层、不和地形深度打架
 *   - stencilFunc=NOT_EQUAL ref=0：只在 stencil ≠ 0 的像素绘制——也就是
 *     之前阴影体证明"地形位于其内部"的那些像素
 *   - stencilZPass=ZERO：绘制完成后把 stencil 复位到 0，避免污染下一帧 /
 *     下一形状，同时让 DoubleSide 的第二次扫描自动 short-circuit
 */
function makeColorStencilMaterial( colorHex, opacity ) {

	return new MeshBasicMaterial( {
		color: colorHex,
		side: DoubleSide,
		transparent: true,
		opacity,
		depthWrite: false,
		depthTest: false,
		stencilWrite: true,
		stencilFunc: NotEqualStencilFunc,
		stencilRef: 0,
		stencilFuncMask: 0xff,
		stencilFail: KeepStencilOp,
		stencilZFail: ZeroStencilOp,
		stencilZPass: ZeroStencilOp,
	} );

}

// 颜色辅助：与 primitiveFactory 共用同一份转换
function colorValueFromRgba( rgba, fallback = 0xffffff ) {

	if ( ! rgba ) return fallback;
	return ( Math.round( rgba[ 0 ] * 255 ) << 16 ) |
		( Math.round( rgba[ 1 ] * 255 ) << 8 ) |
		Math.round( rgba[ 2 ] * 255 );

}

function formatBounds( bounds ) {

	if ( ! bounds ) return null;
	return bounds.map( value => Number( Number( value ).toFixed( 6 ) ) );

}

function sameBounds( left, right ) {

	if ( left === right ) return true;
	if ( ! left || ! right ) return false;
	return (
		left[ 0 ] === right[ 0 ] &&
		left[ 1 ] === right[ 1 ] &&
		left[ 2 ] === right[ 2 ] &&
		left[ 3 ] === right[ 3 ]
	);

}

function getTileShapeKey( compiledShapes ) {

	return compiledShapes.map( compiled => `${ compiled.id }:${ compiled.revision }` ).join( '|' );

}

function getDecalHeightOffset( compiledShapes, fallback ) {

	return Number( fallback ?? 0 );

}

function getProjectedAttachmentTargetIds( compiled, loadedTargets ) {

	const attachment = compiled?.attachment || {};
	const attachmentMode = attachment.mode ?? 'world';
	if ( attachmentMode !== 'tiles' && attachmentMode !== 'surface' ) return [];
	if ( attachment.targetId != null ) return [ attachment.targetId ];
	return loadedTargets;

}

function getSurfaceAdapter( target ) {

	return target?.options?.surfaceAdapter ?? null;

}

function applyPlanarFallbackGeometry( geometry, position, uv, heightOffset ) {

	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	const localSpanX = Math.max( box.max.x - box.min.x, 1e-12 );
	const localSpanZ = Math.max( box.max.z - box.min.z, 1e-12 );
	let positionChanged = false;

	for ( let index = 0; index < position.count; index ++ ) {

		_position.fromBufferAttribute( position, index );
		uv[ index * 2 + 0 ] = ( _position.x - box.min.x ) / localSpanX;
		uv[ index * 2 + 1 ] = ( _position.z - box.min.z ) / localSpanZ;
		if ( heightOffset !== 0 ) {

			position.setY( index, _position.y + heightOffset );
			positionChanged = true;

		}

	}

	return positionChanged;

}

function cloneOverlayMaterial( material ) {

	if ( ! material ) return material;
	wrapTiledSdfMaterial( material );
	return material;

}

function disposeOverlayMaterial( material, ownsMaterial = false ) {

	if ( ! material ) return;
	disposeWrappedTiledSdfMaterial( material );
	if ( ownsMaterial ) material.dispose?.();

}

function disposeEntryTexture( texture ) {

	if ( ! texture ) return;

	const image = texture.image ?? texture.source?.data ?? null;
	texture.dispose?.();

	if ( texture.source ) {

		texture.source.data = null;

	}

	if ( image && typeof image === 'object' ) {

		if ( 'data' in image ) image.data = null;
		if ( 'width' in image ) image.width = 0;
		if ( 'height' in image ) image.height = 0;

	}

	texture.image = null;

}

export class TiledPipe {

	constructor( engine, options = {} ) {

		this.engine = engine;
		this.opacity = options.opacity ?? 1;
		this.heightOffset = options.heightOffset ?? 0;
		this.rasterize = options.rasterize ?? true;
		this.rasterTextureSize = options.rasterTextureSize ?? 512;
		this._loadedTiles = new Map();
		this._tileIndices = new Map();
		this._hiddenShapeIds = new Set();

		// meshOverlay：用 stencil shadow volume 实现 Cesium GroundPrimitive 风格的
		// "分类贴地"——polygon 的颜色精确落在地形像素上、跨 tile 不抖、相机怎么动
		// 都不会漂移、边缘是顶点级 MSAA 锐利。
		//
		// 算法：每个 cartographic shape 拉成一个上下贯穿的 3D 阴影体
		//   （top@+20km / bot@-5km，足以套住任何地形高度），随后做三个 pass：
		//   ① 渲染地形（depth buffer 自然写入）
		//   ② 阴影体背面 Z-fail 时 stencil += 1
		//   ③ 阴影体正面 Z-fail 时 stencil -= 1
		//   ④ 阴影体任意面 + stencilFunc=NOT_EQUAL ref=0：在 stencil ≠ 0 的像素
		//      （= 地形像素正好位于 polygon 2D 投影内）覆盖颜色，并把 stencil 复位
		//
		// **硬性前提**：WebGLRenderer 必须启用 stencil 缓冲：
		//   ```
		//   new WebGLRenderer( { stencil: true, ... } )
		//   ```
		//   否则 stencil 测试形同虚设，阴影体会被整体绘制为可见柱体。
		//
		// **target 前提**：target.options.surfaceAdapter 必须提供 unprojectPosition
		//   方法（cartographic → 世界坐标）。本仓库默认的 createTilesRendererTargetAdapter
		//   已经实现。
		this.meshOverlay = options.meshOverlay === true;
		this._meshGroup = null;
		this._shapeVolumes = new Map(); // shapeId → { cacheKey, geometry, backMesh, frontMesh, colorMesh }

	}

	setShapeHidden( shapeId, hidden = true ) {

		if ( shapeId == null ) return this;
		const wasHidden = this._hiddenShapeIds.has( shapeId );
		if ( hidden ) {

			if ( wasHidden ) return this;
			this._hiddenShapeIds.add( shapeId );

		} else {

			if ( ! wasHidden ) return this;
			this._hiddenShapeIds.delete( shapeId );

		}

		if ( this.meshOverlay ) {

			// mesh 模式：阴影体的 3 个 pass mesh 都要切 visible，否则只藏一半
			// 会出现"颜色还在 + 阴影体几何不在"的不一致状态
			const volume = this._shapeVolumes.get( shapeId );
			if ( volume ) {

				const v = ! hidden;
				if ( volume.backMesh ) volume.backMesh.visible = v;
				if ( volume.frontMesh ) volume.frontMesh.visible = v;
				if ( volume.colorMesh ) volume.colorMesh.visible = v;

			}

		} else {

			this._rebuildTilesForShape( shapeId );

		}

		return this;

	}

	attachEntry( target, surfaceEntry ) {

		const targetTiles = this._ensureTargetMap( this._loadedTiles, target.id );
		const entryKey = surfaceEntry.key;
		const visible = surfaceEntry.visible !== false;
		const bounds = this._getEntryBounds( target, surfaceEntry );
		let entry = targetTiles.get( entryKey ) || null;

		if ( entry ) {

			entry.target = target;
			entry.scene = surfaceEntry.scene;
			entry.surfaceEntry = surfaceEntry;
			entry.visible = visible;
			if ( bounds ) this._updateTileBounds( target.id, entry, bounds );

		} else {

			entry = {
				target,
				scene: surfaceEntry.scene,
				surfaceEntry,
				tile: entryKey,
				visible,
				bounds: bounds ? cloneBounds( bounds ) : null,
				meshEntries: null,
				texture: null,
				textureMode: 'vector',
				shapeKey: '',
				geometryKey: '',
			};
			targetTiles.set( entryKey, entry );
			if ( bounds ) this._getTileIndex( target.id ).insert( entryKey, bounds, entry );

		}



		this.rebuildEntry( target.id, entryKey, { force: true } );
		return entry;

	}

	attachTile( target, scene, tile ) {

		return this.attachEntry( target, {
			key: tile,
			scene,
			visible: tile?.traversal?.visible !== false,
			data: { tile },
		} );

	}

	setEntryVisible( targetId, entryKey, visible ) {

		const entry = this._loadedTiles.get( targetId )?.get( entryKey ) || null;
		if ( ! entry ) return;

		entry.visible = visible;
		if ( entry.surfaceEntry ) entry.surfaceEntry.visible = visible;

		// meshOverlay 模式：阴影体是按 shape 维护的，不依赖 per-tile 几何。
		// tile 可见性变化只影响地形的可见性——stencil 是基于地形深度做分类的，
		// 所以地形可见时阴影体自动跟着 stencil 走，不可见时 stencil 也就不会 trigger。
		// 也就是说，这里什么都不用做。
		if ( this.meshOverlay ) return;

		if ( visible ) {

			this.rebuildEntry( targetId, entryKey, { force: true } );
			return;

		}

		for ( const meshEntry of entry.meshEntries || [] ) {

			this._applyEntryOverlayToMesh( entry, meshEntry );

		}

	}

	setTileVisible( targetId, tile, visible ) {

		this.setEntryVisible( targetId, tile, visible );

	}

	detachEntry( targetId, entryKey ) {

		const targetTiles = this._loadedTiles.get( targetId );
		const entry = targetTiles?.get( entryKey ) || null;
		if ( ! entry ) return;

		this._tileIndices.get( targetId )?.remove( entryKey );
		this._disposeTileEntry( entry );
		targetTiles.delete( entryKey );

	}

	detachTile( targetId, tile ) {

		this.detachEntry( targetId, tile );

	}

	disposeTarget( targetId ) {

		const targetTiles = this._loadedTiles.get( targetId );
		if ( targetTiles ) {

			for ( const entryKey of targetTiles.keys() ) this.detachEntry( targetId, entryKey );

		}

		this._loadedTiles.delete( targetId );
		this._tileIndices.delete( targetId );

	}

	refreshAll() {

		if ( this.meshOverlay ) {

			// 阴影体按 shape 维护，与 tile 无关。整体重建一次即可。
			this._syncMeshGroupMatrix();
			this._refreshShapeVolumes();
			return;

		}

		for ( const [ targetId, targetTiles ] of this._loadedTiles ) {

			for ( const entryKey of targetTiles.keys() ) this.rebuildEntry( targetId, entryKey, { force: true } );

		}

	}

	refreshChanges( changes ) {

		if ( this.meshOverlay ) {

			// shape 级 diff 已被 PlotEngine 捕获过；阴影体重建按 shape revision 缓存，
			// 每次都跑一遍 _refreshShapeVolumes 不会重复构建未变 shape——它会直接
			// 命中 cacheKey 跳过。
			this._syncMeshGroupMatrix();
			this._refreshShapeVolumes();
			return;

		}

		if ( ! changes || changes.length === 0 ) return;

		const dirtyTilesByTarget = new Map();
		const loadedTargetIds = Array.from( this._loadedTiles.keys() );
		for ( const change of changes ) {

			this._markDirtyTilesForCompiled( change.previous, loadedTargetIds, dirtyTilesByTarget );
			this._markDirtyTilesForCompiled( change.current, loadedTargetIds, dirtyTilesByTarget );

		}

		for ( const [ targetId, entryKeys ] of dirtyTilesByTarget ) {

			for ( const entryKey of entryKeys ) this.rebuildEntry( targetId, entryKey );

		}

	}

	// ── meshOverlay 模式（Cesium-style stencil shadow volume classification）──

	/**
	 * 帧级同步：每帧 tick 用最新 plotEngine.group.matrixWorld 重新算
	 * _meshGroup.matrix，确保阴影体顶点（世界绝对坐标）渲染时不漂移。
	 */
	syncFrame() {

		if ( ! this.meshOverlay ) return;
		if ( ! this._meshGroup ) return;
		this._syncMeshGroupMatrix();

	}

	/**
	 * 同步 `_meshGroup` 的世界矩阵到 identity：让里面的 mesh 顶点直接当作
	 * 世界绝对坐标使用，不必每帧给每个顶点做反变换。
	 *
	 * `_meshGroup` 是 `plotEngine.group` 的子节点；如果 `plotEngine.group`
	 * 自己有非单位变换（例如本项目里被 `syncWorldGroupToLocalTarget` 同步到
	 * localTarget），那么子节点的 matrix 设为 parent.matrixWorld^-1，
	 * 子节点的 matrixWorld = parent.matrixWorld * parent.matrixWorld^-1 = identity。
	 *
	 * 调用时机：每次 refreshAll/refreshChanges 开始时——因为本项目的 plotEngine.group
	 * 变换可能由用户在每帧动态变（例如跟踪某个 target），保险起见每帧同步一次。
	 */
	_syncMeshGroupMatrix() {

		this._ensureMeshGroup();
		if ( ! this._meshGroup ) return;

		this.engine.group.updateMatrixWorld?.( true );
		_tmpInverseMatrix.copy( this.engine.group.matrixWorld ).invert();
		this._meshGroup.matrix.copy( _tmpInverseMatrix );
		this._meshGroup.matrixAutoUpdate = false;
		this._meshGroup.updateMatrixWorld( true );

	}

	_ensureMeshGroup() {

		if ( ! this.meshOverlay ) return;
		if ( this._meshGroup ) return;
		this._meshGroup = new Group();
		this._meshGroup.name = 'PlotEngine.TiledPipe.MeshOverlay';
		this._meshGroup.matrixAutoUpdate = false;
		this.engine.group.add( this._meshGroup );

	}

	/**
	 * 把所有 surface/tiles 附着的 cartographic shape 重建成 stencil shadow volume。
	 *
	 * 缓存策略：每个 shape 一份 entry，cacheKey 由 `revision|targetId|color|opacity`
	 * 组成；shape revision 没变就跳过整个构建（包括反投影 / 三角化 / 创建材质）。
	 *
	 * 与 tile 完全无关——阴影体只依赖 polygon 自身的 cartographic 顶点和 target 的
	 * surfaceAdapter。tile 加载 / 卸载 / LOD 切换都不会触发阴影体重建。
	 */
	_refreshShapeVolumes() {

		this._ensureMeshGroup();
		if ( ! this._meshGroup ) return;

		const seenIds = new Set();
		const compiledShapes = this.engine._compiledShapes || [];

		for ( const compiled of compiledShapes ) {

			if ( this._hiddenShapeIds.has( compiled.id ) ) continue;
			const mode = compiled.attachment?.mode ?? 'world';
			if ( mode !== 'tiles' && mode !== 'surface' ) continue;

			const targetId = compiled.attachment?.targetId;
			const target = targetId != null ? this.engine.targetRegistry?.get?.( targetId ) : null;
			if ( ! target ) continue;
			const adapter = target.options?.surfaceAdapter ?? null;
			if ( ! adapter?.unprojectPosition ) continue;

			seenIds.add( compiled.id );

			const fillRgba = compiled.sdf?.style?.fill;
			const colorHex = typeof fillRgba === 'number'
				? fillRgba
				: colorValueFromRgba( fillRgba );
			const opacity = compiled.sdf?.style?.opacity ?? compiled.shape?.style?.opacity ?? 1;
			const cacheKey = `${ compiled.revision }|${ targetId ?? '' }|${ colorHex }|${ opacity }`;

			const existing = this._shapeVolumes.get( compiled.id );
			if ( existing && existing.cacheKey === cacheKey ) continue;

			if ( existing ) this._disposeShapeVolume( existing );

			const volume = this._buildShapeShadowVolume( compiled, target, adapter, colorHex, opacity );
			if ( volume ) {

				volume.cacheKey = cacheKey;
				this._meshGroup.add( volume.backMesh );
				this._meshGroup.add( volume.frontMesh );
				this._meshGroup.add( volume.colorMesh );
				this._shapeVolumes.set( compiled.id, volume );

			} else {

				this._shapeVolumes.delete( compiled.id );

			}

		}

		// 清理消失的 shape
		for ( const [ shapeId, volume ] of this._shapeVolumes ) {

			if ( seenIds.has( shapeId ) ) continue;
			this._disposeShapeVolume( volume );
			this._shapeVolumes.delete( shapeId );

		}

	}

	/**
	 * 给单个 shape 构造阴影体的三个 mesh（共享 geometry）：
	 *   - backMesh：BackSide + stencil INCR on Z-fail（renderOrder = 1）
	 *   - frontMesh：FrontSide + stencil DECR on Z-fail（renderOrder = 2）
	 *   - colorMesh：FrontSide + stencilFunc NOT_EQUAL ref=0 + 颜色（renderOrder = 3）
	 *
	 * 三个 mesh 共享一份 BufferGeometry——dispose 时只 dispose 一次。
	 *
	 * 返回 null 表示反投影失败或几何为空。
	 */
	_buildShapeShadowVolume( compiled, target, adapter, colorHex, opacity ) {

		const outline = this._makeShape2DContour( compiled );
		if ( ! outline || outline.length < 3 ) return null;

		const positions = buildShadowVolumePositions( outline, target, adapter );
		if ( ! positions || positions.length === 0 ) return null;

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
		geometry.computeBoundingBox?.();
		geometry.computeBoundingSphere?.();

		const backMaterial = makeBackStencilMaterial();
		const frontMaterial = makeFrontStencilMaterial();
		const colorMaterial = makeColorStencilMaterial( colorHex, opacity );

		const backMesh = new Mesh( geometry, backMaterial );
		backMesh.name = `PlotEngine.TiledPipe.Volume.${ compiled.id }.back`;
		backMesh.renderOrder = STENCIL_BACK_RENDER_ORDER;
		backMesh.frustumCulled = false;
		backMesh.raycast = noopRaycast;
		backMesh.userData.plotShapeId = compiled.id;

		const frontMesh = new Mesh( geometry, frontMaterial );
		frontMesh.name = `PlotEngine.TiledPipe.Volume.${ compiled.id }.front`;
		frontMesh.renderOrder = STENCIL_FRONT_RENDER_ORDER;
		frontMesh.frustumCulled = false;
		frontMesh.raycast = noopRaycast;
		frontMesh.userData.plotShapeId = compiled.id;

		const colorMesh = new Mesh( geometry, colorMaterial );
		colorMesh.name = `PlotEngine.TiledPipe.Volume.${ compiled.id }.color`;
		colorMesh.renderOrder = STENCIL_COLOR_RENDER_ORDER;
		colorMesh.frustumCulled = false;
		colorMesh.raycast = noopRaycast;
		colorMesh.userData.plotShapeId = compiled.id;

		return {
			geometry,
			backMaterial, frontMaterial, colorMaterial,
			backMesh, frontMesh, colorMesh,
		};

	}

	_disposeShapeVolume( volume ) {

		if ( ! volume ) return;
		if ( this._meshGroup ) {

			if ( volume.backMesh ) this._meshGroup.remove( volume.backMesh );
			if ( volume.frontMesh ) this._meshGroup.remove( volume.frontMesh );
			if ( volume.colorMesh ) this._meshGroup.remove( volume.colorMesh );

		}

		volume.geometry?.dispose?.();
		volume.backMaterial?.dispose?.();
		volume.frontMaterial?.dispose?.();
		volume.colorMaterial?.dispose?.();

	}

	/**
	 * 取 cartographic shape 的"二维投影点列"（即多边形外轮廓在 lon/lat 平面）。
	 * 不同 kind 会有不同的细分策略：圆/扇形按角度采样保证边缘平滑，
	 * 多边形/矩形/箭头直接给出顶点链，line/polyline 同样保留所有顶点。
	 */
	_makeShape2DContour( compiled ) {

		const kind = compiled.kind;
		const coords = compiled.shape.coordinates || [];

		if ( kind === 'rectangle' ) {

			const bounds = compiled.bounds;
			if ( ! bounds ) return null;
			return [
				[ bounds[ 0 ], bounds[ 1 ] ],
				[ bounds[ 2 ], bounds[ 1 ] ],
				[ bounds[ 2 ], bounds[ 3 ] ],
				[ bounds[ 0 ], bounds[ 3 ] ],
			];

		}

		if ( kind === 'circle' || kind === 'sector' ) {

			const center = coords[ 0 ];
			if ( ! center ) return null;
			const radius = compiled.shape.style?.radius ?? 1;
			const start = kind === 'sector' ? compiled.shape.style?.startAngle ?? 0 : 0;
			const angle = kind === 'sector' ? compiled.shape.style?.sectorAngle ?? Math.PI * 0.5 : Math.PI * 2;
			const points = kind === 'sector' ? [ [ center[ 0 ], center[ 1 ] ] ] : [];
			const segments = 64;
			for ( let index = 0; index <= segments; index ++ ) {

				const theta = start + angle * index / segments;
				points.push( [
					center[ 0 ] + Math.cos( theta ) * radius,
					center[ 1 ] + Math.sin( theta ) * radius,
				] );

			}

			return points;

		}

		if ( kind === 'polygon' || kind === 'rectangle' || kind === 'arrow' ) {

			return coords.map( point => [ point[ 0 ], point[ 1 ] ] );

		}

		// 军标箭头家族：编译器输出的 primitives[0].points 是多边形外轮廓
		if (
			kind === 'arrow-fine' ||
			kind === 'arrow-swallowtail' ||
			kind === 'arrow-curved' ||
			kind === 'arrow-attack' ||
			kind === 'arrow-tailed-attack' ||
			kind === 'arrow-double' ||
			kind === 'gathering-place'
		) {

			const polygonPrim = ( compiled.primitives || [] ).find( prim => prim.kind === 'polygon' );
			if ( polygonPrim?.points ) {

				return polygonPrim.points.map( point => [ point[ 0 ], point[ 1 ] ] );

			}

			return coords.map( point => [ point[ 0 ], point[ 1 ] ] );

		}

		if ( kind === 'line' || kind === 'polyline' || kind === 'point' ) {

			return null; // 这些 kind 不构成多边形 fill；走单独路径

		}

		// thick line / dashed / flow → null（走 line 路径）
		if ( kind === 'line-thick' || kind === 'line-dashed' || kind === 'line-flow' ) {

			return null;

		}

		// 文本 / 图标：不参与 tile-attached fill，走单独路径
		if ( kind === 'text-label' || kind === 'text-leader' || kind === 'icon' || kind === 'milsymbol' ) {

			return null;

		}

		return coords.map( point => [ point[ 0 ], point[ 1 ] ] );

	}

	rebuildEntry( targetId, entryKey, options = {} ) {

		const entry = this._loadedTiles.get( targetId )?.get( entryKey ) || null;
		if ( ! entry ) return null;

		// meshOverlay 模式：tile 不参与 shape 的形状构建，直接清掉 texture overlay
		// 残留即可。阴影体由 _refreshShapeVolumes 按 shape 维度统一管理。
		if ( this.meshOverlay ) {

			this._clearTileOverlay( entry );
			return entry;

		}

		const bounds = this._getEntryBounds( entry.target, entry.surfaceEntry );
		if ( ! bounds ) {


			this._tileIndices.get( targetId )?.remove( entryKey );
			entry.bounds = null;
			entry.shapeKey = '';
			entry.geometryKey = '';
			entry.textureMode = 'vector';
			this._clearTileOverlay( entry );
			return entry;

		}

		const boundsChanged = ! sameBounds( entry.bounds, bounds );
		if ( boundsChanged ) this._updateTileBounds( targetId, entry, bounds );

		const compiledShapes = this.engine
			._queryCompiledForTarget( targetId, entry.bounds, [ 'tiles', 'surface' ] )
			.filter( compiled => ! this._hiddenShapeIds.has( compiled.id ) );
		if ( compiledShapes.length === 0 ) {


			entry.shapeKey = '';
			entry.textureMode = 'vector';
			this._clearTileOverlay( entry );
			return entry;

		}

		const heightOffset = getDecalHeightOffset( compiledShapes, this.heightOffset );
		const geometryChanged = this._ensureTileGeometry( entry, heightOffset );
		const nextShapeKey = getTileShapeKey( compiledShapes );
		const textureDirty =
			options.force === true ||
			entry.texture === null ||
			entry.shapeKey !== nextShapeKey;

		if ( textureDirty ) {

			if ( entry.texture ) disposeEntryTexture( entry.texture );
			entry.texture = this._buildTileTexture( compiledShapes, entry.bounds );
			entry.textureMode = entry.texture?.userData?.mode ?? 'vector';

		}

		entry.shapeKey = nextShapeKey;
		for ( const meshEntry of this._ensureMeshEntries( entry ) ) {

			this._ensureWrappedMaterials( meshEntry );
			this._applyEntryOverlayToMesh( entry, meshEntry );

		}

		return entry;

	}

	_buildTileTexture( compiledShapes, bounds ) {

		if ( this.rasterize && canBuildRasterPlotTexture() ) {

			const rasterTexture = buildRasterPlotTexture( compiledShapes, bounds, {
				size: this.rasterTextureSize,
			} );
			if ( rasterTexture ) return rasterTexture;

		}

		const texture = buildSdfTexture( compiledShapes );
		texture.userData.mode = 'vector';
		return texture;

	}

	rebuildTile( targetId, tile, options = {} ) {

		return this.rebuildEntry( targetId, tile, options );

	}

	_getEntryBounds( target, surfaceEntry ) {

		if ( ! surfaceEntry?.scene ) return null;

		const adapter = getSurfaceAdapter( target );
		const adapterBounds = adapter?.getEntryBounds?.( surfaceEntry, target );
		if ( adapterBounds ) {


			return adapterBounds;

		}

		const legacyEntryKey = surfaceEntry.data?.tile ?? surfaceEntry.key;
		const customBounds = target.options.getTileBounds?.( legacyEntryKey, surfaceEntry.scene, target );
		if ( customBounds ) {


			return customBounds;

		}

		target?.source?.group?.updateMatrixWorld?.( true );
		target?.tilesRenderer?.group?.updateMatrixWorld?.( true );
		surfaceEntry.scene.updateMatrixWorld?.( true );
		_box.setFromObject( surfaceEntry.scene );
		if ( _box.isEmpty() ) return null;
		_box.getSize( _size );
		if ( _size.x === 0 && _size.z === 0 ) return null;
		const fallbackBounds = [ _box.min.x, _box.min.z, _box.max.x, _box.max.z ];

		return fallbackBounds;

	}

	_createProjectedGeometry( baseGeometry, mesh, entry, bounds, heightOffset = 0 ) {

		const geometry = baseGeometry.clone();
		const position = geometry.getAttribute( 'position' );
		if ( ! position ) return geometry;

		const uv = new Float32Array( position.count * 2 );
		const spanX = Math.max( bounds[ 2 ] - bounds[ 0 ], 1e-12 );
		const spanY = Math.max( bounds[ 3 ] - bounds[ 1 ], 1e-12 );
		const adapter = getSurfaceAdapter( entry.target );

		let hasProjectedPoint = false;
		let projectedPointCount = 0;
		if ( adapter?.projectPosition ) {

			entry.target?.source?.group?.updateMatrixWorld?.( true );
			entry.target?.tilesRenderer?.group?.updateMatrixWorld?.( true );
			entry.scene?.updateMatrixWorld?.( true );
			mesh.updateMatrixWorld?.( true );
			for ( let index = 0; index < position.count; index ++ ) {

				_position.fromBufferAttribute( position, index ).applyMatrix4( mesh.matrixWorld );
				const projected = adapter.projectPosition( _position, entry.surfaceEntry, entry.target, _projectedPosition );
				if ( ! projected ) {

					uv[ index * 2 + 0 ] = 0;
					uv[ index * 2 + 1 ] = 0;
					continue;

				}

				hasProjectedPoint = true;
				projectedPointCount ++;
				uv[ index * 2 + 0 ] = ( projected[ 0 ] - bounds[ 0 ] ) / spanX;
				uv[ index * 2 + 1 ] = ( projected[ 1 ] - bounds[ 1 ] ) / spanY;

			}

		}

		const positionChanged = hasProjectedPoint
			? false
			: applyPlanarFallbackGeometry( geometry, position, uv, heightOffset );



		geometry.setAttribute( 'plotUv', new Float32BufferAttribute( uv, 2 ) );
		if ( positionChanged ) {

			position.needsUpdate = true;
			geometry.computeBoundingBox?.();
			geometry.computeBoundingSphere?.();

		}

		return geometry;

	}

	_markDirtyTilesForCompiled( compiled, loadedTargetIds, dirtyTilesByTarget ) {

		if ( ! compiled?.bounds ) return;

		const targetIds = getProjectedAttachmentTargetIds( compiled, loadedTargetIds );

		for ( const targetId of targetIds ) {

			const tileIndex = this._tileIndices.get( targetId );
			if ( ! tileIndex ) {


				continue;

			}

			let dirtyTiles = dirtyTilesByTarget.get( targetId );
			if ( ! dirtyTiles ) {

				dirtyTiles = new Set();
				dirtyTilesByTarget.set( targetId, dirtyTiles );

			}

			const matchedEntries = tileIndex.search( compiled.bounds );

			for ( const entry of matchedEntries ) {

				dirtyTiles.add( entry.tile );

			}

		}

	}

	_rebuildTilesForShape( shapeId ) {

		const compiled = this.engine._compiledShapeMap?.get?.( shapeId ) || null;
		if ( ! compiled ) {

			this.refreshAll();
			return;

		}

		const dirtyTilesByTarget = new Map();
		this._markDirtyTilesForCompiled( compiled, Array.from( this._loadedTiles.keys() ), dirtyTilesByTarget );
		for ( const [ targetId, entryKeys ] of dirtyTilesByTarget ) {

			for ( const entryKey of entryKeys ) this.rebuildEntry( targetId, entryKey, { force: true } );

		}

	}

	_ensureMeshEntries( entry ) {

		if ( entry.meshEntries ) return entry.meshEntries;

		const meshEntries = [];
		entry.scene.traverse?.( child => {

			if ( ! child.isMesh || ! child.geometry || child.isPoints ) return;
			meshEntries.push( {
				sourceMesh: child,
				originalGeometry: child.geometry,
				originalMaterial: child.material,
				overlayMaterial: null,
				ownsOverlayMaterial: false,
				geometry: null,
				geometryKey: '',
			} );

		} );



		entry.meshEntries = meshEntries;
		return meshEntries;

	}

	_ensureTileGeometry( entry, heightOffset ) {

		const geometryKey = `${ entry.bounds.join( ',' ) }|${ heightOffset }`;
		if ( entry.geometryKey === geometryKey ) return false;

		for ( const meshEntry of this._ensureMeshEntries( entry ) ) {

			const baseGeometry = meshEntry.originalGeometry ?? meshEntry.sourceMesh.geometry;
			const nextGeometry = this._createProjectedGeometry(
				baseGeometry,
				meshEntry.sourceMesh,
				entry,
				entry.bounds,
				heightOffset,
			);

			if ( meshEntry.geometry && meshEntry.geometry !== meshEntry.originalGeometry ) {

				meshEntry.geometry.dispose();

			}

			meshEntry.geometry = nextGeometry;
			meshEntry.geometryKey = geometryKey;
			meshEntry.sourceMesh.geometry = nextGeometry;

		}

		entry.geometryKey = geometryKey;
		return true;

	}

	_ensureWrappedMaterials( meshEntry ) {

		if ( meshEntry.overlayMaterial ) return meshEntry.overlayMaterial;

		const originalMaterial = meshEntry.originalMaterial ?? meshEntry.sourceMesh.material;
		meshEntry.overlayMaterial = Array.isArray( originalMaterial )
			? originalMaterial.map( cloneOverlayMaterial )
			: cloneOverlayMaterial( originalMaterial );
		meshEntry.ownsOverlayMaterial = false;
		meshEntry.sourceMesh.material = meshEntry.overlayMaterial;



		return meshEntry.overlayMaterial;

	}

	_applyEntryOverlayToMesh( entry, meshEntry ) {

		const opacity = entry.visible && entry.texture ? this.opacity : 0;
		const applyMaterial = material => {

			updateWrappedTiledSdfMaterial( material, entry.texture, entry.bounds, opacity, entry.textureMode );

		};

		if ( Array.isArray( meshEntry.overlayMaterial ) ) {

			meshEntry.overlayMaterial.forEach( applyMaterial );

		} else if ( meshEntry.overlayMaterial ) {

			applyMaterial( meshEntry.overlayMaterial );

		}



	}

	_clearTileOverlay( entry ) {

		if ( entry.texture ) {

			disposeEntryTexture( entry.texture );
			entry.texture = null;

		}

		for ( const meshEntry of entry.meshEntries || [] ) {

			if ( Array.isArray( meshEntry.overlayMaterial ) ) {

				meshEntry.overlayMaterial.forEach( clearWrappedTiledSdfMaterial );

			} else if ( meshEntry.overlayMaterial ) {

				clearWrappedTiledSdfMaterial( meshEntry.overlayMaterial );

			}

		}

	}

	_disposeTileEntry( entry ) {

		this._clearTileOverlay( entry );

		for ( const meshEntry of entry.meshEntries || [] ) {

			if ( meshEntry.sourceMesh && meshEntry.originalGeometry ) {

				meshEntry.sourceMesh.geometry = meshEntry.originalGeometry;

			}

			if ( meshEntry.sourceMesh && meshEntry.originalMaterial ) {

				meshEntry.sourceMesh.material = meshEntry.originalMaterial;

			}

			if ( Array.isArray( meshEntry.overlayMaterial ) ) {

				meshEntry.overlayMaterial.forEach( material => disposeOverlayMaterial( material, meshEntry.ownsOverlayMaterial ) );

			} else if ( meshEntry.overlayMaterial ) {

				disposeOverlayMaterial( meshEntry.overlayMaterial, meshEntry.ownsOverlayMaterial );

			}

			meshEntry.overlayMaterial = null;
			meshEntry.ownsOverlayMaterial = false;

			if ( meshEntry.geometry && meshEntry.geometry !== meshEntry.originalGeometry ) {

				meshEntry.geometry.dispose();

			}

			meshEntry.geometry = null;

		}

		entry.meshEntries = null;
		entry.geometryKey = '';
		entry.shapeKey = '';
		entry.textureMode = 'vector';

	}

	_updateTileBounds( targetId, entry, bounds ) {

		entry.bounds = cloneBounds( bounds );
		this._getTileIndex( targetId ).update( entry.tile, entry.bounds, entry );
		entry.shapeKey = '';
		entry.geometryKey = '';

	}

	_getTileIndex( targetId ) {

		let tileIndex = this._tileIndices.get( targetId );
		if ( ! tileIndex ) {

			tileIndex = new SpatialIndex();
			this._tileIndices.set( targetId, tileIndex );

		}

		return tileIndex;

	}

	_ensureTargetMap( root, targetId ) {

		let map = root.get( targetId );
		if ( ! map ) {

			map = new Map();
			root.set( targetId, map );

		}

		return map;

	}

}
