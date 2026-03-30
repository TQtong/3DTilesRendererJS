/**
 * colorUtils.js — 颜色与不透明度工具函数
 *
 * 为 GroundDecalManager 提供颜色字符串解析和不透明度兼容层。
 * SDF shader 中颜色以归一化 RGBA [0,1] 传入，alpha 通道已合并 fillOpacity/strokeOpacity。
 */

/**
 * 将颜色字符串解析为归一化 RGBA 数组 [r, g, b, a]，各分量 ∈ [0, 1]。
 *
 * 支持格式：
 *   - '#hex'          — 3位或6位十六进制（如 '#f00', '#ff0000'）
 *   - 'rgb(r,g,b)'    — 0-255 整数
 *   - 'rgba(r,g,b,a)' — a ∈ [0, 1]
 *   - 'transparent'   — 全透明 [0,0,0,0]
 *   - null / undefined — 全透明 [0,0,0,0]
 *
 * @param {string|null} color - 颜色字符串
 * @returns {number[]} [r, g, b, a] 归一化颜色数组
 */
export function parseColorToRGBA( color ) {

	if ( ! color || color === 'transparent' ) return [ 0, 0, 0, 0 ];

	if ( typeof color === 'string' ) {

		// rgb() / rgba() 格式
		const m = color.match( /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/ );
		if ( m ) {

			return [
				parseInt( m[ 1 ] ) / 255,
				parseInt( m[ 2 ] ) / 255,
				parseInt( m[ 3 ] ) / 255,
				m[ 4 ] !== undefined ? parseFloat( m[ 4 ] ) : 1.0,
			];

		}

		// #hex 格式
		if ( color.startsWith( '#' ) ) {

			let hex = color.slice( 1 );
			if ( hex.length === 3 ) hex = hex[ 0 ] + hex[ 0 ] + hex[ 1 ] + hex[ 1 ] + hex[ 2 ] + hex[ 2 ];
			return [
				parseInt( hex.slice( 0, 2 ), 16 ) / 255,
				parseInt( hex.slice( 2, 4 ), 16 ) / 255,
				parseInt( hex.slice( 4, 6 ), 16 ) / 255,
				1.0,
			];

		}

	}

	return [ 1, 1, 1, 1 ];

}

/**
 * 解析不透明度参数，兼容两种样式格式：
 *
 * 1. store 格式（推荐）：fillOpacity / strokeOpacity，值域 0-100 整数百分比
 * 2. 旧版格式：opacity，值域 0-1 浮点数，同时作用于 fill 和 stroke
 *
 * 解析结果写入 base 数组：base[0] = fillOpacity (0-1), base[1] = strokeOpacity (0-1)
 *
 * @param {object} style - 图形样式对象
 * @param {number[]} base - 长度为 2 的输出数组 [fillOpacity, strokeOpacity]
 */
export function resolveOpacity( style, base ) {

	if ( style.fillOpacity !== undefined ) base[ 0 ] = style.fillOpacity / 100;
	else if ( style.opacity !== undefined ) base[ 0 ] = style.opacity;
	else base[ 0 ] = 1;

	if ( style.strokeOpacity !== undefined ) base[ 1 ] = style.strokeOpacity / 100;
	else if ( style.opacity !== undefined ) base[ 1 ] = style.opacity;
	else base[ 1 ] = 1;

}
