import RBush from 'rbush';
import { boundsToItem, itemToBounds } from './utils/bounds.js';

export class SpatialIndex {

	constructor() {

		this._tree = new RBush();
		this._items = new Map();

	}

	get size() {

		return this._items.size;

	}

	clear() {

		this._tree.clear();
		this._items.clear();

	}

	load( entries ) {

		this.clear();
		const items = [];
		for ( const entry of entries ) {

			if ( ! entry || ! entry.bounds ) continue;
			const item = boundsToItem( entry.id, entry.bounds, entry );
			this._items.set( entry.id, item );
			items.push( item );

		}

		if ( items.length > 0 ) this._tree.load( items );

	}

	insert( id, bounds, data = null ) {

		this.remove( id );
		const item = boundsToItem( id, bounds, data );
		this._items.set( id, item );
		this._tree.insert( item );
		return item;

	}

	update( id, bounds, data = null ) {

		return this.insert( id, bounds, data );

	}

	remove( id ) {

		const item = this._items.get( id );
		if ( ! item ) return false;
		this._tree.remove( item );
		this._items.delete( id );
		return true;

	}

	search( bounds ) {

		const query = boundsToItem( '__query__', bounds );
		return this._tree.search( query ).map( item => item.data || {
			id: item.id,
			bounds: itemToBounds( item ),
		} );

	}

	all() {

		return this._tree.all().map( item => item.data || {
			id: item.id,
			bounds: itemToBounds( item ),
		} );

	}

}
