/**
 * PlotImageSource.js — 标绘图形 Canvas 2D 渲染源
 *
 * 参考 GeoJSONImageSource，将所有标绘图形渲染到 per-tile CanvasTexture 上。
 * 继承 RegionImageSource（DataCache），支持 lock/release/get 缓存机制。
 *
 * 核心流程：
 *   1. ImageOverlayPlugin 调用 hasContent(range) 判断该瓦片是否有图形
 *   2. 调用 lock(range) / get(range) → fetchItem(tokens) 创建 CanvasTexture
 *   3. _drawToCanvas 将所有与该瓦片相交的图形用 Canvas 2D 绘制到 canvas 上
 *   4. 数据变化时调用 redraw() 重绘所有已缓存的 canvas
 */

import { CanvasTexture, MathUtils, SRGBColorSpace } from 'three';
import { RegionImageSource } from '../../../../src/three/plugins/images/sources/RegionImageSource.js';
import { ProjectionScheme } from '../../../../src/three/plugins/images/utils/ProjectionScheme.js';

const DEG2RAD = MathUtils.DEG2RAD;
const RAD2DEG = MathUtils.RAD2DEG;

export class PlotImageSource extends RegionImageSource {

	constructor( options = {} ) {

		super();
		this.resolution = options.resolution || 512;
		this.projection = new ProjectionScheme();

		/** 所有标绘图形 Map<id, PlotBase> — 由 GroundDecalManager 注入 */
		this.shapes = new Map();

		/** 所有图形的总包围盒 [minLon, minLat, maxLon, maxLat]（度） */
		this.contentBounds = null;

	}

	async init() {

		this._updateBounds();

	}

	hasContent( minX, minY, maxX, maxY ) {

		if ( ! this.contentBounds || this.shapes.size === 0 ) return false;

		const { projection } = this;
		const tileBounds = [
			projection.convertNormalizedToLongitude( minX ) * RAD2DEG,
			projection.convertNormalizedToLatitude( minY ) * RAD2DEG,
			projection.convertNormalizedToLongitude( maxX ) * RAD2DEG,
			projection.convertNormalizedToLatitude( maxY ) * RAD2DEG,
		];
		return _boundsIntersect( tileBounds, this.contentBounds );

	}

	async fetchItem( tokens ) {

		const canvas = document.createElement( 'canvas' );
		const tex = new CanvasTexture( canvas );
		tex.colorSpace = SRGBColorSpace;
		tex.generateMipmaps = false;

		this._drawToCanvas( canvas, tokens );
		tex.needsUpdate = true;

		return tex;

	}

	disposeItem( texture ) {

		texture.dispose();

	}

	/** 数据变化后调用：重算包围盒 + 重绘所有已缓存的瓦片纹理 */
	redraw() {

		this._updateBounds();
		this.forEachItem( ( tex, args ) => {

			this._drawToCanvas( tex.image, args );
			tex.needsUpdate = true;

		} );

	}

	/** 重算所有图形的总包围盒 */
	_updateBounds() {

		let minLon = Infinity, minLat = Infinity;
		let maxLon = - Infinity, maxLat = - Infinity;
		let hasAny = false;

		for ( const shape of this.shapes.values() ) {

			if ( shape.options.visible === false ) continue;
			const pts = shape.options.points;
			if ( ! pts ) continue;

			for ( const [ lon, lat ] of pts ) {

				minLon = Math.min( minLon, lon );
				maxLon = Math.max( maxLon, lon );
				minLat = Math.min( minLat, lat );
				maxLat = Math.max( maxLat, lat );
				hasAny = true;

			}

			// 扩展半径/尺寸类图形的包围盒
			const cat = shape.category;
			if ( cat === 'circle' || cat === 'sector' ) {

				const r = shape.options.radius || 0;
				const cLat = pts[ 0 ][ 1 ];
				const dLon = r / ( 111320 * Math.cos( cLat * DEG2RAD ) );
				const dLat = r / 111320;
				minLon = Math.min( minLon, pts[ 0 ][ 0 ] - dLon );
				maxLon = Math.max( maxLon, pts[ 0 ][ 0 ] + dLon );
				minLat = Math.min( minLat, pts[ 0 ][ 1 ] - dLat );
				maxLat = Math.max( maxLat, pts[ 0 ][ 1 ] + dLat );

			} else if ( cat === 'rectangle' ) {

				const w = ( shape.options.width || 0 ) / 2;
				const h = ( shape.options.height || 0 ) / 2;
				const cLat = pts[ 0 ][ 1 ];
				const dLon = w / ( 111320 * Math.cos( cLat * DEG2RAD ) );
				const dLat = h / 111320;
				minLon = Math.min( minLon, pts[ 0 ][ 0 ] - dLon );
				maxLon = Math.max( maxLon, pts[ 0 ][ 0 ] + dLon );
				minLat = Math.min( minLat, pts[ 0 ][ 1 ] - dLat );
				maxLat = Math.max( maxLat, pts[ 0 ][ 1 ] + dLat );

			} else if ( cat === 'point' ) {

				const sz = ( shape.options.size || 0 ) / 2;
				const cLat = pts[ 0 ][ 1 ];
				const dLon = sz / ( 111320 * Math.cos( cLat * DEG2RAD ) );
				const dLat = sz / 111320;
				minLon = Math.min( minLon, pts[ 0 ][ 0 ] - dLon );
				maxLon = Math.max( maxLon, pts[ 0 ][ 0 ] + dLon );
				minLat = Math.min( minLat, pts[ 0 ][ 1 ] - dLat );
				maxLat = Math.max( maxLat, pts[ 0 ][ 1 ] + dLat );

			} else if ( cat === 'text' ) {

				const fontSize = shape.options.fontSize || 48;
				const content = shape.options.content || '';
				const textH = fontSize * 10;
				const textW = textH * content.length * 0.7;
				const cLat = pts[ 0 ][ 1 ];
				const dLon = textW / ( 111320 * Math.cos( cLat * DEG2RAD ) );
				const dLat = textH / 111320;
				minLon = Math.min( minLon, pts[ 0 ][ 0 ] - dLon );
				maxLon = Math.max( maxLon, pts[ 0 ][ 0 ] + dLon );
				minLat = Math.min( minLat, pts[ 0 ][ 1 ] - dLat );
				maxLat = Math.max( maxLat, pts[ 0 ][ 1 ] + dLat );

			}

		}

		this.contentBounds = hasAny ? [ minLon, minLat, maxLon, maxLat ] : null;

	}

	/**
	 * 将所有与该瓦片相交的图形渲染到 canvas 上。
	 * tokens = [minX, minY, maxX, maxY]（normalized projection 坐标，弧度）
	 */
	_drawToCanvas( canvas, tokens ) {

		const [ minX, minY, maxX, maxY ] = tokens;
		const { projection, resolution } = this;

		canvas.width = resolution;
		canvas.height = resolution;

		const minLonDeg = projection.convertNormalizedToLongitude( minX ) * RAD2DEG;
		const minLatDeg = projection.convertNormalizedToLatitude( minY ) * RAD2DEG;
		const maxLonDeg = projection.convertNormalizedToLongitude( maxX ) * RAD2DEG;
		const maxLatDeg = projection.convertNormalizedToLatitude( maxY ) * RAD2DEG;
		const tileBounds = [ minLonDeg, minLatDeg, maxLonDeg, maxLatDeg ];

		const w = resolution, h = resolution;
		const ctx = canvas.getContext( '2d' );
		ctx.clearRect( 0, 0, w, h );

		// 米→像素转换系数
		const midLat = ( minLatDeg + maxLatDeg ) / 2;
		const metersPerDegLon = 111320 * Math.cos( midLat * DEG2RAD );
		const metersPerDegLat = 111320;
		const pxPerDegLon = w / ( maxLonDeg - minLonDeg );
		const pxPerDegLat = h / ( maxLatDeg - minLatDeg );
		const pxPerMeterLon = pxPerDegLon / metersPerDegLon;
		const pxPerMeterLat = pxPerDegLat / metersPerDegLat;

		const projectPoint = ( lon, lat ) => {

			const x = MathUtils.mapLinear( lon, minLonDeg, maxLonDeg, 0, w );
			const y = h - MathUtils.mapLinear( lat, minLatDeg, maxLatDeg, 0, h );
			return [ x, y ];

		};

		for ( const shape of this.shapes.values() ) {

			if ( shape.options.visible === false ) continue;

			const shapeBounds = this._getShapeBounds( shape );
			if ( ! shapeBounds || ! _boundsIntersect( shapeBounds, tileBounds ) ) continue;

			this._drawShape( ctx, shape, projectPoint, pxPerMeterLon, pxPerMeterLat, w, h );

		}

	}

	/** 获取图形的地理包围盒 [minLon, minLat, maxLon, maxLat]（度） */
	_getShapeBounds( shape ) {

		const pts = shape.options.points;
		if ( ! pts || pts.length === 0 ) return null;

		let minLon = Infinity, minLat = Infinity;
		let maxLon = - Infinity, maxLat = - Infinity;

		for ( const [ lon, lat ] of pts ) {

			minLon = Math.min( minLon, lon );
			maxLon = Math.max( maxLon, lon );
			minLat = Math.min( minLat, lat );
			maxLat = Math.max( maxLat, lat );

		}

		const cat = shape.category;
		if ( cat === 'circle' || cat === 'sector' ) {

			const r = shape.options.radius || 0;
			const dLon = r / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = r / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		} else if ( cat === 'rectangle' ) {

			const dLon = ( shape.options.width || 0 ) / 2 / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = ( shape.options.height || 0 ) / 2 / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		} else if ( cat === 'point' ) {

			const sz = ( shape.options.size || 0 ) / 2;
			const dLon = sz / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = sz / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		} else if ( cat === 'text' ) {

			// 文字地理尺寸：fontSize * 10 米高，宽度按字符数估算
			const fontSize = shape.options.fontSize || 48;
			const content = shape.options.content || '';
			const textH = fontSize * 10;
			const textW = textH * content.length * 0.7;
			const dLon = textW / ( 111320 * Math.cos( pts[ 0 ][ 1 ] * DEG2RAD ) );
			const dLat = textH / 111320;
			minLon -= dLon; maxLon += dLon;
			minLat -= dLat; maxLat += dLat;

		}

		// 额外填充 strokeWidth（粗略估算）
		const sw = shape.options.strokeWidth || 0;
		if ( sw > 0 ) {

			const pad = sw * 0.001;
			minLon -= pad; maxLon += pad;
			minLat -= pad; maxLat += pad;

		}

		return [ minLon, minLat, maxLon, maxLat ];

	}

	/** Canvas 2D 绘制单个图形 */
	_drawShape( ctx, shape, projectPoint, pxPerMeterLon, pxPerMeterLat, w, h ) {

		const opts = shape.options;
		const cat = shape.category;
		const pts = opts.points;

		ctx.save();

		// 通用样式
		const fillColor = opts.fillColor || 'transparent';
		const strokeColor = opts.strokeColor || 'transparent';
		const fillOpacity = ( opts.fillOpacity !== undefined ? opts.fillOpacity / 100 : 1 );
		const strokeOpacity = ( opts.strokeOpacity !== undefined ? opts.strokeOpacity / 100 : 1 );
		const strokeWidth = opts.strokeWidth || 0;

		if ( cat === 'point' ) {

			const [ cx, cy ] = projectPoint( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
			const halfSize = ( opts.size || 0 ) / 2;
			const rPx = halfSize * pxPerMeterLon;

			if ( opts.pointStyle === 'square' ) {

				ctx.globalAlpha = fillOpacity;
				ctx.fillStyle = fillColor;
				ctx.fillRect( cx - rPx, cy - rPx, rPx * 2, rPx * 2 );
				if ( strokeWidth > 0 ) {

					ctx.globalAlpha = strokeOpacity;
					ctx.strokeStyle = strokeColor;
					ctx.lineWidth = strokeWidth;
					ctx.strokeRect( cx - rPx, cy - rPx, rPx * 2, rPx * 2 );

				}

			} else {

				ctx.beginPath();
				ctx.ellipse( cx, cy, rPx, halfSize * pxPerMeterLat, 0, 0, Math.PI * 2 );
				ctx.globalAlpha = fillOpacity;
				ctx.fillStyle = fillColor;
				ctx.fill();
				if ( strokeWidth > 0 ) {

					ctx.globalAlpha = strokeOpacity;
					ctx.strokeStyle = strokeColor;
					ctx.lineWidth = strokeWidth;
					ctx.stroke();

				}

			}

		} else if ( cat === 'line' ) {

			if ( pts.length < 2 ) {

				ctx.restore(); return;

			}

			const projected = pts.map( p => projectPoint( p[ 0 ], p[ 1 ] ) );

			ctx.beginPath();
			for ( let i = 0; i < projected.length; i ++ ) {

				if ( i === 0 ) ctx.moveTo( projected[ i ][ 0 ], projected[ i ][ 1 ] );
				else ctx.lineTo( projected[ i ][ 0 ], projected[ i ][ 1 ] );

			}

			ctx.globalAlpha = strokeOpacity;
			ctx.strokeStyle = strokeColor;
			ctx.lineWidth = strokeWidth || 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();

			// 端点箭头
			const arrowSize = ( opts.arrowSize || 15 ) * 1.5;
			const startStyle = opts.startArrowStyle;
			const endStyle = opts.endArrowStyle;

			if ( startStyle ) {

				const p0 = projected[ 0 ], p1 = projected[ 1 ];
				const angle = Math.atan2( p0[ 1 ] - p1[ 1 ], p0[ 0 ] - p1[ 0 ] );
				_drawArrowHead( ctx, p0[ 0 ], p0[ 1 ], angle, arrowSize, startStyle, strokeColor, strokeOpacity, strokeWidth );

			}

			if ( endStyle ) {

				const pL = projected[ projected.length - 1 ], pP = projected[ projected.length - 2 ];
				const angle = Math.atan2( pL[ 1 ] - pP[ 1 ], pL[ 0 ] - pP[ 0 ] );
				_drawArrowHead( ctx, pL[ 0 ], pL[ 1 ], angle, arrowSize, endStyle, strokeColor, strokeOpacity, strokeWidth );

			}

		} else if ( cat === 'polygon' || cat === 'arrow' ) {

			let verts = pts;
			if ( cat === 'arrow' ) {

				verts = shape.generateCoords();
				if ( verts.length < 3 ) {

					ctx.restore(); return;

				}

			}

			if ( verts.length < 3 ) {

				ctx.restore(); return;

			}

			ctx.beginPath();
			for ( let i = 0; i < verts.length; i ++ ) {

				const [ px, py ] = projectPoint( verts[ i ][ 0 ], verts[ i ][ 1 ] );
				if ( i === 0 ) ctx.moveTo( px, py );
				else ctx.lineTo( px, py );

			}

			ctx.closePath();
			ctx.globalAlpha = fillOpacity;
			ctx.fillStyle = fillColor;
			ctx.fill( 'evenodd' );
			if ( strokeWidth > 0 ) {

				ctx.globalAlpha = strokeOpacity;
				ctx.strokeStyle = strokeColor;
				ctx.lineWidth = strokeWidth;
				ctx.stroke();

			}

		} else if ( cat === 'rectangle' ) {

			const [ cx, cy ] = projectPoint( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
			const hw = ( opts.width || 0 ) / 2 * pxPerMeterLon;
			const hh = ( opts.height || 0 ) / 2 * pxPerMeterLat;

			ctx.globalAlpha = fillOpacity;
			ctx.fillStyle = fillColor;
			ctx.fillRect( cx - hw, cy - hh, hw * 2, hh * 2 );
			if ( strokeWidth > 0 ) {

				ctx.globalAlpha = strokeOpacity;
				ctx.strokeStyle = strokeColor;
				ctx.lineWidth = strokeWidth;
				ctx.strokeRect( cx - hw, cy - hh, hw * 2, hh * 2 );

			}

		} else if ( cat === 'circle' ) {

			const [ cx, cy ] = projectPoint( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
			const r = opts.radius || 0;
			const rPxLon = r * pxPerMeterLon;
			const rPxLat = r * pxPerMeterLat;

			ctx.beginPath();
			ctx.ellipse( cx, cy, rPxLon, rPxLat, 0, 0, Math.PI * 2 );
			ctx.globalAlpha = fillOpacity;
			ctx.fillStyle = fillColor;
			ctx.fill();
			if ( strokeWidth > 0 ) {

				ctx.globalAlpha = strokeOpacity;
				ctx.strokeStyle = strokeColor;
				ctx.lineWidth = strokeWidth;
				ctx.stroke();

			}

		} else if ( cat === 'sector' ) {

			const [ cx, cy ] = projectPoint( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
			const r = opts.radius || 0;
			const rPx = r * pxPerMeterLon;
			const startAngle = - ( opts.startAngle || 0 ) * DEG2RAD;
			const sectorAngle = - ( opts.sectorAngle || 0 ) * DEG2RAD;

			ctx.beginPath();
			ctx.moveTo( cx, cy );
			ctx.arc( cx, cy, rPx, startAngle, startAngle + sectorAngle, sectorAngle < 0 );
			ctx.closePath();
			ctx.globalAlpha = fillOpacity;
			ctx.fillStyle = fillColor;
			ctx.fill();
			if ( strokeWidth > 0 ) {

				ctx.globalAlpha = strokeOpacity;
				ctx.strokeStyle = strokeColor;
				ctx.lineWidth = strokeWidth;
				ctx.stroke();

			}

		} else if ( cat === 'text' ) {

			const [ cx, cy ] = projectPoint( pts[ 0 ][ 0 ], pts[ 0 ][ 1 ] );
			const fontSize = opts.fontSize || 48;
			const content = opts.content || '';

			// 将 fontSize 转为地理固定大小：fontSize * 10 米
			const fontPx = Math.max( fontSize * 10 * pxPerMeterLat, 1 );
			const font = fontPx + 'px sans-serif';

			ctx.font = font;
			ctx.textAlign = opts.textAlign || 'center';
			ctx.textBaseline = 'middle';

			// 描边宽度也按比例缩放
			const textStrokeW = Math.max( strokeWidth * 10 * pxPerMeterLat, 1 );

			if ( opts.strokeColor && strokeWidth > 0 ) {

				ctx.globalAlpha = strokeOpacity;
				ctx.strokeStyle = strokeColor;
				ctx.lineWidth = textStrokeW;
				ctx.strokeText( content, cx, cy );

			}

			ctx.globalAlpha = fillOpacity;
			ctx.fillStyle = opts.fontColor || fillColor || '#ffffff';
			ctx.fillText( content, cx, cy );

		}

		ctx.restore();

	}

}

/**
 * 在指定位置绘制箭头头部。
 * style: 'filled', 'open', 'filledDiamond', 'openDiamond', 'filledCircle', 'openCircle', 'bar'
 */
function _drawArrowHead( ctx, x, y, angle, size, style, color, opacity, lineWidth ) {

	ctx.save();
	ctx.translate( x, y );
	ctx.rotate( angle );
	ctx.globalAlpha = opacity;
	ctx.fillStyle = color;
	ctx.strokeStyle = color;
	ctx.lineWidth = lineWidth || 1;

	const w = size * 0.45;

	if ( style === 'filled' || style === 'open' ) {

		ctx.beginPath();
		ctx.moveTo( size, 0 );
		ctx.lineTo( 0, w );
		ctx.lineTo( 0, - w );
		ctx.closePath();
		if ( style === 'filled' ) ctx.fill();
		else ctx.stroke();

	} else if ( style === 'filledDiamond' || style === 'openDiamond' ) {

		const hs = size * 0.5;
		ctx.beginPath();
		ctx.moveTo( size, 0 );
		ctx.lineTo( hs, w );
		ctx.lineTo( 0, 0 );
		ctx.lineTo( hs, - w );
		ctx.closePath();
		if ( style === 'filledDiamond' ) ctx.fill();
		else ctx.stroke();

	} else if ( style === 'filledCircle' || style === 'openCircle' ) {

		const r = size * 0.35;
		ctx.beginPath();
		ctx.arc( 0, 0, r, 0, Math.PI * 2 );
		if ( style === 'filledCircle' ) ctx.fill();
		else ctx.stroke();

	} else if ( style === 'bar' ) {

		ctx.beginPath();
		ctx.moveTo( 0, - w );
		ctx.lineTo( 0, w );
		ctx.lineWidth = Math.max( lineWidth, 2 );
		ctx.stroke();

	}

	ctx.restore();

}

function _boundsIntersect( a, b ) {

	if ( ! a || ! b ) return false;
	return ! ( a[ 2 ] < b[ 0 ] || a[ 0 ] > b[ 2 ] || a[ 3 ] < b[ 1 ] || a[ 1 ] > b[ 3 ] );

}
