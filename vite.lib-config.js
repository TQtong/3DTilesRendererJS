import path from 'node:path';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { packageAliases } from './vite.config.js';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const bundledDependencies = [ 'text-to-canvas' ];

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

					if ( path.isAbsolute( id ) ) return false;
					const n = id.replace( /\\/g, '/' );
					if ( n.startsWith( '.' ) ) return false;
					// Rollup may normalize lib entries to "src/..." without a leading "./"
					if ( n.startsWith( 'src/' ) ) return false;
					if ( /^3d-tiles-renderer/.test( id ) ) return false;
					if ( bundledDependencies.some( dep => n === dep || n.startsWith( `${dep}/` ) ) ) return false;
					if ( /^text-to-canvas/.test( id ) ) return false;
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
