/**
 * GroundDecalManager.js — 地面标绘管理器
 *
 * 基于 RTT（Render-to-Tile-Texture）方案：
 *   所有标绘图形通过 PlotOverlay 渲染到地形瓦片纹理上，
 *   完全不涉及深度缓冲重建，从根本上消除精度问题。
 *
 * 使用方式：
 *   const decals = new GroundDecalManager();
 *   decals.addPoint({ points: [[120, 30]], size: 2000, ... });
 *   tiles.registerPlugin(new ImageOverlayPlugin({
 *       renderer,
 *       overlays: [imageryOverlay, decals.overlay],
 *   }));
 *   // 不需要 decals.render() — ImageOverlayPlugin 自动处理
 */

import { PlotOverlay } from 'um-3d-tiles-renderer/three/plugins';
import { PlotPoint } from './PlotPoint.js';
import { PlotLine } from './PlotLine.js';
import { PlotPolygon } from './PlotPolygon.js';
import { PlotRectangle } from './PlotRectangle.js';
import { PlotCircle } from './PlotCircle.js';
import { PlotSector } from './PlotSector.js';
import { PlotLabel } from './PlotLabel.js';
import { PlotArrow } from './PlotArrow.js';

export class GroundDecalManager {

	constructor( options = {} ) {

		this._items = new Map();
		this._overlay = new PlotOverlay( options );
		this._overlay.imageSource.shapes = this._items;
		if ( options.renderer ) this._overlay.imageSource.setRenderer( options.renderer );
		this._redrawTimer = null;

	}

	/** 获取 overlay 实例，用于注册到 ImageOverlayPlugin */
	get overlay() {

		return this._overlay;

	}

	// ═══════════════════════════════════════════
	// 图形创建
	// ═══════════════════════════════════════════

	addPoint( options ) {

		const shape = new PlotPoint( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	addLine( options ) {

		const shape = new PlotLine( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	addPolygon( options ) {

		const shape = new PlotPolygon( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	addRectangle( options ) {

		const shape = new PlotRectangle( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	addCircle( options ) {

		const shape = new PlotCircle( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	addSector( options ) {

		const shape = new PlotSector( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	addText( options ) {

		const shape = new PlotLabel( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	addArrow( options ) {

		const shape = new PlotArrow( options );
		this._items.set( shape.id, shape );
		this._markDirty();
		return shape.id;

	}

	remove( id ) {

		if ( this._items.delete( id ) ) this._markDirty();

	}

	clear() {

		this._items.clear();
		this._markDirty();

	}

	// ═══════════════════════════════════════════
	// 查询与修改
	// ═══════════════════════════════════════════

	getItem( id ) {

		const shape = this._items.get( id );
		return shape ? shape.getSnapshot() : null;

	}

	setStyle( id, patch ) {

		const shape = this._items.get( id );
		if ( ! shape ) return;
		shape.update( patch );
		this._markDirty();

	}

	setCenter( id, center ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points || shape.options.points.length === 0 ) return;
		if ( center.lon !== undefined ) shape.options.points[ 0 ][ 0 ] = center.lon;
		if ( center.lat !== undefined ) shape.options.points[ 0 ][ 1 ] = center.lat;
		this._markDirty();

	}

	setCoords( id, coords ) {

		const shape = this._items.get( id );
		if ( ! shape ) return;
		shape.options.points = coords.map( c => [ ...c ] );
		this._markDirty();

	}

	setCoord( id, index, coord ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		if ( index < 0 || index >= shape.options.points.length ) return;
		if ( coord[ 0 ] !== undefined ) shape.options.points[ index ][ 0 ] = coord[ 0 ];
		if ( coord[ 1 ] !== undefined ) shape.options.points[ index ][ 1 ] = coord[ 1 ];
		this._markDirty();

	}

	insertCoord( id, index, coord ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		const idx = Math.max( 0, Math.min( index, shape.options.points.length ) );
		shape.options.points.splice( idx, 0, [ ...coord ] );
		this._markDirty();

	}

	removeCoord( id, index ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		if ( index < 0 || index >= shape.options.points.length ) return;
		const minVerts = shape.category === 'polygon' ? 3 : 2;
		if ( shape.options.points.length <= minVerts ) return;
		shape.options.points.splice( index, 1 );
		this._markDirty();

	}

	translateCoords( id, dLon, dLat ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return;
		for ( const p of shape.options.points ) { p[ 0 ] += dLon; p[ 1 ] += dLat; }
		this._markDirty();

	}

	setText( id, text ) {

		const shape = this._items.get( id );
		if ( ! shape || shape.category !== 'text' ) return;
		shape.options.content = text;
		this._markDirty();

	}

	setGlobalOpacity( opacity ) {

		this._overlay.opacity = opacity;

	}

	getCoordCount( id ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points ) return 0;
		return shape.options.points.length;

	}

	findNearestCoord( id, lon, lat ) {

		const shape = this._items.get( id );
		if ( ! shape || ! shape.options.points || shape.options.points.length === 0 ) return - 1;
		let bestIdx = 0, bestDist = Infinity;
		for ( let i = 0; i < shape.options.points.length; i ++ ) {

			const dLon = shape.options.points[ i ][ 0 ] - lon;
			const dLat = shape.options.points[ i ][ 1 ] - lat;
			const d = dLon * dLon + dLat * dLat;
			if ( d < bestDist ) { bestDist = d; bestIdx = i; }

		}

		return bestIdx;

	}

	dispose() {

		this._overlay.imageSource.dispose();

	}

	// ═══════════════════════════════════════════
	// 私有
	// ═══════════════════════════════════════════

	_markDirty() {

		if ( this._redrawTimer ) return;
		this._redrawTimer = requestAnimationFrame( () => {

			this._redrawTimer = null;
			this._overlay.redraw();

		} );

	}

}
