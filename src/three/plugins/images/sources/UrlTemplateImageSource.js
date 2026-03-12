import { TiledImageSource } from '../sources/TiledImageSource.js';
import { ProjectionScheme } from '../utils/ProjectionScheme.js';
import { MathUtils } from 'three';

const MERCATOR_MIN = - 20037508.342789244;
const MERCATOR_MAX = 20037508.342789244;

/**
 * @typedef {Object} UrlTemplateImageSourceOptions
 * @property {string} url - URL template with placeholders. Supported variables:
 *   `{z}`, `{x}`, `{y}`, `{s}`, `{reverseX}`, `{reverseY}`, `{reverseZ}`,
 *   `{westDegrees}`, `{southDegrees}`, `{eastDegrees}`, `{northDegrees}`,
 *   `{westProjected}`, `{southProjected}`, `{eastProjected}`, `{northProjected}`,
 *   `{width}`, `{height}`.
 * @property {string|string[]} [subdomains='abc'] - Subdomains for `{s}` placeholder rotation.
 *   Can be a string (each character is a subdomain) or an array of strings.
 * @property {number|Object[]} [levels=20] - Number of zoom levels, or an array of per-level
 *   configuration objects with custom `tileCountX`, `tileCountY`, etc.
 * @property {number} [tileDimension=256] - Tile width and height in pixels.
 * @property {string} [projection='EPSG:3857'] - Projection identifier ('EPSG:3857' or 'EPSG:4326').
 * @property {number[]|null} [contentBoundingBox=null] - Content bounding box in degrees
 *   `[west, south, east, north]`. If null, uses full projection bounds.
 * @property {Object<string, (string|function(number, number, number): string)>|null} [customTags=null] -
 *   Custom template variables. Each key maps to a static string or a function `(x, y, level) => value`.
 */

/**
 * Flexible URL template-based image source.
 *
 * Provides a generalized way to load tiles from any service that uses URL templates.
 * Inspired by Cesium's UrlTemplateImageryProvider, it supports a rich set of template
 * variables that cover XYZ tiles, TMS tiles, WMS-style bounding box requests, and
 * arbitrary custom URL patterns.
 *
 * Supported template variables:
 * - `{z}` - Zoom level
 * - `{x}` - Tile X coordinate (0 = westernmost)
 * - `{y}` - Tile Y coordinate (0 = northernmost)
 * - `{s}` - Subdomain (rotated from the subdomains list)
 * - `{reverseX}` - Tile X from the east
 * - `{reverseY}` - Tile Y from the bottom (TMS-style)
 * - `{reverseZ}` - Inverted zoom level (maximumLevel - level)
 * - `{westDegrees}`, `{southDegrees}`, `{eastDegrees}`, `{northDegrees}` - Tile bbox in degrees
 * - `{westProjected}`, `{southProjected}`, `{eastProjected}`, `{northProjected}` - Tile bbox in projected coords
 * - `{width}`, `{height}` - Tile pixel dimensions
 *
 * Custom tags can be provided via the `customTags` option, where each key maps to either
 * a static value or a function `(x, y, level) => value`.
 *
 * Note: `contentBoundingBox` is specified in degrees `[west, south, east, north]`
 * and converted to radians internally.
 *
 * @extends TiledImageSource
 */
export class UrlTemplateImageSource extends TiledImageSource {

	/**
	 * @param {UrlTemplateImageSourceOptions} options - Configuration options.
	 */
	constructor( options = {} ) {

		const {
			url = null,
			subdomains = 'abc',
			levels = 20,
			tileDimension = 256,
			projection = 'EPSG:3857',
			contentBoundingBox = null,
			customTags = null,
			...rest
		} = options;

		super( rest );

		this.url = url;
		this.subdomains = Array.isArray( subdomains ) ? subdomains.slice() : subdomains.split( '' );
		this.levels = levels;
		this.tileDimension = tileDimension;
		this.projection = projection;
		this.contentBoundingBox = contentBoundingBox;
		this.customTags = customTags;

	}

	normalizedToMercator( v ) {

		return MathUtils.mapLinear( v, 0, 1, MERCATOR_MIN, MERCATOR_MAX );

	}

	getUrl( x, y, level ) {

		const { tiling, subdomains, customTags, tileDimension } = this;
		let url = this.url;

		// Basic tile coordinates
		url = url.replace( /{\s*z\s*}/gi, level );
		url = url.replace( /{\s*x\s*}/gi, x );
		url = url.replace( /{\s*y\s*}/gi, y );

		// Subdomain rotation
		if ( subdomains.length > 0 ) {

			const index = ( x + y + level ) % subdomains.length;
			url = url.replace( /{\s*s\s*}/gi, subdomains[ index ] );

		}

		// Reverse coordinates
		const levelInfo = tiling.getLevel( level );
		if ( levelInfo ) {

			url = url.replace( /{\s*reverseX\s*}/gi, levelInfo.tileCountX - x - 1 );
			url = url.replace( /{\s*reverseY\s*}/gi, levelInfo.tileCountY - y - 1 );

		}

		url = url.replace( /{\s*reverseZ\s*}/gi, tiling.maxLevel - level );

		// Tile pixel dimensions
		url = url.replace( /{\s*width\s*}/gi, tileDimension );
		url = url.replace( /{\s*height\s*}/gi, tileDimension );

		// Geographic bounding box in degrees
		const needsDegrees = /{\s*(west|south|east|north)Degrees\s*}/i.test( url );
		const needsProjected = /{\s*(west|south|east|north)Projected\s*}/i.test( url );

		if ( needsDegrees || needsProjected ) {

			// Non-normalized returns radians (lon/lat)
			const radBounds = tiling.getTileBounds( x, y, level, false, false );
			const [ minLon, minLat, maxLon, maxLat ] = radBounds;

			if ( needsDegrees ) {

				url = url.replace( /{\s*westDegrees\s*}/gi, minLon * MathUtils.RAD2DEG );
				url = url.replace( /{\s*southDegrees\s*}/gi, minLat * MathUtils.RAD2DEG );
				url = url.replace( /{\s*eastDegrees\s*}/gi, maxLon * MathUtils.RAD2DEG );
				url = url.replace( /{\s*northDegrees\s*}/gi, maxLat * MathUtils.RAD2DEG );

			}

			if ( needsProjected ) {

				if ( tiling.projection.isMercator ) {

					// For mercator, projected coords are in meters
					const normBounds = tiling.getTileBounds( x, y, level, true, false );
					url = url.replace( /{\s*westProjected\s*}/gi, this.normalizedToMercator( normBounds[ 0 ] ) );
					url = url.replace( /{\s*southProjected\s*}/gi, this.normalizedToMercator( normBounds[ 1 ] ) );
					url = url.replace( /{\s*eastProjected\s*}/gi, this.normalizedToMercator( normBounds[ 2 ] ) );
					url = url.replace( /{\s*northProjected\s*}/gi, this.normalizedToMercator( normBounds[ 3 ] ) );

				} else {

					// For geographic, projected coords are in degrees
					url = url.replace( /{\s*westProjected\s*}/gi, minLon * MathUtils.RAD2DEG );
					url = url.replace( /{\s*southProjected\s*}/gi, minLat * MathUtils.RAD2DEG );
					url = url.replace( /{\s*eastProjected\s*}/gi, maxLon * MathUtils.RAD2DEG );
					url = url.replace( /{\s*northProjected\s*}/gi, maxLat * MathUtils.RAD2DEG );

				}

			}

		}

		// Custom tags
		if ( customTags ) {

			for ( const key in customTags ) {

				const tagValue = typeof customTags[ key ] === 'function'
					? customTags[ key ]( x, y, level )
					: customTags[ key ];
				url = url.replace( new RegExp( `{\\s*${ key }\\s*}`, 'gi' ), tagValue );

			}

		}

		return url;

	}

	init() {

		const { tiling, tileDimension, levels, url, projection, contentBoundingBox } = this;

		// Detect Y-axis orientation from URL template
		tiling.flipY = ! /{\s*(reverseY|-\s*y)\s*}/g.test( url );

		tiling.setProjection( new ProjectionScheme( projection ) );

		if ( contentBoundingBox !== null ) {

			// contentBoundingBox is in degrees [west, south, east, north]; convert to radians
			tiling.setContentBounds(
				contentBoundingBox[ 0 ] * MathUtils.DEG2RAD,
				contentBoundingBox[ 1 ] * MathUtils.DEG2RAD,
				contentBoundingBox[ 2 ] * MathUtils.DEG2RAD,
				contentBoundingBox[ 3 ] * MathUtils.DEG2RAD,
			);

		} else {

			tiling.setContentBounds( ...tiling.projection.getBounds() );

		}

		if ( Array.isArray( levels ) ) {

			levels.forEach( ( info, level ) => {

				if ( info !== null ) {

					tiling.setLevel( level, {
						tilePixelWidth: tileDimension,
						tilePixelHeight: tileDimension,
						...info,
					} );

				}

			} );

		} else {

			tiling.generateLevels(
				levels,
				tiling.projection.tileCountX,
				tiling.projection.tileCountY,
				{
					tilePixelWidth: tileDimension,
					tilePixelHeight: tileDimension,
				},
			);

		}

		return Promise.resolve();

	}

}
