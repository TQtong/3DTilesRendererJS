/**
 * PlotOverlay.js — 标绘叠加层
 *
 * 实现 ImageOverlay 接口（duck-typing，因 ImageOverlay 未导出），
 * 将所有标绘图形通过 PlotImageSource 渲染到瓦片纹理上。
 *
 * 使用方式：
 *   const overlay = new PlotOverlay({ opacity: 1.0 });
 *   overlay.imageSource.shapes = myShapesMap;
 *   tiles.registerPlugin(new ImageOverlayPlugin({ renderer, overlays: [overlay] }));
 */

import { Color } from 'three';
import { PlotImageSource } from './PlotImageSource.js';

export class PlotOverlay {

	get isPlanarProjection() {

		return false;

	}

	get projection() {

		return this.imageSource.projection;

	}

	get aspectRatio() {

		return 2;

	}

	constructor( options = {} ) {

		this.opacity = options.opacity ?? 1;
		this.color = new Color( options.color ?? 0xffffff );
		this.frame = null;
		this.preprocessURL = null;
		this.alphaMask = false;
		this.alphaInvert = false;

		this._whenReady = null;
		this.isReady = false;
		this.isInitialized = false;

		this.imageSource = new PlotImageSource( options );

	}

	init() {

		this.isInitialized = true;
		this._whenReady = this._init().then( () => this.isReady = true );

	}

	whenReady() {

		return this._whenReady;

	}

	_init() {

		return this.imageSource.init();

	}

	fetch( url, options = {} ) {

		return fetch( url, options );

	}

	getAttributions() {}

	hasContent( range ) {

		return this.imageSource.hasContent( ...range );

	}

	getTexture( range ) {

		return this.imageSource.get( ...range );

	}

	lockTexture( range ) {

		return this.imageSource.lock( ...range );

	}

	releaseTexture( range ) {

		this.imageSource.release( ...range );

	}

	setResolution( resolution ) {

		this.imageSource.resolution = resolution;

	}

	shouldSplit() {

		return true;

	}

	/** 数据变化后调用，重绘所有已缓存的瓦片纹理 */
	redraw() {

		this.imageSource.redraw();

	}

}
