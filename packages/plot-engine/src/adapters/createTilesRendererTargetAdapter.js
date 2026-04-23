import {
	Matrix4,
	Vector3,
} from 'three';

const RAD2DEG = 180 / Math.PI;

const _inverseMatrix = /* @__PURE__ */ new Matrix4();
const _meshMatrix = /* @__PURE__ */ new Matrix4();
const _position = /* @__PURE__ */ new Vector3();
const _cartographic = {};

function tileRegionToDegrees( region ) {

	if ( ! region || region.length < 4 ) return null;
	return [
		region[ 0 ] * RAD2DEG,
		region[ 1 ] * RAD2DEG,
		region[ 2 ] * RAD2DEG,
		region[ 3 ] * RAD2DEG,
	];

}

function getTilesRendererSource( target ) {

	return target?.source ?? target?.tilesRenderer ?? null;

}

function getCartographicSceneBounds( source, scene ) {

	const ellipsoid = source?.ellipsoid;
	const group = source?.group;
	if ( ! ellipsoid || ! group || ! scene ) return null;

	group.updateMatrixWorld?.( true );
	scene.updateMatrixWorld?.( true );

	if ( group.matrixWorldInverse ) {

		_inverseMatrix.copy( group.matrixWorldInverse );

	} else {

		group.updateMatrixWorld?.( true );
		_inverseMatrix.copy( group.matrixWorld ).invert();

	}

	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = - Infinity;
	let maxLat = - Infinity;
	let hasVertex = false;

	scene.traverse?.( child => {

		if ( ! child.isMesh || ! child.geometry ) return;

		const positionAttribute = child.geometry.getAttribute?.( 'position' );
		if ( ! positionAttribute ) return;

		child.updateMatrixWorld?.( true );
		_meshMatrix.copy( child.matrixWorld ).premultiply( _inverseMatrix );

		for ( let index = 0; index < positionAttribute.count; index ++ ) {

			_position.fromBufferAttribute( positionAttribute, index ).applyMatrix4( _meshMatrix );
			ellipsoid.getPositionToCartographic( _position, _cartographic );

			const lon = _cartographic.lon * RAD2DEG;
			const lat = _cartographic.lat * RAD2DEG;
			if ( ! Number.isFinite( lon ) || ! Number.isFinite( lat ) ) continue;

			hasVertex = true;
			minLon = Math.min( minLon, lon );
			minLat = Math.min( minLat, lat );
			maxLon = Math.max( maxLon, lon );
			maxLat = Math.max( maxLat, lat );

		}

	} );

	if (
		! hasVertex ||
		! Number.isFinite( minLon ) ||
		! Number.isFinite( minLat ) ||
		! Number.isFinite( maxLon ) ||
		! Number.isFinite( maxLat )
	) {

		return null;

	}

	return [ minLon, minLat, maxLon, maxLat ];

}

export function createTilesRendererTargetAdapter() {

	return {
		name: 'tiles-renderer',

		connect( tilesRenderer, callbacks ) {

			const toEntry = ( scene, tile ) => ( {
				key: tile,
				scene,
				visible: tile?.traversal?.visible !== false,
				data: { tile },
			} );

			const onLoad = event => {

				callbacks.onEntryLoad?.( toEntry( event.scene, event.tile ) );

			};

			const onDispose = event => {

				callbacks.onEntryDispose?.( event.tile );

			};

			const onVisibilityChange = event => {

				callbacks.onEntryVisibilityChange?.( event.tile, event.visible );

			};

			tilesRenderer.addEventListener?.( 'load-model', onLoad );
			tilesRenderer.addEventListener?.( 'dispose-model', onDispose );
			tilesRenderer.addEventListener?.( 'tile-visibility-change', onVisibilityChange );
			tilesRenderer.forEachLoadedModel?.( ( scene, tile ) => {

				callbacks.onEntryLoad?.( toEntry( scene, tile ) );

			} );

			return () => {

				tilesRenderer.removeEventListener?.( 'load-model', onLoad );
				tilesRenderer.removeEventListener?.( 'dispose-model', onDispose );
				tilesRenderer.removeEventListener?.( 'tile-visibility-change', onVisibilityChange );

			};

		},

		getEntryBounds( entry, target ) {

			const tile = entry?.data?.tile ?? entry?.key;
			const source = getTilesRendererSource( target );
			const customBounds = target.options.getTileBounds?.( tile, entry.scene, target );
			if ( customBounds ) return customBounds;

			const regionBounds = tileRegionToDegrees( tile?.boundingVolume?.region );
			if ( regionBounds ) return regionBounds;

			const geoReferenceKind = target.options.geoReference?.kind;
			if ( geoReferenceKind === 'cartographic' || geoReferenceKind === 'placed-cartographic' ) {

				const cartographicBounds = getCartographicSceneBounds( source, entry.scene );
				if ( cartographicBounds ) return cartographicBounds;

			}

			return null;

		},

		projectPosition( worldPosition, entry, target, out = [ 0, 0, 0 ] ) {

			const source = getTilesRendererSource( target );
			const ellipsoid = source?.ellipsoid;
			const group = source?.group;

			if ( ellipsoid && group ) {

				if ( group.matrixWorldInverse ) {

					_inverseMatrix.copy( group.matrixWorldInverse );

				} else {

					group.updateMatrixWorld?.( true );
					_inverseMatrix.copy( group.matrixWorld ).invert();

				}

				_position.copy( worldPosition ).applyMatrix4( _inverseMatrix );
				ellipsoid.getPositionToCartographic( _position, _cartographic );

				const lon = _cartographic.lon * RAD2DEG;
				const lat = _cartographic.lat * RAD2DEG;
				if ( ! Number.isFinite( lon ) || ! Number.isFinite( lat ) ) return null;

				out[ 0 ] = lon;
				out[ 1 ] = lat;
				out[ 2 ] = Number( _cartographic.height ?? 0 );
				return out;

			}

			out[ 0 ] = worldPosition.x;
			out[ 1 ] = worldPosition.z;
			out[ 2 ] = worldPosition.y;
			return out;

		},
	};

}
