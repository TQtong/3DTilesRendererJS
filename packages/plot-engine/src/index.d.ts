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
	select( ids: string | number | Array<string | number> | null | undefined ): Array<string | number>;
	setMode( mode: string ): string;
	attachTilesRenderer( id: string | number, tilesRenderer: any, options?: PlotTargetOptions ): TilesRendererTarget;
	attachSurfaceTarget( id: string | number, source: any, options?: PlotTargetOptions ): SurfacePlotTarget;
	attachObjectTarget( id: string | number, object3D: Object3D, options?: PlotTargetOptions ): ObjectPlotTarget;
	detachTarget( id: string | number ): PlotTarget | null;
	dispose(): void;
}

export function createTilesRendererTargetAdapter(): SurfaceTargetAdapter;
