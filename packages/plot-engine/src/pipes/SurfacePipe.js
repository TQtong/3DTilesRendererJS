import { Group } from 'three';
import { createPrimitiveObject, disposeObjectTree } from './primitiveFactory.js';

export class SurfacePipe {

	constructor() {

		this._groups = new Map();

	}

	attachTarget( target ) {

		if ( this._groups.has( target.id ) ) return;
		const group = new Group();
		group.name = `PlotEngine.SurfacePipe.${ target.id }`;
		target.object3D.add( group );
		this._groups.set( target.id, group );

	}

	refreshTarget( target, compiledShapes ) {

		let group = this._groups.get( target.id );
		if ( ! group ) {

			this.attachTarget( target );
			group = this._groups.get( target.id );

		}

		while ( group.children.length > 0 ) {

			const child = group.children[ 0 ];
			group.remove( child );
			disposeObjectTree( child );

		}

		for ( const compiled of compiledShapes ) {

			const object = createPrimitiveObject( compiled );
			if ( object ) group.add( object );

		}

	}

	detachTarget( targetId ) {

		const group = this._groups.get( targetId );
		if ( ! group ) return;
		disposeObjectTree( group );
		group.removeFromParent();
		this._groups.delete( targetId );

	}

	dispose() {

		for ( const targetId of this._groups.keys() ) this.detachTarget( targetId );

	}

}
