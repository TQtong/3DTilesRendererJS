import { GoogleCloudAuthPlugin as GoogleCloudAuthPluginImpl } from 'um-3d-tiles-renderer/core/plugins';

export class GoogleCloudAuthPlugin extends GoogleCloudAuthPluginImpl {

	constructor( ...args ) {

		super( ...args );
		console.warn( 'GoogleCloudAuthPlugin: Plugin has been moved to "um-3d-tiles-renderer/core/plugins".' );

	}

}
