export class TilesRendererIntegration {

	constructor( engine, target ) {

		this.engine = engine;
		this.target = target;
		this.tilesRenderer = target.tilesRenderer;
		this._connected = false;
		this._loadedTiles = new Set();

		this._onLoadModel = event => {

			this._trackTileModel( event.scene, event.tile );

		};

		this._onDisposeModel = event => {

			this._loadedTiles.delete( event.tile );
			this.engine._handleTileModelDispose( this.target.id, event.tile );

		};

		this._onVisibilityChange = event => {

			this.engine._handleTileVisibilityChange( this.target.id, event.tile, event.visible );

		};

	}

	connect() {

		if ( this._connected ) return;
		const tilesRenderer = this.tilesRenderer;

		tilesRenderer.addEventListener?.( 'load-model', this._onLoadModel );
		tilesRenderer.addEventListener?.( 'dispose-model', this._onDisposeModel );
		tilesRenderer.addEventListener?.( 'tile-visibility-change', this._onVisibilityChange );
		tilesRenderer.forEachLoadedModel?.( ( scene, tile ) => {

			this._trackTileModel( scene, tile );

		} );

		this._connected = true;

	}

	disconnect() {

		if ( ! this._connected ) return;
		const tilesRenderer = this.tilesRenderer;

		tilesRenderer.removeEventListener?.( 'load-model', this._onLoadModel );
		tilesRenderer.removeEventListener?.( 'dispose-model', this._onDisposeModel );
		tilesRenderer.removeEventListener?.( 'tile-visibility-change', this._onVisibilityChange );
		this.engine._handleTilesTargetDetach( this.target.id );
		this._loadedTiles.clear();
		this._connected = false;

	}

	_trackTileModel( scene, tile ) {

		if ( this._loadedTiles.has( tile ) ) return;
		this._loadedTiles.add( tile );
		this.engine._handleTileModelLoad( this.target.id, scene, tile );

	}

}
