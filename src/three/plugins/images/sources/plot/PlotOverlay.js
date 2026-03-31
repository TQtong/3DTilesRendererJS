/**
 * @fileoverview **PlotOverlay** — 面向 {@link ImageOverlayPlugin} 的标绘叠加层实现。
 *
 * 本类不继承 `ImageOverlayPlugin` 内部的 `ImageOverlay` 基类（该基类未导出），而是通过 **duck typing**
 * 提供相同的方法与属性约定，从而可直接传入：
 *
 * ```js
 * tiles.registerPlugin( new ImageOverlayPlugin( {
 *   renderer,
 *   overlays: [ imageryOverlay, plotOverlay ],
 * } ) );
 * ```
 *
 * ## 职责
 * - 持有 {@link PlotImageSource} 实例（`this.imageSource`），业务将 `Map<id, shape>` 赋给 `imageSource.shapes`。
 * - 将插件对「区域 overlay」的调用（`hasContent`、`lockTexture`、`getTexture`、`releaseTexture`、`setResolution`、`redraw`）
 *   转发到 `PlotImageSource` 的 `DataCache` API。
 *
 * ## 构造选项
 * 除 `opacity`、`color` 等 overlay 通用字段外，会透传给 `PlotImageSource`：
 * - `resolution`：瓦片纹理边长
 * - `renderer`：必须与主场景共用的 `WebGLRenderer`（也可事后 `imageSource.setRenderer`）
 *
 * @module images/PlotOverlay
 */

import { Color } from 'three';
import { PlotImageSource } from './PlotImageSource.js';

/**
 * 标绘矢量叠加层，与 `ImageOverlayPlugin` 中的非平面影像 overlay 行为一致。
 */
export class PlotOverlay {

	/** @returns {boolean} 使用椭球/经纬投影，非平面 frame */
	get isPlanarProjection() {

		return false;

	}

	/** @returns {import('../../utils/ProjectionScheme.js').ProjectionScheme} 与底层 `PlotImageSource` 相同 */
	get projection() {

		return this.imageSource.projection;

	}

	/** @returns {number} 与多数 Web Mercator 叠加一致，用于 UV 缩放 */
	get aspectRatio() {

		return 2;

	}

	/**
	 * @param {object} [options={}]
	 * @param {number} [options.opacity=1]
	 * @param {number|string} [options.color=0xffffff]
	 * @param {number} [options.resolution] 传给 {@link PlotImageSource}
	 * @param {import('three').WebGLRenderer | null} [options.renderer] 传给 {@link PlotImageSource}
	 */
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

		/** @type {PlotImageSource} */
		this.imageSource = new PlotImageSource( options );

	}

	init() {

		this.isInitialized = true;
		this._whenReady = this._init().then( () => this.isReady = true );

	}

	/** @returns {Promise<void>} overlay 与 `PlotImageSource.init` 完成后的 Promise */
	whenReady() {

		return this._whenReady;

	}

	_init() {

		return this.imageSource.init();

	}

	/**
	 * 默认直连 `fetch`；若插件包装了 `overlay.fetch`，可用于鉴权等。
	 * @param {string} url
	 * @param {RequestInit} [options={}]
	 */
	fetch( url, options = {} ) {

		return fetch( url, options );

	}

	getAttributions() {}

	/**
	 * @param {number[]} range 归一化 `[minX, minY, maxX, maxY]`
	 * @returns {boolean}
	 */
	hasContent( range ) {

		return this.imageSource.hasContent( ...range );

	}

	/**
	 * @param {number[]} range
	 * @returns {import('three').Texture | null | Promise<import('three').Texture | null>}
	 */
	getTexture( range ) {

		return this.imageSource.get( ...range );

	}

	/**
	 * @param {number[]} range
	 * @param {object} [_tile] 插件传入的 tile，本 overlay 未使用
	 */
	lockTexture( range, _tile ) {

		return this.imageSource.lock( ...range );

	}

	/**
	 * @param {number[]} range
	 * @param {object} [_tile]
	 */
	releaseTexture( range, _tile ) {

		this.imageSource.release( ...range );

	}

	/**
	 * @param {number} resolution 与插件全局 overlay 分辨率对齐
	 */
	setResolution( resolution ) {

		this.imageSource.resolution = resolution;

	}

	/** 允许虚拟瓦片细分以改善贴地 UV */
	shouldSplit() {

		return true;

	}

	/**
	 * 标绘数据或样式变更后调用：在已缓存瓦片上原地重绘，勿整表 `dispose` 缓存。
	 */
	redraw() {

		this.imageSource.redraw();

	}

}
