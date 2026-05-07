export { PlotEngine } from './PlotEngine.js';
export { CompilerRegistry } from './CompilerRegistry.js';
export { buildSdfData, buildSdfTexture, unpackSdfData } from './SdfDataBuilder.js';
export { ShapeStore } from './ShapeStore.js';
export { SpatialIndex } from './SpatialIndex.js';
export { TargetRegistry } from './TargetRegistry.js';
export { createTilesRendererTargetAdapter } from './adapters/createTilesRendererTargetAdapter.js';
export { TiledPipe } from './pipes/TiledPipe.js';
export { SurfacePipe } from './pipes/SurfacePipe.js';
export { WorldPipe } from './pipes/WorldPipe.js';

// Editor 层（PlotEngine 之上的可选编辑能力）
export { PlotEditor } from './editor/PlotEditor.js';
export { EditorHistory } from './editor/EditorHistory.js';
export { BaseCommand, cloneCoordinates, cloneStyle } from './editor/commands/BaseCommand.js';
export { UpdateCoordinatesCommand } from './editor/commands/UpdateCoordinatesCommand.js';
export { InsertVertexCommand } from './editor/commands/InsertVertexCommand.js';
export { RemoveVertexCommand } from './editor/commands/RemoveVertexCommand.js';
export { TranslateShapeCommand } from './editor/commands/TranslateShapeCommand.js';
export { BatchCommand } from './editor/commands/BatchCommand.js';
export { EditSession } from './editor/EditSession.js';
export { HandleLayer } from './editor/HandleLayer.js';
export { DragController } from './editor/DragController.js';
export {
	getShapeEditAdapter,
	registerShapeEditAdapter,
	HANDLE_VERTEX,
	HANDLE_MIDPOINT,
	HANDLE_CENTER,
	HANDLE_RADIUS,
	HANDLE_ANGLE,
	HANDLE_WIDTH,
} from './editor/ShapeEditAdapters.js';
