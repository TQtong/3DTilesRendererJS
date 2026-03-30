/**
 * plot/index.js — 标绘模块统一导出入口
 *
 * 模块结构：
 *   plot/
 *   ├── index.js              ← 统一导出（本文件）
 *   ├── GroundDecalManager.js  ← 标绘管理器 + GPU 渲染器
 *   ├── PlotBase.js            ← 标绘基类（GisPlotBase）
 *   ├── PlotPoint.js           ← 点标绘（PlotPointOptions）
 *   ├── PlotLine.js            ← 折线标绘（PlotLineOptions）
 *   ├── PlotPolygon.js         ← 多边形标绘（PlotPolygonOptions）
 *   ├── PlotRectangle.js       ← 矩形标绘（PlotRectangleOptions）
 *   ├── PlotCircle.js          ← 圆标绘（扩展类型）
 *   ├── PlotSector.js          ← 扇形标绘（PlotSectorOptions）
 *   ├── PlotLabel.js           ← 文本标绘（PlotTextOptions）
 *   ├── PlotArrow.js           ← 箭头标绘（PlotArrowOptions）
 *   ├── StencilVolume.js        ← 模板体积渲染（地形贴合）
 *   ├── shaders.js             ← GLSL 着色器
 *   ├── colorUtils.js          ← 颜色解析
 *   ├── coordUtils.js          ← 坐标转换
 *   └── ArrowUtils.js          ← 箭头几何生成
 */

export { GroundDecalManager } from './GroundDecalManager.js';

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
export { lonLatToMeters, DEG2RAD, LABEL_ATLAS } from './coordUtils.js';
