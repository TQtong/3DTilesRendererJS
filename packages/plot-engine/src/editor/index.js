// ============================================================
// editor/index.js — PlotEditor 公开 API 出口
// 层级：编辑层（位于 PlotEngine 之上）
// 职责：聚合并对外导出 PlotEditor 类、各 Command 类、辅助构造函数
// 依赖：./PlotEditor.js、./EditorHistory.js、./commands/*
// 被消费：plotEngine.html / plotEngine.js / 用户业务代码
// ============================================================

export { PlotEditor } from './PlotEditor.js';
export { EditorHistory } from './EditorHistory.js';
export { BaseCommand, cloneCoordinates, cloneStyle } from './commands/BaseCommand.js';
export { UpdateCoordinatesCommand } from './commands/UpdateCoordinatesCommand.js';
export { InsertVertexCommand } from './commands/InsertVertexCommand.js';
export { RemoveVertexCommand } from './commands/RemoveVertexCommand.js';
export { TranslateShapeCommand } from './commands/TranslateShapeCommand.js';
export { BatchCommand } from './commands/BatchCommand.js';
export { EditSession } from './EditSession.js';
export { HandleLayer } from './HandleLayer.js';
export { DragController } from './DragController.js';
export {
	getShapeEditAdapter,
	registerShapeEditAdapter,
	HANDLE_VERTEX,
	HANDLE_MIDPOINT,
	HANDLE_CENTER,
	HANDLE_RADIUS,
	HANDLE_ANGLE,
	HANDLE_WIDTH,
} from './ShapeEditAdapters.js';
