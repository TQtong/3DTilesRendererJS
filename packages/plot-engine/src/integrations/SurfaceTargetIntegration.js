function normalizeDisconnect( value ) {

	if ( typeof value === 'function' ) return value;
	if ( value && typeof value.disconnect === 'function' ) return value.disconnect.bind( value );
	return null;

}

function getEntryKey( entryOrKey ) {

	if ( entryOrKey && typeof entryOrKey === 'object' ) {

		if ( 'key' in entryOrKey && entryOrKey.key != null ) return entryOrKey.key;
		if ( 'id' in entryOrKey && entryOrKey.id != null ) return entryOrKey.id;
		if ( entryOrKey.data?.tile != null ) return entryOrKey.data.tile;
		if ( entryOrKey.scene != null ) return entryOrKey.scene;

	}

	return entryOrKey;

}

export class SurfaceTargetIntegration {

	constructor( engine, target ) {

		this.engine = engine;
		this.target = target;
		this.source = target.source ?? target.tilesRenderer ?? null;
		this.adapter = target.options.surfaceAdapter ?? null;
		this._connected = false;
		this._loadedEntries = new Map();
		this._disconnect = null;

		this._callbacks = {
			onEntryLoad: entry => {

				this._trackEntry( entry );

			},
			onEntryDispose: entryOrKey => {

				const entryKey = getEntryKey( entryOrKey );
				this._loadedEntries.delete( entryKey );
				this.engine._handleSurfaceEntryDispose( this.target.id, entryKey );

			},
			onEntryVisibilityChange: ( entryOrKey, visible ) => {

				const entryKey = getEntryKey( entryOrKey );
				const loadedEntry = this._loadedEntries.get( entryKey );
				if ( loadedEntry ) loadedEntry.visible = visible;
				this.engine._handleSurfaceEntryVisibilityChange( this.target.id, entryKey, visible );

			},
		};

	}

	connect() {

		if ( this._connected || ! this.adapter ) return;

		const disconnectValue = this.adapter.connect?.( this.source, this._callbacks, this.target );
		this._disconnect = normalizeDisconnect( disconnectValue );
		this.adapter.forEachEntry?.( this.source, entry => {

			this._trackEntry( entry );

		}, this.target );

		this._connected = true;

	}

	disconnect() {

		if ( ! this._connected ) return;

		this._disconnect?.();
		this.engine._handleSurfaceTargetDetach( this.target.id );
		this._disconnect = null;
		this._loadedEntries.clear();
		this._connected = false;

	}

	_trackEntry( entry ) {

		if ( ! entry?.scene ) return;

		const entryKey = getEntryKey( entry );
		if ( this._loadedEntries.has( entryKey ) ) return;

		this._loadedEntries.set( entryKey, entry );
		this.engine._handleSurfaceEntryLoad( this.target.id, entry );

	}

}
