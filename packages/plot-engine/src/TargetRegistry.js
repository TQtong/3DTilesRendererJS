function normalizeTargetOptions( options ) {

	return {
		geoReference: { kind: 'local', ...( options.geoReference || {} ) },
		...options,
	};

}

function isReferenceValue( value ) {

	return ( typeof value === 'object' || typeof value === 'function' ) && value !== null;

}

export class TargetRegistry {

	constructor() {

		this._targets = new Map();
		this._surfaceTargets = new WeakMap();
		this._tilesRendererTargets = new WeakMap();
		this._objectTargets = new WeakMap();

	}

	get size() {

		return this._targets.size;

	}

	attachTilesRenderer( id, tilesRenderer, options = {} ) {

		if ( ! tilesRenderer ) {

			throw new Error( 'TargetRegistry: tilesRenderer is required.' );

		}

		const existingTarget = this.findBySurfaceTarget( tilesRenderer ) || this.findByTilesRenderer( tilesRenderer );
		if ( existingTarget ) {

			throw new Error( `TargetRegistry: tilesRenderer is already attached as target "${ existingTarget.id }".` );

		}

		return this._attach( {
			id,
			type: 'tiles-renderer',
			source: tilesRenderer,
			tilesRenderer,
			options: normalizeTargetOptions( options ),
		} );

	}

	attachSurfaceTarget( id, source, options = {} ) {

		if ( ! source ) {

			throw new Error( 'TargetRegistry: source is required.' );

		}

		const normalizedOptions = normalizeTargetOptions( options );
		if ( ! normalizedOptions.surfaceAdapter ) {

			throw new Error( 'TargetRegistry: options.surfaceAdapter is required for surface targets.' );

		}

		const existingTarget = this.findBySurfaceTarget( source );
		if ( existingTarget ) {

			throw new Error( `TargetRegistry: source is already attached as target "${ existingTarget.id }".` );

		}

		return this._attach( {
			id,
			type: 'surface-target',
			source,
			options: normalizedOptions,
		} );

	}

	attachObjectTarget( id, object3D, options = {} ) {

		if ( ! object3D ) {

			throw new Error( 'TargetRegistry: object3D is required.' );

		}

		const existingTarget = this.findByObjectTarget( object3D );
		if ( existingTarget ) {

			throw new Error( `TargetRegistry: object3D is already attached as target "${ existingTarget.id }".` );

		}

		return this._attach( {
			id,
			type: 'object',
			object3D,
			options: normalizeTargetOptions( options ),
		} );

	}

	_attach( target ) {

		if ( this._targets.has( target.id ) ) {

			throw new Error( `TargetRegistry: target "${ target.id }" already exists.` );

		}

		this._targets.set( target.id, target );
		this._indexTarget( target );
		return target;

	}

	detach( id ) {

		const target = this._targets.get( id );
		if ( ! target ) return null;
		this._targets.delete( id );
		this._unindexTarget( target );
		return target;

	}

	get( id ) {

		return this._targets.get( id ) || null;

	}

	has( id ) {

		return this._targets.has( id );

	}

	findByTilesRenderer( tilesRenderer ) {

		if ( ! isReferenceValue( tilesRenderer ) ) return null;
		return this._tilesRendererTargets.get( tilesRenderer ) || null;

	}

	findBySurfaceTarget( source ) {

		if ( ! isReferenceValue( source ) ) return null;
		return this._surfaceTargets.get( source ) || null;

	}

	hasSurfaceTarget( source ) {

		return this.findBySurfaceTarget( source ) !== null;

	}

	hasTilesRenderer( tilesRenderer ) {

		return this.findByTilesRenderer( tilesRenderer ) !== null;

	}

	findByObjectTarget( object3D ) {

		if ( ! isReferenceValue( object3D ) ) return null;
		return this._objectTargets.get( object3D ) || null;

	}

	hasObjectTarget( object3D ) {

		return this.findByObjectTarget( object3D ) !== null;

	}

	values() {

		return Array.from( this._targets.values() );

	}

	clear() {

		const targets = this.values();
		this._targets.clear();
		for ( const target of targets ) {

			this._unindexTarget( target );

		}
		return targets;

	}

	_indexTarget( target ) {

		if ( ( target.type === 'tiles-renderer' || target.type === 'surface-target' ) && isReferenceValue( target.source ) ) {

			this._surfaceTargets.set( target.source, target );

		}

		if ( target.type === 'tiles-renderer' && isReferenceValue( target.tilesRenderer ) ) {

			this._tilesRendererTargets.set( target.tilesRenderer, target );

		}

		if ( target.type === 'object' && isReferenceValue( target.object3D ) ) {

			this._objectTargets.set( target.object3D, target );

		}

	}

	_unindexTarget( target ) {

		if ( ( target.type === 'tiles-renderer' || target.type === 'surface-target' ) && isReferenceValue( target.source ) ) {

			this._surfaceTargets.delete( target.source );

		}

		if ( target.type === 'tiles-renderer' && isReferenceValue( target.tilesRenderer ) ) {

			this._tilesRendererTargets.delete( target.tilesRenderer );

		}

		if ( target.type === 'object' && isReferenceValue( target.object3D ) ) {

			this._objectTargets.delete( target.object3D );

		}

	}

}
