import {
	Box3,
	Float32BufferAttribute,
	Vector3,
} from 'three';
import { buildRasterPlotTexture, canBuildRasterPlotTexture } from '../RasterPlotTexture.js';
import { buildSdfTexture } from '../SdfDataBuilder.js';
import { SpatialIndex } from '../SpatialIndex.js';
import { cloneBounds } from '../utils/bounds.js';
import {
	clearWrappedTiledSdfMaterial,
	disposeWrappedTiledSdfMaterial,
	updateWrappedTiledSdfMaterial,
	wrapTiledSdfMaterial,
} from './tiledSdfMaterial.js';

const _box = /* @__PURE__ */ new Box3();
const _size = /* @__PURE__ */ new Vector3();
const _position = /* @__PURE__ */ new Vector3();
const _projectedPosition = [ 0, 0, 0 ];



function formatBounds( bounds ) {

	if ( ! bounds ) return null;
	return bounds.map( value => Number( Number( value ).toFixed( 6 ) ) );

}

function sameBounds( left, right ) {

	if ( left === right ) return true;
	if ( ! left || ! right ) return false;
	return (
		left[ 0 ] === right[ 0 ] &&
		left[ 1 ] === right[ 1 ] &&
		left[ 2 ] === right[ 2 ] &&
		left[ 3 ] === right[ 3 ]
	);

}

function getTileShapeKey( compiledShapes ) {

	return compiledShapes.map( compiled => `${ compiled.id }:${ compiled.revision }` ).join( '|' );

}

function getDecalHeightOffset( compiledShapes, fallback ) {

	return Number( fallback ?? 0 );

}

function getProjectedAttachmentTargetIds( compiled, loadedTargets ) {

	const attachment = compiled?.attachment || {};
	const attachmentMode = attachment.mode ?? 'world';
	if ( attachmentMode !== 'tiles' && attachmentMode !== 'surface' ) return [];
	if ( attachment.targetId != null ) return [ attachment.targetId ];
	return loadedTargets;

}

function getSurfaceAdapter( target ) {

	return target?.options?.surfaceAdapter ?? null;

}

function applyPlanarFallbackGeometry( geometry, position, uv, heightOffset ) {

	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	const localSpanX = Math.max( box.max.x - box.min.x, 1e-12 );
	const localSpanZ = Math.max( box.max.z - box.min.z, 1e-12 );
	let positionChanged = false;

	for ( let index = 0; index < position.count; index ++ ) {

		_position.fromBufferAttribute( position, index );
		uv[ index * 2 + 0 ] = ( _position.x - box.min.x ) / localSpanX;
		uv[ index * 2 + 1 ] = ( _position.z - box.min.z ) / localSpanZ;
		if ( heightOffset !== 0 ) {

			position.setY( index, _position.y + heightOffset );
			positionChanged = true;

		}

	}

	return positionChanged;

}

function cloneOverlayMaterial( material ) {

	if ( ! material ) return material;
	wrapTiledSdfMaterial( material );
	return material;

}

function disposeOverlayMaterial( material, ownsMaterial = false ) {

	if ( ! material ) return;
	disposeWrappedTiledSdfMaterial( material );
	if ( ownsMaterial ) material.dispose?.();

}

function disposeEntryTexture( texture ) {

	if ( ! texture ) return;

	const image = texture.image ?? texture.source?.data ?? null;
	texture.dispose?.();

	if ( texture.source ) {

		texture.source.data = null;

	}

	if ( image && typeof image === 'object' ) {

		if ( 'data' in image ) image.data = null;
		if ( 'width' in image ) image.width = 0;
		if ( 'height' in image ) image.height = 0;

	}

	texture.image = null;

}

export class TiledPipe {

	constructor( engine, options = {} ) {

		this.engine = engine;
		this.opacity = options.opacity ?? 1;
		this.heightOffset = options.heightOffset ?? 0;
		this.rasterize = options.rasterize ?? true;
		this.rasterTextureSize = options.rasterTextureSize ?? 512;
		this._loadedTiles = new Map();
		this._tileIndices = new Map();

	}

	attachEntry( target, surfaceEntry ) {

		const targetTiles = this._ensureTargetMap( this._loadedTiles, target.id );
		const entryKey = surfaceEntry.key;
		const visible = surfaceEntry.visible !== false;
		const bounds = this._getEntryBounds( target, surfaceEntry );
		let entry = targetTiles.get( entryKey ) || null;

		if ( entry ) {

			entry.target = target;
			entry.scene = surfaceEntry.scene;
			entry.surfaceEntry = surfaceEntry;
			entry.visible = visible;
			if ( bounds ) this._updateTileBounds( target.id, entry, bounds );

		} else {

			entry = {
				target,
				scene: surfaceEntry.scene,
				surfaceEntry,
				tile: entryKey,
				visible,
				bounds: bounds ? cloneBounds( bounds ) : null,
				meshEntries: null,
				texture: null,
				textureMode: 'vector',
				shapeKey: '',
				geometryKey: '',
			};
			targetTiles.set( entryKey, entry );
			if ( bounds ) this._getTileIndex( target.id ).insert( entryKey, bounds, entry );

		}



		this.rebuildEntry( target.id, entryKey, { force: true } );
		return entry;

	}

	attachTile( target, scene, tile ) {

		return this.attachEntry( target, {
			key: tile,
			scene,
			visible: tile?.traversal?.visible !== false,
			data: { tile },
		} );

	}

	setEntryVisible( targetId, entryKey, visible ) {

		const entry = this._loadedTiles.get( targetId )?.get( entryKey ) || null;
		if ( ! entry ) return;

		entry.visible = visible;
		if ( entry.surfaceEntry ) entry.surfaceEntry.visible = visible;

		if ( visible ) {

			this.rebuildEntry( targetId, entryKey, { force: true } );
			return;

		}

		for ( const meshEntry of entry.meshEntries || [] ) {

			this._applyEntryOverlayToMesh( entry, meshEntry );

		}

	}

	setTileVisible( targetId, tile, visible ) {

		this.setEntryVisible( targetId, tile, visible );

	}

	detachEntry( targetId, entryKey ) {

		const targetTiles = this._loadedTiles.get( targetId );
		const entry = targetTiles?.get( entryKey ) || null;
		if ( ! entry ) return;

		this._tileIndices.get( targetId )?.remove( entryKey );
		this._disposeTileEntry( entry );
		targetTiles.delete( entryKey );

	}

	detachTile( targetId, tile ) {

		this.detachEntry( targetId, tile );

	}

	disposeTarget( targetId ) {

		const targetTiles = this._loadedTiles.get( targetId );
		if ( targetTiles ) {

			for ( const entryKey of targetTiles.keys() ) this.detachEntry( targetId, entryKey );

		}

		this._loadedTiles.delete( targetId );
		this._tileIndices.delete( targetId );

	}

	refreshAll() {

		for ( const [ targetId, targetTiles ] of this._loadedTiles ) {

			for ( const entryKey of targetTiles.keys() ) this.rebuildEntry( targetId, entryKey, { force: true } );

		}

	}

	refreshChanges( changes ) {

		if ( ! changes || changes.length === 0 ) return;

		const dirtyTilesByTarget = new Map();
		const loadedTargetIds = Array.from( this._loadedTiles.keys() );
		for ( const change of changes ) {

			this._markDirtyTilesForCompiled( change.previous, loadedTargetIds, dirtyTilesByTarget );
			this._markDirtyTilesForCompiled( change.current, loadedTargetIds, dirtyTilesByTarget );

		}

		for ( const [ targetId, entryKeys ] of dirtyTilesByTarget ) {

			for ( const entryKey of entryKeys ) this.rebuildEntry( targetId, entryKey );

		}

	}

	rebuildEntry( targetId, entryKey, options = {} ) {

		const entry = this._loadedTiles.get( targetId )?.get( entryKey ) || null;
		if ( ! entry ) return null;

		const bounds = this._getEntryBounds( entry.target, entry.surfaceEntry );
		if ( ! bounds ) {


			this._tileIndices.get( targetId )?.remove( entryKey );
			entry.bounds = null;
			entry.shapeKey = '';
			entry.geometryKey = '';
			entry.textureMode = 'vector';
			this._clearTileOverlay( entry );
			return entry;

		}

		const boundsChanged = ! sameBounds( entry.bounds, bounds );
		if ( boundsChanged ) this._updateTileBounds( targetId, entry, bounds );

		const compiledShapes = this.engine._queryCompiledForTarget( targetId, entry.bounds, [ 'tiles', 'surface' ] );
		if ( compiledShapes.length === 0 ) {


			entry.shapeKey = '';
			entry.textureMode = 'vector';
			this._clearTileOverlay( entry );
			return entry;

		}

		const heightOffset = getDecalHeightOffset( compiledShapes, this.heightOffset );
		const geometryChanged = this._ensureTileGeometry( entry, heightOffset );
		const nextShapeKey = getTileShapeKey( compiledShapes );
		const textureDirty =
			options.force === true ||
			entry.texture === null ||
			entry.shapeKey !== nextShapeKey;

		if ( textureDirty ) {

			if ( entry.texture ) disposeEntryTexture( entry.texture );
			entry.texture = this._buildTileTexture( compiledShapes, entry.bounds );
			entry.textureMode = entry.texture?.userData?.mode ?? 'vector';

		}

		entry.shapeKey = nextShapeKey;
		for ( const meshEntry of this._ensureMeshEntries( entry ) ) {

			this._ensureWrappedMaterials( meshEntry );
			this._applyEntryOverlayToMesh( entry, meshEntry );

		}

		return entry;

	}

	_buildTileTexture( compiledShapes, bounds ) {

		if ( this.rasterize && canBuildRasterPlotTexture() ) {

			const rasterTexture = buildRasterPlotTexture( compiledShapes, bounds, {
				size: this.rasterTextureSize,
			} );
			if ( rasterTexture ) return rasterTexture;

		}

		const texture = buildSdfTexture( compiledShapes );
		texture.userData.mode = 'vector';
		return texture;

	}

	rebuildTile( targetId, tile, options = {} ) {

		return this.rebuildEntry( targetId, tile, options );

	}

	_getEntryBounds( target, surfaceEntry ) {

		if ( ! surfaceEntry?.scene ) return null;

		const adapter = getSurfaceAdapter( target );
		const adapterBounds = adapter?.getEntryBounds?.( surfaceEntry, target );
		if ( adapterBounds ) {


			return adapterBounds;

		}

		const legacyEntryKey = surfaceEntry.data?.tile ?? surfaceEntry.key;
		const customBounds = target.options.getTileBounds?.( legacyEntryKey, surfaceEntry.scene, target );
		if ( customBounds ) {


			return customBounds;

		}

		target?.source?.group?.updateMatrixWorld?.( true );
		target?.tilesRenderer?.group?.updateMatrixWorld?.( true );
		surfaceEntry.scene.updateMatrixWorld?.( true );
		_box.setFromObject( surfaceEntry.scene );
		if ( _box.isEmpty() ) return null;
		_box.getSize( _size );
		if ( _size.x === 0 && _size.z === 0 ) return null;
		const fallbackBounds = [ _box.min.x, _box.min.z, _box.max.x, _box.max.z ];

		return fallbackBounds;

	}

	_createProjectedGeometry( baseGeometry, mesh, entry, bounds, heightOffset = 0 ) {

		const geometry = baseGeometry.clone();
		const position = geometry.getAttribute( 'position' );
		if ( ! position ) return geometry;

		const uv = new Float32Array( position.count * 2 );
		const spanX = Math.max( bounds[ 2 ] - bounds[ 0 ], 1e-12 );
		const spanY = Math.max( bounds[ 3 ] - bounds[ 1 ], 1e-12 );
		const adapter = getSurfaceAdapter( entry.target );

		let hasProjectedPoint = false;
		let projectedPointCount = 0;
		if ( adapter?.projectPosition ) {

			entry.target?.source?.group?.updateMatrixWorld?.( true );
			entry.target?.tilesRenderer?.group?.updateMatrixWorld?.( true );
			entry.scene?.updateMatrixWorld?.( true );
			mesh.updateMatrixWorld?.( true );
			for ( let index = 0; index < position.count; index ++ ) {

				_position.fromBufferAttribute( position, index ).applyMatrix4( mesh.matrixWorld );
				const projected = adapter.projectPosition( _position, entry.surfaceEntry, entry.target, _projectedPosition );
				if ( ! projected ) {

					uv[ index * 2 + 0 ] = 0;
					uv[ index * 2 + 1 ] = 0;
					continue;

				}

				hasProjectedPoint = true;
				projectedPointCount ++;
				uv[ index * 2 + 0 ] = ( projected[ 0 ] - bounds[ 0 ] ) / spanX;
				uv[ index * 2 + 1 ] = ( projected[ 1 ] - bounds[ 1 ] ) / spanY;

			}

		}

		const positionChanged = hasProjectedPoint
			? false
			: applyPlanarFallbackGeometry( geometry, position, uv, heightOffset );



		geometry.setAttribute( 'plotUv', new Float32BufferAttribute( uv, 2 ) );
		if ( positionChanged ) {

			position.needsUpdate = true;
			geometry.computeBoundingBox?.();
			geometry.computeBoundingSphere?.();

		}

		return geometry;

	}

	_markDirtyTilesForCompiled( compiled, loadedTargetIds, dirtyTilesByTarget ) {

		if ( ! compiled?.bounds ) return;

		const targetIds = getProjectedAttachmentTargetIds( compiled, loadedTargetIds );

		for ( const targetId of targetIds ) {

			const tileIndex = this._tileIndices.get( targetId );
			if ( ! tileIndex ) {


				continue;

			}

			let dirtyTiles = dirtyTilesByTarget.get( targetId );
			if ( ! dirtyTiles ) {

				dirtyTiles = new Set();
				dirtyTilesByTarget.set( targetId, dirtyTiles );

			}

			const matchedEntries = tileIndex.search( compiled.bounds );

			for ( const entry of matchedEntries ) {

				dirtyTiles.add( entry.tile );

			}

		}

	}

	_ensureMeshEntries( entry ) {

		if ( entry.meshEntries ) return entry.meshEntries;

		const meshEntries = [];
		entry.scene.traverse?.( child => {

			if ( ! child.isMesh || ! child.geometry || child.isPoints ) return;
			meshEntries.push( {
				sourceMesh: child,
				originalGeometry: child.geometry,
				originalMaterial: child.material,
				overlayMaterial: null,
				ownsOverlayMaterial: false,
				geometry: null,
				geometryKey: '',
			} );

		} );



		entry.meshEntries = meshEntries;
		return meshEntries;

	}

	_ensureTileGeometry( entry, heightOffset ) {

		const geometryKey = `${ entry.bounds.join( ',' ) }|${ heightOffset }`;
		if ( entry.geometryKey === geometryKey ) return false;

		for ( const meshEntry of this._ensureMeshEntries( entry ) ) {

			const baseGeometry = meshEntry.originalGeometry ?? meshEntry.sourceMesh.geometry;
			const nextGeometry = this._createProjectedGeometry(
				baseGeometry,
				meshEntry.sourceMesh,
				entry,
				entry.bounds,
				heightOffset,
			);

			if ( meshEntry.geometry && meshEntry.geometry !== meshEntry.originalGeometry ) {

				meshEntry.geometry.dispose();

			}

			meshEntry.geometry = nextGeometry;
			meshEntry.geometryKey = geometryKey;
			meshEntry.sourceMesh.geometry = nextGeometry;

		}

		entry.geometryKey = geometryKey;
		return true;

	}

	_ensureWrappedMaterials( meshEntry ) {

		if ( meshEntry.overlayMaterial ) return meshEntry.overlayMaterial;

		const originalMaterial = meshEntry.originalMaterial ?? meshEntry.sourceMesh.material;
		meshEntry.overlayMaterial = Array.isArray( originalMaterial )
			? originalMaterial.map( cloneOverlayMaterial )
			: cloneOverlayMaterial( originalMaterial );
		meshEntry.ownsOverlayMaterial = false;
		meshEntry.sourceMesh.material = meshEntry.overlayMaterial;



		return meshEntry.overlayMaterial;

	}

	_applyEntryOverlayToMesh( entry, meshEntry ) {

		const opacity = entry.visible && entry.texture ? this.opacity : 0;
		const applyMaterial = material => {

			updateWrappedTiledSdfMaterial( material, entry.texture, entry.bounds, opacity, entry.textureMode );

		};

		if ( Array.isArray( meshEntry.overlayMaterial ) ) {

			meshEntry.overlayMaterial.forEach( applyMaterial );

		} else if ( meshEntry.overlayMaterial ) {

			applyMaterial( meshEntry.overlayMaterial );

		}



	}

	_clearTileOverlay( entry ) {

		if ( entry.texture ) {

			disposeEntryTexture( entry.texture );
			entry.texture = null;

		}

		for ( const meshEntry of entry.meshEntries || [] ) {

			if ( Array.isArray( meshEntry.overlayMaterial ) ) {

				meshEntry.overlayMaterial.forEach( clearWrappedTiledSdfMaterial );

			} else if ( meshEntry.overlayMaterial ) {

				clearWrappedTiledSdfMaterial( meshEntry.overlayMaterial );

			}

		}

	}

	_disposeTileEntry( entry ) {

		this._clearTileOverlay( entry );

		for ( const meshEntry of entry.meshEntries || [] ) {

			if ( meshEntry.sourceMesh && meshEntry.originalGeometry ) {

				meshEntry.sourceMesh.geometry = meshEntry.originalGeometry;

			}

			if ( meshEntry.sourceMesh && meshEntry.originalMaterial ) {

				meshEntry.sourceMesh.material = meshEntry.originalMaterial;

			}

			if ( Array.isArray( meshEntry.overlayMaterial ) ) {

				meshEntry.overlayMaterial.forEach( material => disposeOverlayMaterial( material, meshEntry.ownsOverlayMaterial ) );

			} else if ( meshEntry.overlayMaterial ) {

				disposeOverlayMaterial( meshEntry.overlayMaterial, meshEntry.ownsOverlayMaterial );

			}

			meshEntry.overlayMaterial = null;
			meshEntry.ownsOverlayMaterial = false;

			if ( meshEntry.geometry && meshEntry.geometry !== meshEntry.originalGeometry ) {

				meshEntry.geometry.dispose();

			}

			meshEntry.geometry = null;

		}

		entry.meshEntries = null;
		entry.geometryKey = '';
		entry.shapeKey = '';
		entry.textureMode = 'vector';

	}

	_updateTileBounds( targetId, entry, bounds ) {

		entry.bounds = cloneBounds( bounds );
		this._getTileIndex( targetId ).update( entry.tile, entry.bounds, entry );
		entry.shapeKey = '';
		entry.geometryKey = '';

	}

	_getTileIndex( targetId ) {

		let tileIndex = this._tileIndices.get( targetId );
		if ( ! tileIndex ) {

			tileIndex = new SpatialIndex();
			this._tileIndices.set( targetId, tileIndex );

		}

		return tileIndex;

	}

	_ensureTargetMap( root, targetId ) {

		let map = root.get( targetId );
		if ( ! map ) {

			map = new Map();
			root.set( targetId, map );

		}

		return map;

	}

}
