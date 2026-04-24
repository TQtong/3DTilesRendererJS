import { Group } from 'three';
import { createPrimitiveObject, disposeObjectTree } from './primitiveFactory.js';

export class SurfacePipe {

	constructor() {

		this._groups = new Map();
		this._objects = new Map();

	}

	attachTarget( target ) {

		if ( this._groups.has( target.id ) ) return;
		const group = new Group();
		group.name = `PlotEngine.SurfacePipe.${ target.id }`;
		target.object3D.add( group );
		this._groups.set( target.id, group );
		this._objects.set( target.id, new Map() );

	}

	refreshTarget( target, compiledShapes ) {

		let group = this._groups.get( target.id );
		if ( ! group ) {

			this.attachTarget( target );
			group = this._groups.get( target.id );

		}

		const objects = this._objects.get( target.id ) || new Map();
		this._objects.set( target.id, objects );

		const nextIds = new Set();
		for ( const compiled of compiledShapes ) {

			nextIds.add( compiled.id );
			const objectKey = `${ compiled.id }:${ compiled.revision }`;
			let entry = objects.get( compiled.id ) || null;

			if ( ! entry || entry.key !== objectKey ) {

				if ( entry?.object ) {

					group.remove( entry.object );
					disposeObjectTree( entry.object );

				}

				const object = createPrimitiveObject( compiled );
				if ( ! object ) {

					objects.delete( compiled.id );
					continue;

				}

				entry = { key: objectKey, object };
				objects.set( compiled.id, entry );

			}

			group.add( entry.object );

		}

		for ( const [ id, entry ] of objects ) {

			if ( nextIds.has( id ) ) continue;
			group.remove( entry.object );
			disposeObjectTree( entry.object );
			objects.delete( id );

		}

	}

	detachTarget( targetId ) {

		const group = this._groups.get( targetId );
		if ( ! group ) return;
		disposeObjectTree( group );
		group.removeFromParent();
		this._groups.delete( targetId );
		this._objects.delete( targetId );

	}

	dispose() {

		for ( const targetId of this._groups.keys() ) this.detachTarget( targetId );

	}

}
