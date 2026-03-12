import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { packageAliases } from './vite.config.js';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

export default ( { mode } ) => {

	process.env = { ...process.env, ...loadEnv( mode, process.cwd() ) };

	const entry = {
		'index': path.resolve( __dirname, 'src/index.js' ),
		'index.plugins': path.resolve( __dirname, 'src/plugins.js' ),

		'index.core': path.resolve( __dirname, 'src/core/renderer/index.js' ),
		'index.three': path.resolve( __dirname, 'src/three/renderer/index.js' ),
		'index.babylonjs': path.resolve( __dirname, 'src/babylonjs/renderer/index.js' ),
		'index.r3f': path.resolve( __dirname, 'src/r3f/index.jsx' ),

		'index.core-plugins': path.resolve( __dirname, 'src/core/plugins/index.js' ),
		'index.three-plugins': path.resolve( __dirname, 'src/three/plugins/index.js' )
	};

	return {
		root: './',
		envDir: '.',
		base: '',
		resolve: {
			alias: packageAliases,
		},
		build: {
			sourcemap: true,
			outDir: './build/',
			minify: true,
			rollupOptions: {
				external: ( id ) => {

					if ( /^[./\\]/.test( id ) || /^3d-tiles-renderer/.test( id ) ) {

						return false;

					}

					if ( path.isAbsolute( id ) ) {

						return false;

					}

					return true;

				},
			},
			lib: {
				entry,
				formats: [ 'es' ],
			},
		},
		plugins: [ react() ],
	};

};
