/**
 * coordUtils.js — 坐标转换工具与共享常量
 *
 * 提供经纬度 ↔ ENU（East-North-Up）局部切面坐标（米制）的转换功能。
 * 每个图形使用自己的 ENU 中心，lonLatToMeters 接收该图形的 ENU 参数。
 */

import { Vector3, MathUtils } from 'three';

/** 角度 → 弧度 转换因子 */
export const DEG2RAD = MathUtils.DEG2RAD;

/**
 * 标签 atlas 画布尺寸（像素）。
 * 所有文字标签预渲染到一张 LABEL_ATLAS × LABEL_ATLAS 的 canvas 上，
 * 然后上传为 CanvasTexture 供 shader 采样。
 */
export const LABEL_ATLAS = 2048;

/** 复用的临时 Vector3，避免每次调用 lonLatToMeters 时创建新对象 */
const _pos = new Vector3();

/**
 * 将经纬度坐标转换为 ENU 局部切面坐标（米制）。
 *
 * 算法流程：
 *   1. (lon, lat) → ECEF 笛卡尔坐标（通过椭球体参数化）
 *   2. ECEF 减去参考中心点的 ECEF 坐标，得到偏移向量
 *   3. 偏移向量分别投影到 East 和 North 轴，得到局部米制坐标 (e, n)
 *
 * @param {number} lonDeg - 经度（度）
 * @param {number} latDeg - 纬度（度）
 * @param {number} centerLonRad - ENU 参考中心的经度（弧度）
 * @param {number} centerLatRad - ENU 参考中心的纬度（弧度）
 * @param {object} ellipsoid - 椭球体对象（提供 getCartographicToPosition 方法）
 * @param {Vector3} east - ENU 东向单位向量（ECEF 空间）
 * @param {Vector3} north - ENU 北向单位向量（ECEF 空间）
 * @param {Vector3} centerECEF - ENU 参考中心的 ECEF 坐标
 * @returns {{e: number, n: number}} 局部 ENU 坐标（米）
 */
export function lonLatToMeters( lonDeg, latDeg, centerLonRad, centerLatRad, ellipsoid, east, north, centerECEF ) {

	ellipsoid.getCartographicToPosition( latDeg * DEG2RAD, lonDeg * DEG2RAD, 0, _pos );
	const dx = _pos.x - centerECEF.x;
	const dy = _pos.y - centerECEF.y;
	const dz = _pos.z - centerECEF.z;
	return {
		e: dx * east.x + dy * east.y + dz * east.z,
		n: dx * north.x + dy * north.y + dz * north.z,
	};

}
