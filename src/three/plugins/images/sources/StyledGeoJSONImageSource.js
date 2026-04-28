import { CanvasTexture, MathUtils, SRGBColorSpace, Vector3 } from 'three';
import RBush from 'rbush';
import { WGS84_ELLIPSOID } from 'um-3d-tiles-renderer/three';
import { GeoJSONImageSource } from './GeoJSONImageSource.js';

// 计算指定经纬度附近的经向和纬向弧长比例。
// 画点时使用这个比例修正椭圆宽高, 避免高纬度区域的圆点被贴图投影拉伸。
const _v0 = /* @__PURE__ */ new Vector3();
const _v1 = /* @__PURE__ */ new Vector3();
function calculateArcRatioAtPoint( ellipsoid, lat, lon ) {

	const DELTA = 0.01;
	ellipsoid.getCartographicToPosition( lat, lon, 0, _v0 );
	ellipsoid.getCartographicToPosition( lat + DELTA, lon, 0, _v1 );

	const latDelta = _v0.distanceTo( _v1 );
	ellipsoid.getCartographicToPosition( lat, lon + DELTA, 0, _v1 );

	const lonDelta = _v0.distanceTo( _v1 );
	return lonDelta / latDelta;

}

// 新样式机制只读取这些 camelCase 字段。
// 这样可以避免把业务属性误当成 Canvas 样式, 也便于后续维护类型声明。
const STYLE_KEYS = [
	'visible',
	'zIndex',
	'opacity',
	'fillStyle',
	'fillOpacity',
	'strokeStyle',
	'strokeWidth',
	'strokeOpacity',
	'lineDash',
	'lineCap',
	'lineJoin',
	'pointRadius',
	'pointOpacity',
	'pointFillStyle',
	'pointStrokeStyle',
	'pointStrokeWidth',
];

const VALID_LINE_CAPS = new Set( [ 'butt', 'round', 'square' ] );
const VALID_LINE_JOINS = new Set( [ 'round', 'bevel', 'miter' ] );
const MIN_POINT_ASPECT_RATIO = 0.25;
const MAX_POINT_ASPECT_RATIO = 4;
const PROJECTED_POINT_CLAMP_RATIO = 4;

function getDefinedValue( value, fallback ) {

	return value !== undefined ? value : fallback;

}

function getNumberValue( value, fallback ) {

	const result = Number( value );
	return Number.isFinite( result ) ? result : fallback;

}

function getOpacityValue( value, fallback ) {

	return MathUtils.clamp( getNumberValue( value, fallback ), 0, 1 );

}

function getLineDashValue( value, fallback ) {

	if ( Array.isArray( value ) ) {

		return value.map( v => Math.max( 0, getNumberValue( v, 0 ) ) );

	} else if ( Array.isArray( fallback ) ) {

		return [ ...fallback ];

	} else {

		return [];

	}

}

function getLineCapValue( value, fallback ) {

	return VALID_LINE_CAPS.has( value ) ? value : fallback;

}

function getLineJoinValue( value, fallback ) {

	return VALID_LINE_JOINS.has( value ) ? value : fallback;

}

function getNormalizedBounds( bounds ) {

	if ( ! bounds || bounds.some( v => ! Number.isFinite( v ) ) ) {

		return null;

	}

	const [ x0, y0, x1, y1 ] = bounds;
	return [
		Math.min( x0, x1 ),
		Math.min( y0, y1 ),
		Math.max( x0, x1 ),
		Math.max( y0, y1 ),
	];

}

function expandBounds( bounds, padX, padY ) {

	if ( bounds === null ) {

		return null;

	}

	const [ minX, minY, maxX, maxY ] = bounds;
	return [ minX - padX, minY - padY, maxX + padX, maxY + padY ];

}

function boundsToItem( bounds, target = {} ) {

	const [ minX, minY, maxX, maxY ] = bounds;
	target.minX = minX;
	target.minY = minY;
	target.maxX = maxX;
	target.maxY = maxY;
	return target;

}

/**
 * 带样式和空间索引的 GeoJSON 影像源。
 *
 * 这个类是 GeoJSONImageSource 的增强版本, 独立放在新文件中, 不修改旧类行为。
 * 旧类在每个瓦片绘制时会遍历所有 feature, 当 feature 很多时会变慢。
 * 这里使用 rbush 为 feature bounds 建立 R-tree, 每次只查询当前瓦片范围内可能命中的 feature。
 *
 * 类内部还维护 feature 与已缓存瓦片的双向关系。单个 feature 被修改后, 可以只重绘
 * 受影响的缓存瓦片, 不需要整张 overlay 全量刷新。
 */
export class StyledGeoJSONImageSource extends GeoJSONImageSource {

	constructor( options = {} ) {

		super( options );

		const {
			defaultStyle = {},
		} = options;

		// defaultStyle 是所有 feature 的基础样式。这里用旧构造参数作为默认值,
		// 这样从旧 GeoJSONOverlay 迁移时, 常用的颜色和线宽设置不会突然失效。
		this.defaultStyle = this._resolveStyle( {
			visible: true,
			zIndex: 0,
			opacity: 1,
			fillStyle: this.fillStyle,
			fillOpacity: 1,
			strokeStyle: this.strokeStyle,
			strokeWidth: this.strokeWidth,
			strokeOpacity: 1,
			lineDash: [],
			lineCap: 'butt',
			lineJoin: 'miter',
			pointRadius: this.pointRadius,
			pointOpacity: 1,
			pointFillStyle: null,
			pointStrokeStyle: null,
			pointStrokeWidth: null,
		}, defaultStyle );

		// renderIndex 存储可绘制 feature 的 bounds。瓦片绘制和 hasContent 都走这个索引。
		this.renderIndex = new RBush();

		// tileIndex 存储当前 DataCache 中已经创建的纹理瓦片。局部刷新时用它找受影响瓦片。
		this.tileIndex = new RBush();

		// idIndex 用 feature.id 或 feature.properties.id 定位 feature record。
		this.idIndex = new Map();

		// featureRecordMap 允许通过原始 feature 对象快速找到内部 record。
		this.featureRecordMap = new WeakMap();

		// tileRecords 保存缓存纹理对应的瓦片信息。key 与 DataCache 的 token hash 保持一致。
		this.tileRecords = new Map();
		this.textureTileRecords = new WeakMap();

		this.featureRecords = [];
		this.maxStylePaddingPixels = 0;
		this._cacheBuilt = false;

		// 这些统计字段给手动示例页使用, 不参与渲染逻辑。
		this.lastQueriedFeatureCount = 0;
		this.lastDrawnFeatureCount = 0;
		this.lastRedrawTileCount = 0;
		this.totalTileRedraws = 0;

	}

	/**
	 * 替换整个 GeoJSON 数据。
	 *
	 * 这个方法会重建所有 feature record 和 rbush 索引。如果 redraw 为 true,
	 * 已缓存的 overlay 纹理会全部重绘。
	 */
	setGeoJSON( geojson, { redraw = true } = {} ) {

		this.geojson = geojson;
		this._updateCache( true );

		if ( redraw ) {

			this.redraw( false );

		}

	}

	/**
	 * 通过 id 获取原始 GeoJSON feature。
	 *
	 * id 优先读取 feature.id, 如果没有则读取 feature.properties.id。
	 * 重复 id 会导致按 id 更新不安全, 因此这里会抛出错误提醒调用方先修正数据。
	 */
	getFeatureById( id ) {

		const record = this._getUniqueRecordById( id );
		return record ? record.feature : null;

	}

	/**
	 * 同步外部已经直接修改过的 feature。
	 *
	 * 如果业务代码直接改了 feature.geometry 或 feature.properties, 调用这个方法可以让
	 * bounds, style, idIndex, renderIndex 和显示纹理一起更新。
	 */
	syncFeature( feature, { redraw = true } = {} ) {

		this._updateCache();

		const record = this.featureRecordMap.get( feature );
		if ( ! record ) {

			throw new Error( 'StyledGeoJSONImageSource: Cannot sync a feature that is not part of this geojson.' );

		}

		this._syncRecord( record, redraw );
		return feature;

	}

	/**
	 * 通过 id 同步外部已经直接修改过的 feature。
	 */
	syncFeatureById( id, options = {} ) {

		const record = this._getUniqueRecordById( id );
		if ( ! record ) {

			throw new Error( `StyledGeoJSONImageSource: Feature id "${ id }" was not found.` );

		}

		this.syncFeature( record.feature, options );
		return record.feature;

	}

	/**
	 * 更新指定 feature。
	 *
	 * patchOrUpdater 可以是对象, 也可以是函数。对象支持 geometry, properties, style 三个字段。
	 * style 会合并进 feature.properties, 这是最常用的单要素样式更新入口。
	 */
	updateFeature( feature, patchOrUpdater, { redraw = true } = {} ) {

		this._updateCache();

		const record = this.featureRecordMap.get( feature );
		if ( ! record ) {

			throw new Error( 'StyledGeoJSONImageSource: Cannot update a feature that is not part of this geojson.' );

		}

		const patch = typeof patchOrUpdater === 'function' ? patchOrUpdater( feature ) : patchOrUpdater;
		if ( patch ) {

			this._applyFeaturePatch( feature, patch );

		}

		this._syncRecord( record, redraw );
		return feature;

	}

	/**
	 * 通过 id 更新指定 feature。
	 */
	updateFeatureById( id, patchOrUpdater, options = {} ) {

		const record = this._getUniqueRecordById( id );
		if ( ! record ) {

			throw new Error( `StyledGeoJSONImageSource: Feature id "${ id }" was not found.` );

		}

		return this.updateFeature( record.feature, patchOrUpdater, options );

	}

	/**
	 * 通过 id 更新 feature.properties 中的样式字段。
	 */
	updateFeatureStyleById( id, stylePatch, options = {} ) {

		return this.updateFeatureById( id, { style: stylePatch }, options );

	}

	/**
	 * 批量更新多个 feature.properties 中的样式字段。
	 *
	 * 这个方法会先收集所有受影响瓦片, 最后统一重绘一次。
	 * 用于 GUI 连续修改颜色、透明度、zIndex 等样式时减少重复 canvas 绘制。
	 */
	updateFeatureStylesByIds( ids, stylePatch, { redraw = true } = {} ) {

		this._updateCache();

		const affectedTiles = new Set();
		const features = [];
		for ( const id of ids ) {

			const record = this._getUniqueRecordById( id );
			if ( ! record ) {

				throw new Error( `StyledGeoJSONImageSource: Feature id "${ id }" was not found.` );

			}

			this._applyFeaturePatch( record.feature, { style: stylePatch } );
			this._syncRecord( record, false, affectedTiles );
			features.push( record.feature );

		}

		if ( redraw ) {

			this._redrawTileRecords( affectedTiles );

		}

		return features;

	}

	/**
	 * 通过 id 更新 feature.geometry。
	 */
	updateFeatureGeometryById( id, geometry, options = {} ) {

		return this.updateFeatureById( id, { geometry }, options );

	}

	hasContent( minX, minY, maxX, maxY ) {

		this._updateCache();

		const boundsDeg = this._getTileBoundsDegFromTokens( [ minX, minY, maxX, maxY ] );
		const searchBounds = this._getPaddedTileBounds( boundsDeg );
		return this.renderIndex.search( boundsToItem( searchBounds ) ).length > 0;

	}

	async fetchItem( tokens, signal ) {

		const canvas = document.createElement( 'canvas' );
		const tex = new CanvasTexture( canvas );
		tex.colorSpace = SRGBColorSpace;
		tex.generateMipmaps = false;

		this._trackTileTexture( tokens, tex );
		this._drawToCanvas( canvas, tokens );
		tex.needsUpdate = true;

		return tex;

	}

	disposeItem( texture ) {

		this._untrackTileTexture( texture );
		super.disposeItem( texture );

	}

	dispose() {

		super.dispose();

		this.renderIndex.clear();
		this.tileIndex.clear();
		this.idIndex.clear();
		this.tileRecords.clear();
		this.featureRecords.length = 0;
		this._cacheBuilt = false;

	}

	redraw( rebuild = true ) {

		if ( rebuild ) {

			this._updateCache( true );

		}

		const records = [ ...this.tileRecords.values() ];
		this._redrawTileRecords( records );

	}

	_updateCache( force = false ) {

		const { geojson } = this;
		if ( ! geojson || ( this._cacheBuilt && ! force ) ) {

			return;

		}

		this._clearAllTileFeatureLinks();
		this.renderIndex.clear();
		this.idIndex.clear();
		this.featureBounds.clear();
		this.featureRecordMap = new WeakMap();
		this.featureRecords = [];
		this.features = this._featuresFromGeoJSON( geojson );

		let order = 0;
		let contentBounds = null;
		let maxStylePaddingPixels = 0;
		const indexedRecords = [];

		for ( const feature of this.features ) {

			const record = this._createFeatureRecord( feature, order ++ );
			this.featureRecords.push( record );
			this.featureRecordMap.set( feature, record );
			this.featureBounds.set( feature, record.bounds );
			this._addRecordId( record );

			if ( this._isRecordDrawable( record ) ) {

				indexedRecords.push( record );
				record.indexed = true;
				contentBounds = this._unionBounds( contentBounds, record.bounds );
				maxStylePaddingPixels = Math.max( maxStylePaddingPixels, this._getFeatureStylePaddingPixels( record ) );

			}

		}

		this.contentBounds = contentBounds;
		this.maxStylePaddingPixels = maxStylePaddingPixels;
		this.renderIndex.load( indexedRecords );
		this._refreshTileIndexPadding();
		this._cacheBuilt = true;

	}

	_drawToCanvas( canvas, tokens ) {

		this._updateCache();

		const tileRecord = this.tileRecords.get( this._getTileKey( tokens ) ) || null;
		if ( tileRecord ) {

			this._clearTileFeatureLinks( tileRecord );

		}

		const [ minX, minY, maxX, maxY ] = tokens;
		const { projection, resolution } = this;

		canvas.width = resolution;
		canvas.height = resolution;

		const minLonRad = projection.convertNormalizedToLongitude( minX );
		const minLatRad = projection.convertNormalizedToLatitude( minY );
		const maxLonRad = projection.convertNormalizedToLongitude( maxX );
		const maxLatRad = projection.convertNormalizedToLatitude( maxY );
		const regionBoundsDeg = getNormalizedBounds( [
			minLonRad * MathUtils.RAD2DEG,
			minLatRad * MathUtils.RAD2DEG,
			maxLonRad * MathUtils.RAD2DEG,
			maxLatRad * MathUtils.RAD2DEG,
		] );

		const ctx = canvas.getContext( '2d' );
		ctx.clearRect( 0, 0, canvas.width, canvas.height );

		const searchBounds = this._getPaddedTileBounds( regionBoundsDeg );
		const records = this.renderIndex
			.search( boundsToItem( searchBounds ) )
			.sort( ( a, b ) => a.style.zIndex - b.style.zIndex || a.order - b.order );

		let drawCount = 0;
		for ( let i = 0; i < records.length; i ++ ) {

			const record = records[ i ];
			if ( this._drawStyledFeatureOnCanvas( ctx, record, regionBoundsDeg, canvas.width, canvas.height ) ) {

				drawCount ++;
				if ( tileRecord ) {

					tileRecord.featureRecords.add( record );
					record.tiles.add( tileRecord );

				}

			}

		}

		this.lastQueriedFeatureCount = records.length;
		this.lastDrawnFeatureCount = drawCount;

	}

	_createFeatureRecord( feature, order ) {

		const style = this._getFeatureStyle( feature );
		const bounds = getNormalizedBounds( this._getFeatureBoundsRecursive( feature ) );
		const record = {
			feature,
			order,
			id: this._getFeatureId( feature ),
			style,
			bounds,
			geometryKinds: this._getGeometryKinds( feature.geometry ),
			indexed: false,
			tiles: new Set(),
			minX: 0,
			minY: 0,
			maxX: 0,
			maxY: 0,
		};

		if ( bounds ) {

			boundsToItem( bounds, record );

		}

		return record;

	}

	_syncRecord( record, redraw, affectedTiles = null ) {

		const oldBounds = record.bounds;
		const oldTiles = new Set( record.tiles );

		this._removeRecordFromRenderIndex( record );
		this._removeRecordId( record );
		this._clearRecordTileLinks( record );

		const feature = record.feature;
		const style = this._getFeatureStyle( feature );
		const bounds = getNormalizedBounds( this._getFeatureBoundsRecursive( feature ) );

		record.id = this._getFeatureId( feature );
		record.style = style;
		record.bounds = bounds;
		record.geometryKinds = this._getGeometryKinds( feature.geometry );
		record.minX = 0;
		record.minY = 0;
		record.maxX = 0;
		record.maxY = 0;

		if ( bounds ) {

			boundsToItem( bounds, record );

		}

		this.featureBounds.set( feature, bounds );
		this._addRecordId( record );

		if ( this._isRecordDrawable( record ) ) {

			this.renderIndex.insert( record );
			record.indexed = true;

		}

		this._recalculateContentState();

		if ( redraw || affectedTiles ) {

			const targetTiles = affectedTiles || new Set();
			oldTiles.forEach( tileRecord => targetTiles.add( tileRecord ) );
			this._searchTileRecordsByBounds( oldBounds, targetTiles );
			this._searchTileRecordsByBounds( bounds, targetTiles );
			if ( redraw ) {

				this._redrawTileRecords( targetTiles );

			}

		}

	}

	_applyFeaturePatch( feature, patch ) {

		if ( patch.geometry !== undefined ) {

			feature.geometry = patch.geometry;

		}

		if ( patch.properties !== undefined ) {

			feature.properties = {
				...( feature.properties || {} ),
				...patch.properties,
			};

		}

		if ( patch.style !== undefined ) {

			feature.properties = {
				...( feature.properties || {} ),
				...patch.style,
			};

		}

	}

	_getFeatureStyle( feature ) {

		const properties = feature && feature.properties || {};
		const propertyStyle = {};

		// 只读取明确声明的 camelCase 样式字段, 避免普通业务属性被误当成 Canvas 样式。
		for ( let i = 0; i < STYLE_KEYS.length; i ++ ) {

			const key = STYLE_KEYS[ i ];
			if ( properties[ key ] !== undefined ) {

				propertyStyle[ key ] = properties[ key ];

			}

		}

		return this._resolveStyle( this.defaultStyle, propertyStyle );

	}

	_resolveStyle( base, overrides = {} ) {

		const style = {};
		for ( let i = 0; i < STYLE_KEYS.length; i ++ ) {

			const key = STYLE_KEYS[ i ];
			style[ key ] = getDefinedValue( overrides[ key ], base[ key ] );

		}

		style.visible = style.visible !== false;
		style.zIndex = getNumberValue( style.zIndex, 0 );
		style.opacity = getOpacityValue( style.opacity, 1 );
		style.fillOpacity = getOpacityValue( style.fillOpacity, 1 );
		style.strokeWidth = Math.max( 0, getNumberValue( style.strokeWidth, 0 ) );
		style.strokeOpacity = getOpacityValue( style.strokeOpacity, 1 );
		style.lineDash = getLineDashValue( style.lineDash, [] );
		style.lineCap = getLineCapValue( style.lineCap, 'butt' );
		style.lineJoin = getLineJoinValue( style.lineJoin, 'miter' );
		style.pointRadius = Math.max( 0, getNumberValue( style.pointRadius, 0 ) );
		style.pointOpacity = getOpacityValue( style.pointOpacity, 1 );
		style.pointStrokeWidth = style.pointStrokeWidth === null ?
			null :
			Math.max( 0, getNumberValue( style.pointStrokeWidth, 0 ) );

		return style;

	}

	_getFeatureId( feature ) {

		if ( ! feature ) {

			return null;

		}

		if ( feature.id !== undefined && feature.id !== null ) {

			return feature.id;

		}

		const properties = feature.properties || {};
		return properties.id !== undefined && properties.id !== null ? properties.id : null;

	}

	_addRecordId( record ) {

		const { id } = record;
		if ( id === null ) {

			return;

		}

		const existing = this.idIndex.get( id );
		if ( existing === undefined ) {

			this.idIndex.set( id, record );

		} else if ( Array.isArray( existing ) ) {

			existing.push( record );

		} else {

			this.idIndex.set( id, [ existing, record ] );

		}

	}

	_removeRecordId( record ) {

		const { id } = record;
		if ( id === null || ! this.idIndex.has( id ) ) {

			return;

		}

		const existing = this.idIndex.get( id );
		if ( existing === record ) {

			this.idIndex.delete( id );

		} else if ( Array.isArray( existing ) ) {

			const index = existing.indexOf( record );
			if ( index !== - 1 ) {

				existing.splice( index, 1 );

			}

			if ( existing.length === 1 ) {

				this.idIndex.set( id, existing[ 0 ] );

			} else if ( existing.length === 0 ) {

				this.idIndex.delete( id );

			}

		}

	}

	_getUniqueRecordById( id ) {

		this._updateCache();

		const result = this.idIndex.get( id );
		if ( Array.isArray( result ) ) {

			throw new Error( `StyledGeoJSONImageSource: Feature id "${ id }" is used by multiple features.` );

		}

		return result || null;

	}

	_removeRecordFromRenderIndex( record ) {

		if ( record.indexed ) {

			this.renderIndex.remove( record );
			record.indexed = false;

		}

	}

	_isRecordDrawable( record ) {

		const { bounds, style, geometryKinds } = record;
		if ( ! bounds || ! style.visible || style.opacity <= 0 ) {

			return false;

		}

		const hasStroke = style.strokeStyle !== null && style.strokeWidth > 0 && style.strokeOpacity > 0;
		const hasFill = style.fillStyle !== null && style.fillOpacity > 0;
		const pointStrokeStyle = style.pointStrokeStyle !== null ? style.pointStrokeStyle : style.strokeStyle;
		const pointStrokeWidth = style.pointStrokeWidth !== null ? style.pointStrokeWidth : style.strokeWidth;
		const pointFillStyle = style.pointFillStyle !== null ? style.pointFillStyle : style.fillStyle;
		const hasPointFill = pointFillStyle !== null && style.fillOpacity > 0;
		const hasPointStroke = pointStrokeStyle !== null && pointStrokeWidth > 0 && style.strokeOpacity > 0;

		return (
			geometryKinds.point && style.pointRadius > 0 && style.pointOpacity > 0 && ( hasPointFill || hasPointStroke ) ||
			geometryKinds.line && hasStroke ||
			geometryKinds.polygon && ( hasFill || hasStroke )
		);

	}

	_getFeatureStylePaddingPixels( record ) {

		const { style, geometryKinds } = record;
		let result = 0;

		if ( geometryKinds.point && style.pointRadius > 0 ) {

			const pointStrokeWidth = style.pointStrokeWidth !== null ? style.pointStrokeWidth : style.strokeWidth;
			result = Math.max( result, style.pointRadius + pointStrokeWidth * 0.5 );

		}

		if ( geometryKinds.line || geometryKinds.polygon ) {

			result = Math.max( result, style.strokeWidth * 0.5 );

		}

		return result;

	}

	_recalculateContentState() {

		let contentBounds = null;
		let maxStylePaddingPixels = 0;

		for ( let i = 0; i < this.featureRecords.length; i ++ ) {

			const record = this.featureRecords[ i ];
			if ( this._isRecordDrawable( record ) ) {

				contentBounds = this._unionBounds( contentBounds, record.bounds );
				maxStylePaddingPixels = Math.max( maxStylePaddingPixels, this._getFeatureStylePaddingPixels( record ) );

			}

		}

		this.contentBounds = contentBounds;
		this.maxStylePaddingPixels = maxStylePaddingPixels;
		this._refreshTileIndexPadding();

	}

	_unionBounds( a, b ) {

		if ( ! b ) {

			return a;

		}

		if ( ! a ) {

			return [ ...b ];

		}

		a[ 0 ] = Math.min( a[ 0 ], b[ 0 ] );
		a[ 1 ] = Math.min( a[ 1 ], b[ 1 ] );
		a[ 2 ] = Math.max( a[ 2 ], b[ 2 ] );
		a[ 3 ] = Math.max( a[ 3 ], b[ 3 ] );
		return a;

	}

	_getGeometryKinds( geometry, target = { point: false, line: false, polygon: false } ) {

		if ( ! geometry ) {

			return target;

		}

		switch ( geometry.type ) {

			case 'Point':
			case 'MultiPoint':
				target.point = true;
				break;
			case 'LineString':
			case 'MultiLineString':
				target.line = true;
				break;
			case 'Polygon':
			case 'MultiPolygon':
				target.polygon = true;
				break;
			case 'GeometryCollection':
				geometry.geometries.forEach( child => this._getGeometryKinds( child, target ) );
				break;

		}

		return target;

	}

	_getFeatureBoundsRecursive( feature ) {

		let bounds = null;

		this._forEachGeometry( feature.geometry, geometry => {

			bounds = this._unionBounds( bounds, this._getGeometryBounds( geometry ) );

		} );

		return bounds;

	}

	_getGeometryBounds( geometry ) {

		if ( ! geometry || geometry.type === 'GeometryCollection' ) {

			return null;

		}

		return super._getFeatureBounds( {
			type: 'Feature',
			geometry,
			properties: {},
		} );

	}

	_forEachGeometry( geometry, callback ) {

		if ( ! geometry ) {

			return;

		}

		if ( geometry.type === 'GeometryCollection' ) {

			geometry.geometries.forEach( child => this._forEachGeometry( child, callback ) );

		} else {

			callback( geometry );

		}

	}

	_getTileKey( tokens ) {

		return tokens.join( '_' );

	}

	_getTileBoundsDegFromTokens( tokens ) {

		const [ minX, minY, maxX, maxY ] = tokens;
		const { projection } = this;
		return getNormalizedBounds( [
			projection.convertNormalizedToLongitude( minX ) * MathUtils.RAD2DEG,
			projection.convertNormalizedToLatitude( minY ) * MathUtils.RAD2DEG,
			projection.convertNormalizedToLongitude( maxX ) * MathUtils.RAD2DEG,
			projection.convertNormalizedToLatitude( maxY ) * MathUtils.RAD2DEG,
		] );

	}

	_getPaddedTileBounds( bounds ) {

		const [ minX, minY, maxX, maxY ] = bounds;
		const padRatio = this.maxStylePaddingPixels / this.resolution;
		const padX = ( maxX - minX ) * padRatio;
		const padY = ( maxY - minY ) * padRatio;
		return expandBounds( bounds, padX, padY );

	}

	_trackTileTexture( tokens, texture ) {

		const key = this._getTileKey( tokens );
		let record = this.tileRecords.get( key );

		if ( record ) {

			this._removeTileRecordFromIndex( record );

		} else {

			record = {
				key,
				tokens: [ ...tokens ],
				texture,
				rawBounds: null,
				featureRecords: new Set(),
				indexed: false,
				minX: 0,
				minY: 0,
				maxX: 0,
				maxY: 0,
			};
			this.tileRecords.set( key, record );

		}

		record.texture = texture;
		record.tokens = [ ...tokens ];
		record.rawBounds = this._getTileBoundsDegFromTokens( tokens );
		this.textureTileRecords.set( texture, record );
		this._insertTileRecordIntoIndex( record );

		return record;

	}

	_untrackTileTexture( texture ) {

		const record = this.textureTileRecords.get( texture );
		if ( ! record ) {

			return;

		}

		this._clearTileFeatureLinks( record );
		this._removeTileRecordFromIndex( record );
		this.tileRecords.delete( record.key );
		this.textureTileRecords.delete( texture );

	}

	_insertTileRecordIntoIndex( record ) {

		if ( ! record.rawBounds ) {

			return;

		}

		this._applyTileRecordIndexBounds( record );
		this.tileIndex.insert( record );
		record.indexed = true;

	}

	_removeTileRecordFromIndex( record ) {

		if ( record.indexed ) {

			this.tileIndex.remove( record );
			record.indexed = false;

		}

	}

	_applyTileRecordIndexBounds( record ) {

		const paddedBounds = this._getPaddedTileBounds( record.rawBounds );
		boundsToItem( paddedBounds, record );

	}

	_refreshTileIndexPadding() {

		this.tileIndex.clear();
		this.tileRecords.forEach( record => {

			record.indexed = false;
			this._insertTileRecordIntoIndex( record );

		} );

	}

	_clearTileFeatureLinks( tileRecord ) {

		tileRecord.featureRecords.forEach( record => {

			record.tiles.delete( tileRecord );

		} );
		tileRecord.featureRecords.clear();

	}

	_clearRecordTileLinks( record ) {

		record.tiles.forEach( tileRecord => {

			tileRecord.featureRecords.delete( record );

		} );
		record.tiles.clear();

	}

	_clearAllTileFeatureLinks() {

		this.tileRecords.forEach( record => this._clearTileFeatureLinks( record ) );

	}

	_searchTileRecordsByBounds( bounds, target ) {

		if ( ! bounds ) {

			return;

		}

		this.tileIndex.search( boundsToItem( bounds ) ).forEach( record => {

			target.add( record );

		} );

	}

	_redrawTileRecords( records ) {

		let count = 0;
		records.forEach( record => {

			if ( record.texture ) {

				this._drawToCanvas( record.texture.image, record.tokens );
				record.texture.needsUpdate = true;
				count ++;

			}

		} );

		this.lastRedrawTileCount = count;
		this.totalTileRedraws += count;

	}

	_drawStyledFeatureOnCanvas( ctx, record, tileBoundsDeg, width, height ) {

		const { feature, style } = record;
		if ( ! feature.geometry || ! style.visible || style.opacity <= 0 ) {

			return false;

		}

		let drawn = false;
		this._forEachGeometry( feature.geometry, geometry => {

			drawn = this._drawGeometryOnCanvas( ctx, geometry, style, tileBoundsDeg, width, height ) || drawn;

		} );

		return drawn;

	}

	_drawGeometryOnCanvas( ctx, geometry, style, tileBoundsDeg, width, height ) {

		const [ minLonDeg, minLatDeg, maxLonDeg, maxLatDeg ] = tileBoundsDeg;
		const arr = new Array( 2 );
		const clampPadding = Math.max( width, height ) * PROJECTED_POINT_CLAMP_RATIO;
		const projectPoint = ( lon, lat, target = arr ) => {

			// 面和线需要使用真实投影坐标, 后续通过几何裁剪处理超出瓦片的部分。
			// 不能在这里直接 clamp, 否则跨瓦片的大面会被改造成错误的斜切多边形。
			target[ 0 ] = MathUtils.mapLinear( lon, minLonDeg, maxLonDeg, 0, width );
			target[ 1 ] = height - MathUtils.mapLinear( lat, minLatDeg, maxLatDeg, 0, height );
			return target;

		};
		const projectClampedPoint = ( lon, lat, target = arr ) => {

			// 点要素只需要绘制一个椭圆。这里仍然限制到 canvas 周围的安全范围内,
			// 避免父级瓦片或极端经纬度范围把点半径放大成整屏脏块。
			projectPoint( lon, lat, target );
			target[ 0 ] = Math.round( MathUtils.clamp( target[ 0 ], - clampPadding, width + clampPadding ) );
			target[ 1 ] = Math.round( MathUtils.clamp( target[ 1 ], - clampPadding, height + clampPadding ) );
			return target;

		};

		const calculateAspectRatio = ( lon, lat ) => {

			const latRad = lat * MathUtils.DEG2RAD;
			const lonRad = lon * MathUtils.DEG2RAD;
			const pxLat = ( maxLatDeg - minLatDeg ) / height;
			const pxLon = ( maxLonDeg - minLonDeg ) / width;
			const pixelRatio = pxLon / pxLat;
			const ratio = pixelRatio * calculateArcRatioAtPoint( WGS84_ELLIPSOID, latRad, lonRad );

			// 在低精度父级瓦片或极端长宽比瓦片上, ratio 可能非常接近 0 或非常大。
			// 不做限制时点会被拉成覆盖大面积地面的红白块, 移动相机时尤其明显。
			return MathUtils.clamp( ratio, MIN_POINT_ASPECT_RATIO, MAX_POINT_ASPECT_RATIO );

		};

		ctx.save();
		ctx.beginPath();
		ctx.rect( 0, 0, width, height );
		ctx.clip();
		ctx.setLineDash( style.lineDash );
		ctx.lineCap = style.lineCap;
		ctx.lineJoin = style.lineJoin;

		let drawn = false;
		const { type } = geometry;

		if ( type === 'Point' ) {

			drawn = this._drawPointGeometry( ctx, geometry.coordinates, style, projectClampedPoint, calculateAspectRatio );

		} else if ( type === 'MultiPoint' ) {

			geometry.coordinates.forEach( coordinates => {

				drawn = this._drawPointGeometry( ctx, coordinates, style, projectClampedPoint, calculateAspectRatio ) || drawn;

			} );

		} else if ( type === 'LineString' ) {

			drawn = this._drawLinePath( ctx, [ geometry.coordinates ], style, projectPoint, width, height );

		} else if ( type === 'MultiLineString' ) {

			drawn = this._drawLinePath( ctx, geometry.coordinates, style, projectPoint, width, height );

		} else if ( type === 'Polygon' ) {

			drawn = this._drawPolygonPath( ctx, [ geometry.coordinates ], style, projectPoint, width, height );

		} else if ( type === 'MultiPolygon' ) {

			drawn = this._drawPolygonPath( ctx, geometry.coordinates, style, projectPoint, width, height );

		}

		ctx.restore();
		return drawn;

	}

	_drawPointGeometry( ctx, coordinates, style, projectPoint, calculateAspectRatio ) {

		const pointRadius = style.pointRadius;
		const pointOpacity = style.opacity * style.pointOpacity;
		const pointFillStyle = style.pointFillStyle !== null ? style.pointFillStyle : style.fillStyle;
		const pointStrokeStyle = style.pointStrokeStyle !== null ? style.pointStrokeStyle : style.strokeStyle;
		const pointStrokeWidth = style.pointStrokeWidth !== null ? style.pointStrokeWidth : style.strokeWidth;
		const canFill = pointFillStyle !== null && pointRadius > 0 && pointOpacity > 0 && style.fillOpacity > 0;
		const canStroke = pointStrokeStyle !== null && pointStrokeWidth > 0 && pointRadius > 0 && pointOpacity > 0 && style.strokeOpacity > 0;

		if ( ! canFill && ! canStroke ) {

			return false;

		}

		const [ lon, lat ] = coordinates;
		const [ px, py ] = projectPoint( lon, lat );
		const drawRatio = calculateAspectRatio( lon, lat );

		ctx.beginPath();
		ctx.ellipse( px, py, pointRadius / drawRatio, pointRadius, 0, 0, Math.PI * 2 );

		if ( canFill ) {

			ctx.globalAlpha = pointOpacity * style.fillOpacity;
			ctx.fillStyle = pointFillStyle;
			ctx.fill();

		}

		if ( canStroke ) {

			ctx.globalAlpha = pointOpacity * style.strokeOpacity;
			ctx.strokeStyle = pointStrokeStyle;
			ctx.lineWidth = pointStrokeWidth;
			ctx.stroke();

		}

		return true;

	}

	_drawLinePath( ctx, lines, style, projectPoint ) {

		if ( style.strokeStyle === null || style.strokeWidth <= 0 || style.opacity <= 0 || style.strokeOpacity <= 0 ) {

			return false;

		}

		ctx.beginPath();
		lines.forEach( line => {

			line.forEach( ( [ lon, lat ], i ) => {

				const [ px, py ] = projectPoint( lon, lat );
				if ( i === 0 ) {

					ctx.moveTo( px, py );

				} else {

					ctx.lineTo( px, py );

				}

			} );

		} );

		ctx.globalAlpha = style.opacity * style.strokeOpacity;
		ctx.strokeStyle = style.strokeStyle;
		ctx.lineWidth = style.strokeWidth;
		ctx.stroke();
		return true;

	}

	_drawPolygonPath( ctx, polygons, style, projectPoint ) {

		const canFill = style.fillStyle !== null && style.opacity > 0 && style.fillOpacity > 0;
		const canStroke = style.strokeStyle !== null && style.strokeWidth > 0 && style.opacity > 0 && style.strokeOpacity > 0;

		if ( ! canFill && ! canStroke ) {

			return false;

		}

		polygons.forEach( polygon => {

			ctx.beginPath();
			polygon.forEach( ring => {

				ring.forEach( ( [ lon, lat ], i ) => {

					// 面要素必须严格按 GeoJSON 原始坐标成 path。Canvas 会自然裁掉
					// texture 外的像素, 这里不能做几何裁剪或坐标 clamp, 否则会改变边界拓扑。
					const [ px, py ] = projectPoint( lon, lat );
					if ( i === 0 ) {

						ctx.moveTo( px, py );

					} else {

						ctx.lineTo( px, py );

					}

				} );
				ctx.closePath();

			} );

			if ( canFill ) {

				ctx.globalAlpha = style.opacity * style.fillOpacity;
				ctx.fillStyle = style.fillStyle;
				ctx.fill( 'evenodd' );

			}

			if ( canStroke ) {

				ctx.globalAlpha = style.opacity * style.strokeOpacity;
				ctx.strokeStyle = style.strokeStyle;
				ctx.lineWidth = style.strokeWidth;
				ctx.stroke();

			}

		} );

		return true;

	}

}
