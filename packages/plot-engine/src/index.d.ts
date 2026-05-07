import type { Group, Object3D } from 'three';

export type PlotCoordinate = [ number, number ] | [ number, number, number ];

export interface GeoReference {
	kind: 'cartographic' | 'placed-cartographic' | 'local';
}

export interface Attachment {
	mode: 'world' | 'surface' | 'tiles';
	targetId?: string | number;
	fallbackTargetId?: string | number;
}

export interface PlotShape {
	id?: string | number;
	kind: string;
	coordinates: PlotCoordinate[];
	style?: Record<string, any>;
	attachment?: Attachment;
	userData?: Record<string, any>;
	revision?: number;
}

export interface PlotTargetOptions {
	geoReference?: GeoReference;
	getTileBounds?: ( tile: any, scene: Object3D, target: any ) => [ number, number, number, number ] | null;
	surfaceAdapter?: SurfaceTargetAdapter;
}

export interface SurfaceTargetEntry {
	key: any;
	scene: Object3D;
	visible?: boolean;
	data?: Record<string, any>;
}

export interface SurfaceTargetCallbacks {
	onEntryLoad?: ( entry: SurfaceTargetEntry ) => void;
	onEntryDispose?: ( entryOrKey: any ) => void;
	onEntryVisibilityChange?: ( entryOrKey: any, visible: boolean ) => void;
}

export interface SurfaceTargetAdapter {
	connect?: ( source: any, callbacks: SurfaceTargetCallbacks, target?: PlotTarget ) => void | ( () => void ) | { disconnect?: () => void };
	forEachEntry?: ( source: any, callback: ( entry: SurfaceTargetEntry ) => void, target?: PlotTarget ) => void;
	getEntryBounds?: ( entry: SurfaceTargetEntry, target: PlotTarget ) => [ number, number, number, number ] | null;
	projectPosition?: ( position: any, entry: SurfaceTargetEntry, target: PlotTarget, out?: number[] ) => number[] | null;
}

export interface SurfacePlotTarget {
	id: string | number;
	type: 'surface-target';
	source: any;
	options: PlotTargetOptions;
}

export interface TilesRendererTarget {
	id: string | number;
	type: 'tiles-renderer';
	source: any;
	tilesRenderer: any;
	options: PlotTargetOptions;
}

export interface ObjectPlotTarget {
	id: string | number;
	type: 'object';
	object3D: Object3D;
	options: PlotTargetOptions;
}

export type PlotTarget = TilesRendererTarget | ObjectPlotTarget | SurfacePlotTarget;

export class ShapeStore {
	get size(): number;
	get revision(): number;
	add( shape: PlotShape ): PlotShape;
	update( id: string | number, patch: Partial<PlotShape> ): PlotShape;
	remove( id: string | number ): boolean;
	clear(): void;
	get( id: string | number ): PlotShape | null;
	has( id: string | number ): boolean;
	values(): PlotShape[];
	entries(): Array<[ string | number, PlotShape ]>;
}

export class CompilerRegistry {
	register( kind: string, compiler: ( shape: PlotShape, registry: CompilerRegistry ) => any ): this;
	unregister( kind: string ): boolean;
	has( kind: string ): boolean;
	compile( shape: PlotShape ): any;
	compileMany( shapes: PlotShape[] ): any[];
}

export class SpatialIndex {
	get size(): number;
	clear(): void;
	load( entries: Array<{ id: string | number; bounds: [ number, number, number, number ] }> ): void;
	insert( id: string | number, bounds: [ number, number, number, number ], data?: any ): any;
	update( id: string | number, bounds: [ number, number, number, number ], data?: any ): any;
	remove( id: string | number ): boolean;
	search( bounds: [ number, number, number, number ] ): any[];
	all(): any[];
}

export class TargetRegistry {
	get size(): number;
	attachTilesRenderer( id: string | number, tilesRenderer: any, options?: PlotTargetOptions ): TilesRendererTarget;
	attachSurfaceTarget( id: string | number, source: any, options?: PlotTargetOptions ): SurfacePlotTarget;
	attachObjectTarget( id: string | number, object3D: Object3D, options?: PlotTargetOptions ): ObjectPlotTarget;
	detach( id: string | number ): PlotTarget | null;
	get( id: string | number ): PlotTarget | null;
	has( id: string | number ): boolean;
	findByTilesRenderer( tilesRenderer: any ): TilesRendererTarget | null;
	hasTilesRenderer( tilesRenderer: any ): boolean;
	findBySurfaceTarget( source: any ): SurfacePlotTarget | TilesRendererTarget | null;
	hasSurfaceTarget( source: any ): boolean;
	findByObjectTarget( object3D: Object3D ): ObjectPlotTarget | null;
	hasObjectTarget( object3D: Object3D ): boolean;
	values(): PlotTarget[];
	clear(): PlotTarget[];
}

export function buildSdfData( compiledShapes: any[] ): Float32Array;
export function buildSdfTexture( compiledShapes: any[] ): any;
export function unpackSdfData( data: Float32Array | number[] ): any[];

export class PlotEngine {
	readonly group: Group;
	readonly shapeStore: ShapeStore;
	readonly compilerRegistry: CompilerRegistry;
	readonly spatialIndex: SpatialIndex;
	readonly targetRegistry: TargetRegistry;
	selection?: Array<string | number>;
	mode?: string;

	constructor( options?: Record<string, any> );
	start(): this;
	stop(): this;
	update(): this;
	invalidate(): this;
	addShape( shape: PlotShape ): PlotShape;
	updateShape( id: string | number, patch: Partial<PlotShape> ): PlotShape;
	removeShape( id: string | number ): boolean;
	clearShapes(): this;
	select( ids: string | number | Array<string | number> | null | undefined ): Array<string | number>;
	setMode( mode: string ): string;
	attachTilesRenderer( id: string | number, tilesRenderer: any, options?: PlotTargetOptions ): TilesRendererTarget;
	attachSurfaceTarget( id: string | number, source: any, options?: PlotTargetOptions ): SurfacePlotTarget;
	attachObjectTarget( id: string | number, object3D: Object3D, options?: PlotTargetOptions ): ObjectPlotTarget;
	detachTarget( id: string | number ): PlotTarget | null;
	dispose(): void;
}

export function createTilesRendererTargetAdapter(): SurfaceTargetAdapter;

// ── Editor 层（PlotEngine 之上的可选编辑能力） ──────────────

export type EditableHandleType = 'vertex' | 'midpoint' | 'center' | 'radius' | 'angle' | 'width';

export interface EditableHandle {
	id: string;
	type: EditableHandleType;
	position: PlotCoordinate;
	meta?: Record<string, any>;
}

export interface ShapeEditPatch {
	coordinates?: PlotCoordinate[];
	style?: Record<string, any>;
	insertedIndex?: number;
	removedIndex?: number;
}

export interface ShapeEditAdapter {
	kind: string;
	getEditableHandles( shape: PlotShape ): EditableHandle[];
	applyHandleDrag( shape: PlotShape, handleId: string, point: PlotCoordinate ): ShapeEditPatch | null;
	canRemoveVertex( shape: PlotShape, handleId: string ): boolean;
	removeVertex( shape: PlotShape, handleId: string ): ShapeEditPatch | null;
	getInsertableEdges( shape: PlotShape ): Array<{ id: string; insertIndex: number; a: PlotCoordinate; b: PlotCoordinate }>;
	insertVertex( shape: PlotShape, handleId: string, point: PlotCoordinate ): ShapeEditPatch | null;
	getCenter( shape: PlotShape ): PlotCoordinate;
	translate( shape: PlotShape, dx: number, dy: number ): ShapeEditPatch;
}

export const HANDLE_VERTEX: 'vertex';
export const HANDLE_MIDPOINT: 'midpoint';
export const HANDLE_CENTER: 'center';
export const HANDLE_RADIUS: 'radius';
export const HANDLE_ANGLE: 'angle';
export const HANDLE_WIDTH: 'width';

export function getShapeEditAdapter( kind: string ): ShapeEditAdapter | null;
export function registerShapeEditAdapter( kind: string, adapter: ShapeEditAdapter ): void;

export class BaseCommand {
	kind: string;
	shapeId: string | number | null;
	timestamp: number;
	do( context: any ): boolean;
	undo( context: any ): boolean;
	merge( other: BaseCommand, options?: any ): BaseCommand | null;
	toJSON(): Record<string, any>;
}

export function cloneCoordinates( coordinates: PlotCoordinate[] ): PlotCoordinate[];
export function cloneStyle( style: Record<string, any> ): Record<string, any>;

export class UpdateCoordinatesCommand extends BaseCommand {
	constructor( shapeId: string | number, beforeCoords: PlotCoordinate[], afterCoords: PlotCoordinate[], options?: { coalesceWithPrevious?: boolean; coalesceWindowMs?: number } );
	readonly beforeCoordinates: PlotCoordinate[];
	readonly afterCoordinates: PlotCoordinate[];
}

export class InsertVertexCommand extends BaseCommand {
	constructor( shapeId: string | number, insertIndex: number, point: PlotCoordinate, beforeCoords: PlotCoordinate[] );
	readonly insertedIndex: number;
	readonly insertedPoint: PlotCoordinate;
	readonly afterCoordinates: PlotCoordinate[];
}

export class RemoveVertexCommand extends BaseCommand {
	constructor( shapeId: string | number, removeIndex: number, beforeCoords: PlotCoordinate[] );
	readonly removedIndex: number;
	readonly removedPoint: PlotCoordinate | null;
}

export class TranslateShapeCommand extends BaseCommand {
	constructor( shapeId: string | number, dx: number, dy: number, dz?: number, options?: { coalesceWindowMs?: number } );
	readonly deltaX: number;
	readonly deltaY: number;
	readonly deltaZ: number;
}

export class BatchCommand extends BaseCommand {
	constructor( commands: BaseCommand[], label?: string );
	readonly commands: BaseCommand[];
	readonly label: string;
}

export interface EditorHistoryChangePayload {
	canUndo: boolean;
	canRedo: boolean;
	lastCommand: BaseCommand | null;
	undoSize: number;
	redoSize: number;
}

export class EditorHistory {
	constructor( options?: { capacity?: number; autoCoalesce?: boolean } );
	enabled: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly undoSize: number;
	readonly redoSize: number;
	setContext( context: { shapeStore: ShapeStore; plotEngine: PlotEngine; editor?: PlotEditor } ): void;
	execute( command: BaseCommand ): boolean;
	undo(): boolean;
	redo(): boolean;
	clear(): void;
	getStackSnapshot(): { undo: any[]; redo: any[] };
	addEventListener( event: 'change' | 'execute' | 'undo' | 'redo', callback: ( payload: any ) => void ): void;
	removeEventListener( event: string, callback: ( payload: any ) => void ): void;
}

export class HandleLayer {
	constructor( options?: { sizeScale?: number; maxInstances?: number } );
	readonly group: Group;
	setSizeScale( scale: number ): void;
	updateHandles( handles: EditableHandle[] ): void;
	updateOutline( kind: string, shape: PlotShape ): void;
	setHovered( target: { type: string; instanceId: number } | null ): void;
	resolveHit( hitMesh: any, instanceId: number ): { type: string; handleId: string; instanceId: number } | null;
	getRaycastTargets(): any[];
	dispose(): void;
}

export class DragController {
	constructor( options: {
		domElement: HTMLElement;
		camera: any;
		workingFrame: any;
		callbacks: {
			onHandleHover?: ( handle: any ) => void;
			onDragStart?: ( handle: any, kind: string ) => void;
			onDragMove?: ( handle: any, localPoint: number[] ) => void;
			onDragEnd?: ( handle: any, kind: string ) => void;
			onInsertVertex?: ( handle: any, localPoint: number[] ) => string | null | undefined;
			onRemoveVertex?: ( handle: any ) => void;
		};
	} );
	setHandleLayer( layer: HandleLayer | null ): void;
	setWorkingFrame( frame: any ): void;
	enable(): void;
	disable(): void;
	dispose(): void;
}

export class EditSession {
	constructor( options: { plotEngine: PlotEngine; shapeId: string | number; mountGroup: any; handleSizeScale?: number } );
	readonly shapeId: string | number;
	readonly workingShape: PlotShape;
	readonly adapter: ShapeEditAdapter;
	readonly handleLayer: HandleLayer;
	readonly sessionGroup: any;
	setWorkingPatch( patch: ShapeEditPatch ): void;
	setWorkingShape( shape: PlotShape ): void;
	invalidate(): void;
	flushIfDirty(): void;
	computeDiff(): {
		beforeCoordinates: PlotCoordinate[];
		afterCoordinates: PlotCoordinate[];
		beforeStyle: Record<string, any>;
		afterStyle: Record<string, any>;
		coordinatesChanged: boolean;
		styleChanged: boolean;
	};
	refreshColdHiding(): void;
	dispose(): void;
}

export interface PlotEditorOptions {
	plotEngine: PlotEngine;
	camera: any;
	renderer: { domElement: HTMLElement };
	maxHistory?: number;
	autoCoalesce?: boolean;
	autoStart?: boolean;
	handleSizeScale?: number;
	selectionStyle?: { color?: number; opacity?: number; lineWidth?: number };
}

export type PlotEditorEvent =
	| 'selection-change'
	| 'edit-begin'
	| 'edit-commit'
	| 'edit-end'
	| 'edit-cancel'
	| 'history-change'
	| 'drag-start'
	| 'drag-end'
	| 'handle-hover';

export class PlotEditor {
	constructor( options: PlotEditorOptions );
	readonly history: EditorHistory;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly selectedShapeId: string | number | null;
	readonly isEditing: boolean;
	readonly editingShapeId: string | number | null;
	start(): void;
	stop(): void;
	select( shapeId: string | number ): boolean;
	deselect(): void;
	beginEdit( shapeId: string | number ): boolean;
	endEdit(): boolean;
	cancelEdit(): boolean;
	executeCommand( command: BaseCommand ): boolean;
	undo(): boolean;
	redo(): boolean;
	addEventListener( event: PlotEditorEvent, callback: ( payload: any ) => void ): void;
	removeEventListener( event: PlotEditorEvent, callback: ( payload: any ) => void ): void;
	dispose(): void;
}
