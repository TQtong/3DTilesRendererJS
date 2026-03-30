import path from 'node:path';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { packageAliases } from './vite.config.js';

export default ( { mode } ) => {

	process.env = { ...process.env, ...loadEnv( mode, process.cwd() ) };

	const entry = {
		'index': './src/index.js',
		'index.plugins': './src/plugins.js',

		'index.core': './src/core/renderer/index.js',
		'index.three': './src/three/renderer/index.js',
		'index.babylonjs': './src/babylonjs/renderer/index.js',
		'index.r3f': './src/r3f/index.jsx',

		'index.core-plugins': './src/core/plugins/index.js',
		'index.three-plugins': './src/three/plugins/index.js'
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

					if ( path.isAbsolute( id ) ) return false;
					const n = id.replace( /\\/g, '/' );
					if ( n.startsWith( '.' ) ) return false;
					// Rollup may normalize lib entries to "src/..." without a leading "./"
					if ( n.startsWith( 'src/' ) ) return false;
					if ( /^3d-tiles-renderer/.test( id ) ) return false;
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
