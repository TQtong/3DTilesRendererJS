import { Group } from 'three';
import { CompilerRegistry } from './CompilerRegistry.js';
import { ShapeStore } from './ShapeStore.js';
import { SpatialIndex } from './SpatialIndex.js';
import { TargetRegistry } from './TargetRegistry.js';
import { createTilesRendererTargetAdapter } from './adapters/createTilesRendererTargetAdapter.js';
import { SurfaceTargetIntegration } from './integrations/SurfaceTargetIntegration.js';
import { SurfacePipe } from './pipes/SurfacePipe.js';
import { TiledPipe } from './pipes/TiledPipe.js';
import { WorldPipe } from './pipes/WorldPipe.js';
import { intersectsBounds } from './utils/bounds.js';

function haveCompiledChanged( previous, current ) {

	if ( ! previous || ! current ) return previous !== current;
	return (
		previous.revision !== current.revision ||
		previous.kind !== current.kind ||
		previous.attachment?.mode !== current.attachment?.mode ||
		previous.attachment?.targetId !== current.attachment?.targetId ||
		previous.bounds?.[ 0 ] !== current.bounds?.[ 0 ] ||
		previous.bounds?.[ 1 ] !== current.bounds?.[ 1 ] ||
		previous.bounds?.[ 2 ] !== current.bounds?.[ 2 ] ||
		previous.bounds?.[ 3 ] !== current.bounds?.[ 3 ]
	);

}

function getRequestAnimationFrame() {

	if ( typeof globalThis.requestAnimationFrame === 'function' ) {

		return globalThis.requestAnimationFrame.bind( globalThis );

	}

	return callback => setTimeout( () => callback( performance.now?.() ?? Date.now() ), 16 );

}

function getCancelAnimationFrame() {

	if ( typeof globalThis.cancelAnimationFrame === 'function' ) {

		return globalThis.cancelAnimationFrame.bind( globalThis );

	}

	return handle => clearTimeout( handle );

}

function logPlotEngine( ...args ) {

	console.log( '[PlotEngine]', ...args );

}

function formatBounds( bounds ) {

	if ( ! bounds ) return null;
	return bounds.map( value => Number( Number( value ).toFixed( 6 ) ) );

}

export class PlotEngine {

	constructor( options = {} ) {

		this.options = options;
		this.group = new Group();
		this.group.name = 'PlotEngine';

		this.shapeStore = new ShapeStore();
		this.compilerRegistry = new CompilerRegistry();
		this.spatialIndex = new SpatialIndex();
		this.targetRegistry = new TargetRegistry();
		this.mode = options.mode ?? 'world';

		this.worldPipe = new WorldPipe();
		this.surfacePipe = new SurfacePipe();
		this.tiledPipe = new TiledPipe( this, options.tiledPipe );
		this.group.add( this.worldPipe.group );

		this._compiledShapes = [];
		this._compiledShapeMap = new Map();
		this._compiledChanges = [];
		this._integrations = new Map();
		this._running = false;
		this._dirty = true;
		this._rafHandle = null;
		this._requestAnimationFrame = getRequestAnimationFrame();
		this._cancelAnimationFrame = getCancelAnimationFrame();
		this._tick = () => {

			this.update();
			if ( this._running ) this._rafHandle = this._requestAnimationFrame( this._tick );

		};

	}

	start() {

		if ( this._running ) return this;
		this._running = true;
		this._rafHandle = this._requestAnimationFrame( this._tick );
		return this;

	}

	stop() {

		if ( ! this._running ) return this;
		this._running = false;
		if ( this._rafHandle !== null ) this._cancelAnimationFrame( this._rafHandle );
		this._rafHandle = null;
		return this;

	}

	update() {

		if ( ! this._dirty ) return this;
		this._compileShapes();
		this._refreshPipes( this._compiledChanges );
		this._dirty = false;
		return this;

	}

	invalidate() {

		this._dirty = true;
		return this;

	}

	addShape( shape ) {

		const result = this.shapeStore.add( shape );
		this.invalidate();
		return result;

	}

	updateShape( id, patch ) {

		const result = this.shapeStore.update( id, patch );
		this.invalidate();
		return result;

	}

	removeShape( id ) {

		const removed = this.shapeStore.remove( id );
		if ( removed ) this.invalidate();
		return removed;

	}

	select( ids ) {

		this.selection = Array.isArray( ids ) ? [ ...ids ] : ids == null ? [] : [ ids ];
		return this.selection;

	}

	setMode( mode ) {

		this.mode = mode;
		return mode;

	}

	attachTilesRenderer( id, tilesRenderer, options = {} ) {

		const target = this.targetRegistry.attachTilesRenderer( id, tilesRenderer, {
			...options,
			surfaceAdapter: options.surfaceAdapter ?? createTilesRendererTargetAdapter(),
		} );
		return this._attachSurfaceIntegration( target );

	}

	attachSurfaceTarget( id, source, options = {} ) {

		const target = this.targetRegistry.attachSurfaceTarget( id, source, options );
		return this._attachSurfaceIntegration( target );

	}

	_attachSurfaceIntegration( target ) {

		this.invalidate();
		const integration = new SurfaceTargetIntegration( this, target );
		integration.connect();
		this._integrations.set( target.id, integration );
		return target;

	}

	attachObjectTarget( id, object3D, options = {} ) {

		const target = this.targetRegistry.attachObjectTarget( id, object3D, options );
		this.surfacePipe.attachTarget( target );
		this.invalidate();
		return target;

	}

	detachTarget( id ) {

		this._integrations.get( id )?.disconnect();
		this._integrations.delete( id );
		this.tiledPipe.disposeTarget( id );
		this.surfacePipe.detachTarget( id );
		return this.targetRegistry.detach( id );

	}

	dispose() {

		this.stop();
		for ( const targetId of this._integrations.keys() ) {

			this.detachTarget( targetId );

		}

		for ( const target of this.targetRegistry.clear() ) {

			this.surfacePipe.detachTarget( target.id );
			this.tiledPipe.disposeTarget( target.id );

		}

		this.worldPipe.dispose();
		this.surfacePipe.dispose();
		this.group.removeFromParent();

	}

	_handleSurfaceEntryLoad( targetId, entry ) {

		const target = this.targetRegistry.get( targetId );
		if ( ! target ) return;
		this.update();
		this.tiledPipe.attachEntry( target, entry );

	}

	_handleSurfaceEntryDispose( targetId, entryKey ) {

		this.tiledPipe.detachEntry( targetId, entryKey );

	}

	_handleSurfaceEntryVisibilityChange( targetId, entryKey, visible ) {

		this.tiledPipe.setEntryVisible( targetId, entryKey, visible );

	}

	_handleSurfaceTargetDetach( targetId ) {

		this.tiledPipe.disposeTarget( targetId );

	}

	_handleTileModelLoad( targetId, scene, tile ) {

		this._handleSurfaceEntryLoad( targetId, {
			key: tile,
			scene,
			visible: tile?.traversal?.visible !== false,
			data: { tile },
		} );

	}

	_handleTileModelDispose( targetId, tile ) {

		this._handleSurfaceEntryDispose( targetId, tile );

	}

	_handleTileVisibilityChange( targetId, tile, visible ) {

		this._handleSurfaceEntryVisibilityChange( targetId, tile, visible );

	}

	_handleTilesTargetDetach( targetId ) {

		this._handleSurfaceTargetDetach( targetId );

	}

	_queryCompiledForTarget( targetId, bounds, mode ) {

		const results = this.spatialIndex.search( bounds ).filter( compiled => {

			const attachment = compiled.attachment || {};
			if ( attachment.mode !== mode ) return false;
			if ( attachment.targetId == null ) return true;
			return attachment.targetId === targetId;

		} ).filter( compiled => intersectsBounds( compiled.bounds, bounds ) );

		logPlotEngine( 'queryCompiledForTarget', {
			targetId,
			mode,
			queryBounds: formatBounds( bounds ),
			resultCount: results.length,
			results: results.map( compiled => ( {
				id: compiled.id,
				mode: compiled.attachment?.mode,
				targetId: compiled.attachment?.targetId ?? null,
				bounds: formatBounds( compiled.bounds ),
			} ) ),
		} );

		return results;

	}

	_compileShapes() {

		const previousCompiledShapeMap = this._compiledShapeMap;
		this._compiledShapes = this.compilerRegistry.compileMany( this.shapeStore.values() );
		this._compiledShapeMap = new Map( this._compiledShapes.map( compiled => [ compiled.id, compiled ] ) );
		this._compiledChanges = [];

		for ( const [ id, compiled ] of this._compiledShapeMap ) {

			const previous = previousCompiledShapeMap.get( id ) || null;
			if ( ! previous ) {

				this._compiledChanges.push( { type: 'added', previous: null, current: compiled } );
				continue;

			}

			if ( haveCompiledChanged( previous, compiled ) ) {

				this._compiledChanges.push( { type: 'updated', previous, current: compiled } );

			}

		}

		for ( const [ id, previous ] of previousCompiledShapeMap ) {

			if ( ! this._compiledShapeMap.has( id ) ) {

				this._compiledChanges.push( { type: 'removed', previous, current: null } );

			}

		}

		this.spatialIndex.load( this._compiledShapes );
		logPlotEngine( 'compileShapes', this._compiledShapes.map( compiled => ( {
			id: compiled.id,
			kind: compiled.kind,
			mode: compiled.attachment?.mode,
			targetId: compiled.attachment?.targetId ?? null,
			bounds: formatBounds( compiled.bounds ),
		} ) ) );

	}

	_refreshPipes( compiledChanges = [] ) {

		this.worldPipe.refresh( this._compiledShapes.filter( compiled => ( compiled.attachment?.mode ?? 'world' ) === 'world' ) );

		for ( const target of this.targetRegistry.values() ) {

			if ( target.type === 'object' ) {

				this.surfacePipe.refreshTarget( target, this._compiledShapes.filter( compiled => {

					const mode = compiled.attachment?.mode ?? 'world';
					const targetId = compiled.attachment?.targetId;
					return mode === 'surface' && ( targetId == null || targetId === target.id );

				} ) );

			}

		}

		if ( compiledChanges.length === 0 ) {

			this.tiledPipe.refreshAll();

		} else {

			this.tiledPipe.refreshChanges( compiledChanges );

		}

	}

}
