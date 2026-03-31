import { searchForWorkspaceRoot, loadEnv } from 'vite';
import fs from 'fs';
import react from '@vitejs/plugin-react';
import path from 'path';

// alias order matters so longer paths are listed first.
// Package name is um-3d-tiles-renderer; src uses that specifier. Examples may use 3d-tiles-renderer — alias both to workspace sources.
export const packageAliases = {
	'3d-tiles-renderer/core/plugins': path.resolve( './src/core/plugins/index.js' ),
	'3d-tiles-renderer/three/plugins': path.resolve( './src/three/plugins/index.js' ),
	'um-3d-tiles-renderer/core/plugins': path.resolve( './src/core/plugins/index.js' ),
	'um-3d-tiles-renderer/three/plugins': path.resolve( './src/three/plugins/index.js' ),

	'3d-tiles-renderer/r3f': path.resolve( './src/r3f/index.jsx' ),
	'3d-tiles-renderer/core': path.resolve( './src/core/renderer/index.js' ),
	'3d-tiles-renderer/three': path.resolve( './src/three/renderer/index.js' ),
	'3d-tiles-renderer/babylonjs': path.resolve( './src/babylonjs/renderer/index.js' ),
	'um-3d-tiles-renderer/r3f': path.resolve( './src/r3f/index.jsx' ),
	'um-3d-tiles-renderer/core': path.resolve( './src/core/renderer/index.js' ),
	'um-3d-tiles-renderer/three': path.resolve( './src/three/renderer/index.js' ),
	'um-3d-tiles-renderer/babylonjs': path.resolve( './src/babylonjs/renderer/index.js' ),

	'3d-tiles-renderer/plugins': path.resolve( './src/plugins.js' ),
	'3d-tiles-renderer': path.resolve( './src/index.js' ),
	'um-3d-tiles-renderer/plugins': path.resolve( './src/plugins.js' ),
	'um-3d-tiles-renderer': path.resolve( './src/index.js' ),
};

export default ( { mode } ) => {

	process.env = { ...process.env, ...loadEnv( mode, process.cwd() ) };

	const useBuild = mode === 'use-build';

	return {
		root: './example/',
		envDir: '.',
		base: '',
		resolve: {
			alias: useBuild ? null : packageAliases,
		},
		build: {
			sourcemap: true,
			outDir: './bundle/',
			rollupOptions: {
				input: [
					...fs.readdirSync( './example/three/' ).map( name => 'three/' + name ),
					...fs.readdirSync( './example/r3f/' ).map( name => 'r3f/' + name ),
					...fs.readdirSync( './example/babylonjs/' ).map( name => 'babylonjs/' + name ),
				]
					.filter( p => /\.html$/.test( p ) )
					.map( p => `./example/${ p }` ),
			},
		},
		server: {
			fs: {
				allow: [
					// search up for workspace root
					searchForWorkspaceRoot( process.cwd() ),
				],
			},
		},
		plugins: [ react() ],
	};

};
