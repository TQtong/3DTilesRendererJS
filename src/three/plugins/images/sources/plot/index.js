/**
 * 标绘模块导出（矢量图元 + RTT 叠加 + SDF 着色器）。
 *
 * `GroundDecalManager` 留在示例目录 `example/three/plot/GroundDecalManager.js`，由页面直接引用；
 * 本包通过 `um-3d-tiles-renderer/three/plugins` 导出下列符号供其与其它代码使用。
 */

export { PlotOverlay } from './PlotOverlay.js';
export { PlotImageSource } from './PlotImageSource.js';
export { TILE_SDF_VERTEX, TILE_SDF_FRAGMENT } from './TileSdfShader.js';

export { PlotBase } from './PlotBase.js';
export { PlotPoint } from './PlotPoint.js';
export { PlotLine } from './PlotLine.js';
export { PlotPolygon } from './PlotPolygon.js';
export { PlotRectangle } from './PlotRectangle.js';
export { PlotCircle } from './PlotCircle.js';
export { PlotSector } from './PlotSector.js';
export { PlotLabel } from './PlotLabel.js';
export { PlotArrow } from './PlotArrow.js';

export {
	createFineArrow,
	createCurvedArrow,
	createAttackArrow,
	createStraightArrow,
} from './ArrowUtils.js';

export { parseColorToRGBA, resolveOpacity } from './colorUtils.js';
export { DEG2RAD, LABEL_ATLAS } from './coordUtils.js';
