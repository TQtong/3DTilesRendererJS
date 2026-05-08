import { Group } from 'three';
import {
	createBatchedPrimitiveGroup,
	disposeObjectTree,
	PrimitiveMaterialPool,
} from './primitiveFactory.js';
import { ThickLineMaterialPool } from './ThickLineMaterial.js';

export class WorldPipe {

	constructor() {

		this.group = new Group();
		this.group.name = 'PlotEngine.WorldPipe';
		this._materialPool = new PrimitiveMaterialPool();
		this._thickLineMaterialPool = new ThickLineMaterialPool();

	}

	refresh( compiledShapes ) {

		while ( this.group.children.length > 0 ) {

			const child = this.group.children[ 0 ];
			this.group.remove( child );
			disposeObjectTree( child, { disposeMaterials: false } );

		}

		const batchedGroup = createBatchedPrimitiveGroup( compiledShapes, {
			materialPool: this._materialPool,
			thickLineMaterialPool: this._thickLineMaterialPool,
		} );
		while ( batchedGroup.children.length > 0 ) {

			this.group.add( batchedGroup.children[ 0 ] );

		}
		this._materialPool.releaseExcept( new Set( batchedGroup.userData.plotMaterialKeys || [] ) );

	}

	dispose() {

		this.refresh( [] );
		this._materialPool.dispose();
		this._thickLineMaterialPool.dispose();

	}

}
