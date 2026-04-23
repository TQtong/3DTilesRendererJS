import { Group } from 'three';
import { createPrimitiveObject, disposeObjectTree } from './primitiveFactory.js';

export class WorldPipe {

	constructor() {

		this.group = new Group();
		this.group.name = 'PlotEngine.WorldPipe';

	}

	refresh( compiledShapes ) {

		while ( this.group.children.length > 0 ) {

			const child = this.group.children[ 0 ];
			this.group.remove( child );
			disposeObjectTree( child );

		}

		for ( const compiled of compiledShapes ) {

			const object = createPrimitiveObject( compiled );
			if ( object ) this.group.add( object );

		}

	}

	dispose() {

		this.refresh( [] );

	}

}
