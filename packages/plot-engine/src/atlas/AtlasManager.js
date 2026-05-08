// ============================================================
// atlas/AtlasManager.js — Canvas atlas + 简易 shelf packer
// ============================================================
//
// 用单张 2048×2048 canvas 容纳 icon / glyph 等各种 sprite。
// 需要 atlas 时调用 add(key, draw) 回调把内容画到 canvas 上，
// 然后通过 entries.get(key) 拿到 UV rect。
// 内部用 shelf packing：行高对齐到 max-row-height；满了自动新行。
//

import { CanvasTexture, LinearFilter, NearestFilter } from 'three';

export class AtlasManager {

	constructor( options = {} ) {

		this.size = options.size ?? 2048;
		this.padding = options.padding ?? 2;
		this.minFilter = options.minFilter ?? LinearFilter;
		this.magFilter = options.magFilter ?? LinearFilter;

		this.canvas = ( typeof OffscreenCanvas !== 'undefined' )
			? new OffscreenCanvas( this.size, this.size )
			: ( typeof document !== 'undefined' ? document.createElement( 'canvas' ) : null );

		if ( this.canvas && ! ( typeof OffscreenCanvas !== 'undefined' && this.canvas instanceof OffscreenCanvas ) ) {

			this.canvas.width = this.size;
			this.canvas.height = this.size;

		}

		this.ctx = this.canvas?.getContext?.( '2d' ) ?? null;
		if ( this.ctx ) {

			// 透明背景
			this.ctx.clearRect( 0, 0, this.size, this.size );

		}

		this.texture = this.canvas
			? new CanvasTexture( this.canvas )
			: null;
		if ( this.texture ) {

			this.texture.minFilter = this.minFilter;
			this.texture.magFilter = this.magFilter;
			this.texture.generateMipmaps = false;
			this.texture.flipY = true;

		}

		this.entries = new Map();
		this._cursorX = this.padding;
		this._cursorY = this.padding;
		this._rowHeight = 0;
		this._revision = 0;

	}

	get revision() {

		return this._revision;

	}

	has( key ) {

		return this.entries.has( key );

	}

	get( key ) {

		return this.entries.get( key ) || null;

	}

	/**
	 * 在 atlas 上添加一个条目。
	 *
	 * @param {string} key
	 * @param {object} options - { width, height, draw: ctx => void }
	 * @returns {{ x: number, y: number, w: number, h: number, uv: [u0,v0,u1,v1] } | null}
	 */
	add( key, { width, height, draw } ) {

		if ( ! this.ctx ) return null;
		if ( this.entries.has( key ) ) return this.entries.get( key );
		if ( width <= 0 || height <= 0 ) return null;

		const w = Math.ceil( width );
		const h = Math.ceil( height );

		// 换行
		if ( this._cursorX + w + this.padding > this.size ) {

			this._cursorX = this.padding;
			this._cursorY += this._rowHeight + this.padding;
			this._rowHeight = 0;

		}

		if ( this._cursorY + h + this.padding > this.size ) {

			// atlas 满了——目前不支持自动扩容，简单地拒绝（生产代码可触发扩容 + 重打包）
			console.warn( '[AtlasManager] atlas full, dropping entry', key );
			return null;

		}

		const x = this._cursorX;
		const y = this._cursorY;

		this.ctx.save();
		this.ctx.translate( x, y );
		try {

			draw( this.ctx, w, h );

		} catch ( error ) {

			console.warn( '[AtlasManager] draw failed for', key, error );

		}

		this.ctx.restore();

		this._cursorX += w + this.padding;
		this._rowHeight = Math.max( this._rowHeight, h );

		const entry = {
			x, y, w, h,
			uv: [ x / this.size, y / this.size, ( x + w ) / this.size, ( y + h ) / this.size ],
		};
		this.entries.set( key, entry );

		if ( this.texture ) this.texture.needsUpdate = true;
		this._revision ++;
		return entry;

	}

	dispose() {

		this.texture?.dispose?.();
		this.entries.clear();

	}

}
