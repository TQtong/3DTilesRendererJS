let nextShapeId = 1;

function cloneShape( shape ) {

	return {
		...shape,
		coordinates: shape.coordinates ? shape.coordinates.map( point => [ ...point ] ) : [],
		style: { ...( shape.style || {} ) },
		attachment: { ...( shape.attachment || {} ) },
		userData: { ...( shape.userData || {} ) },
	};

}

function normalizeShape( shape ) {

	if ( ! shape ) {

		throw new Error( 'ShapeStore: shape is required.' );

	}

	const id = shape.id ?? nextShapeId ++;
	const kind = shape.kind || shape.type;
	if ( ! kind ) {

		throw new Error( 'ShapeStore: shape.kind is required.' );

	}

	return {
		id,
		kind,
		coordinates: shape.coordinates ? shape.coordinates.map( point => [ ...point ] ) : [],
		style: { ...( shape.style || shape.options || {} ) },
		attachment: { mode: 'world', ...( shape.attachment || {} ) },
		revision: shape.revision ?? 0,
		userData: { ...( shape.userData || {} ) },
	};

}

export class ShapeStore {

	constructor() {

		this._shapes = new Map();
		this._revision = 0;

	}

	get size() {

		return this._shapes.size;

	}

	get revision() {

		return this._revision;

	}

	add( shape ) {

		const normalized = normalizeShape( shape );
		if ( this._shapes.has( normalized.id ) ) {

			throw new Error( `ShapeStore: duplicate shape id "${ normalized.id }".` );

		}

		this._shapes.set( normalized.id, normalized );
		this._revision ++;
		return cloneShape( normalized );

	}

	update( id, patch ) {

		const current = this._shapes.get( id );
		if ( ! current ) {

			throw new Error( `ShapeStore: shape "${ id }" does not exist.` );

		}

		const updated = {
			...current,
			...patch,
			id,
			kind: patch.kind || patch.type || current.kind,
			coordinates: patch.coordinates ? patch.coordinates.map( point => [ ...point ] ) : current.coordinates.map( point => [ ...point ] ),
			style: ( patch.style || patch.options ) ? { ...current.style, ...( patch.style || patch.options ) } : { ...current.style },
			attachment: patch.attachment ? { ...current.attachment, ...patch.attachment } : { ...current.attachment },
			userData: patch.userData ? { ...current.userData, ...patch.userData } : { ...current.userData },
			revision: current.revision + 1,
		};

		this._shapes.set( id, updated );
		this._revision ++;
		return cloneShape( updated );

	}

	remove( id ) {

		const removed = this._shapes.delete( id );
		if ( removed ) this._revision ++;
		return removed;

	}

	clear() {

		if ( this._shapes.size > 0 ) {

			this._shapes.clear();
			this._revision ++;

		}

	}

	get( id ) {

		const shape = this._shapes.get( id );
		return shape ? cloneShape( shape ) : null;

	}

	has( id ) {

		return this._shapes.has( id );

	}

	values() {

		return Array.from( this._shapes.values(), cloneShape );

	}

	forEachRaw( callback ) {

		for ( const shape of this._shapes.values() ) {

			callback( shape );

		}

	}

	entries() {

		return Array.from( this._shapes.entries(), ( [ id, shape ] ) => [ id, cloneShape( shape ) ] );

	}

}
