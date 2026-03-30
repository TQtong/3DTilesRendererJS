/**
 * StencilVolume.js — 模板体积渲染工具
 *
 * 实现 Stencil Shadow Volume 技术，用于可靠地标识地形表面上的像素。
 * 原理：
 *   1. 为每个图形创建一个上下延伸的包围体（穿过地形）
 *   2. 渲染包围体的背面：当深度测试失败（被地形遮挡）→ 模板 +1
 *   3. 渲染包围体的正面：当深度测试失败（被地形遮挡）→ 模板 -1
 *   4. 模板值 != 0 的像素 = 地形表面在包围体内部
 *
 * 此方法完全不依赖深度缓冲重建，从根本上消除了倾斜视角下的裁剪问题。
 *
 * 参考：
 *   - Re:Earth: https://reearth.engineering/posts/drape-polygon-on-terrain-en/
 *   - Cesium GroundPrimitive (ClassificationType)
 *   - "Rendering 3D Vector Data Using the Theory of Stencil Shadow Volumes" (ISPRS 2008)
 */

import {
	BufferGeometry,
	Float32BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	Scene,
	Vector3,
	FrontSide,
	BackSide,
	AlwaysStencilFunc,
	NotEqualStencilFunc,
	KeepStencilOp,
	IncrementWrapStencilOp,
	DecrementWrapStencilOp,
	ZeroStencilOp,
} from 'three';
import { DEG2RAD } from './coordUtils.js';

/** 包围体上下延伸高度（米），需大于地形最大高程差 */
const EXTRUDE_HEIGHT = 50000;

const _pos = new Vector3();
const _east = new Vector3();
const _north = new Vector3();
const _up = new Vector3();

/**
 * 从图形的 extent 点生成包围体 Mesh。
 * 包围体是一个矩形棱柱，上下延伸 ±EXTRUDE_HEIGHT 米，覆盖图形的地理范围。
 *
 * @param {Array<[number, number]>} extentPoints - 图形的地理范围点 [[lon, lat], ...]
 * @param {number} padding - 额外填充（米），用于覆盖 strokeWidth
 * @param {object} ellipsoid - 椭球体
 * @param {Matrix4} groupMatrix - tilesGroup.matrixWorld（ECEF → 场景坐标变换）
 * @returns {Mesh} 包围体 Mesh
 */
export function buildBoundingVolume( extentPoints, padding, ellipsoid, groupMatrix ) {

	if ( extentPoints.length === 0 ) return null;

	let lonMin = Infinity, lonMax = - Infinity;
	let latMin = Infinity, latMax = - Infinity;
	for ( const [ lon, lat ] of extentPoints ) {

		if ( lon < lonMin ) lonMin = lon;
		if ( lon > lonMax ) lonMax = lon;
		if ( lat < latMin ) latMin = lat;
		if ( lat > latMax ) latMax = lat;

	}

	// 填充：将米制 padding 转换为经纬度偏移
	const midLat = ( latMin + latMax ) / 2;
	const dLon = padding / ( 111320 * Math.cos( midLat * DEG2RAD ) );
	const dLat = padding / 111320;
	lonMin -= dLon; lonMax += dLon;
	latMin -= dLat; latMax += dLat;

	// 4 个角点
	const corners = [
		[ lonMin, latMin ],
		[ lonMax, latMin ],
		[ lonMax, latMax ],
		[ lonMin, latMax ],
	];

	// 转换为 ECEF + up 向量，生成上下各 4 个顶点（共 8 个）
	const positions = new Float32Array( 8 * 3 );
	for ( let i = 0; i < 4; i ++ ) {

		const [ lon, lat ] = corners[ i ];
		ellipsoid.getCartographicToPosition( lat * DEG2RAD, lon * DEG2RAD, 0, _pos );
		ellipsoid.getEastNorthUpAxes( lat * DEG2RAD, lon * DEG2RAD, _east, _north, _up );

		// 上顶点（ECEF + up * height）→ 场景坐标
		_pos.x += _up.x * EXTRUDE_HEIGHT;
		_pos.y += _up.y * EXTRUDE_HEIGHT;
		_pos.z += _up.z * EXTRUDE_HEIGHT;
		_pos.applyMatrix4( groupMatrix );
		positions[ i * 3 ] = _pos.x;
		positions[ i * 3 + 1 ] = _pos.y;
		positions[ i * 3 + 2 ] = _pos.z;

		// 下顶点
		ellipsoid.getCartographicToPosition( lat * DEG2RAD, lon * DEG2RAD, 0, _pos );
		_pos.x -= _up.x * EXTRUDE_HEIGHT;
		_pos.y -= _up.y * EXTRUDE_HEIGHT;
		_pos.z -= _up.z * EXTRUDE_HEIGHT;
		_pos.applyMatrix4( groupMatrix );
		positions[ ( 4 + i ) * 3 ] = _pos.x;
		positions[ ( 4 + i ) * 3 + 1 ] = _pos.y;
		positions[ ( 4 + i ) * 3 + 2 ] = _pos.z;

	}

	// 12 个三角形（6 个面 × 2 三角形）构成密封棱柱
	// 顶面: 0-1-2, 0-2-3 | 底面: 4-6-5, 4-7-6 (反转绕序)
	// 侧面: 4 个矩形
	const indices = [
		0, 1, 2, 0, 2, 3,
		4, 6, 5, 4, 7, 6,
		0, 4, 5, 0, 5, 1,
		1, 5, 6, 1, 6, 2,
		2, 6, 7, 2, 7, 3,
		3, 7, 4, 3, 4, 0,
	];

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	geometry.setIndex( indices );

	const mesh = new Mesh( geometry, new MeshBasicMaterial() );
	mesh.frustumCulled = false;
	return mesh;

}

/**
 * 执行模板体积的两个写入 pass（背面增 + 正面减）。
 * 调用后，模板缓冲中 != 0 的像素对应地形表面在包围体内的区域。
 *
 * @param {WebGLRenderer} renderer
 * @param {Mesh} volumeMesh - 包围体 Mesh
 * @param {Scene} stencilScene - 临时场景
 * @param {Camera} camera
 */
export function writeStencil( renderer, volumeMesh, stencilScene, camera ) {

	const m = volumeMesh.material;

	stencilScene.add( volumeMesh );

	// Pass 1: 背面 — 深度测试失败时 +1（背面被地形遮挡 = 地形在包围体前方）
	m.stencilFunc = AlwaysStencilFunc;
	m.stencilFail = KeepStencilOp;
	m.stencilZPass = KeepStencilOp;
	m.stencilZFail = IncrementWrapStencilOp;
	m.side = BackSide;
	m.colorWrite = false;
	m.depthWrite = false;
	m.stencilWrite = true;
	m.depthTest = true;
	renderer.render( stencilScene, camera );

	// Pass 2: 正面 — 深度测试失败时 -1（正面被地形遮挡 = 地形在包围体后方）
	m.stencilZFail = DecrementWrapStencilOp;
	m.side = FrontSide;
	renderer.render( stencilScene, camera );

	// 清理
	m.stencilWrite = false;
	m.colorWrite = false;
	m.depthTest = false;
	stencilScene.remove( volumeMesh );

}
