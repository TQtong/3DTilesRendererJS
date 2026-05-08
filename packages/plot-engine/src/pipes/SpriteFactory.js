// ============================================================
// pipes/SpriteFactory.js — 文本 / 图标的 Canvas 渲染
// ============================================================
//
// 给定 compiled.primitives[i] = { kind: 'text' | 'icon' | 'text-leader-line' }，
// 输出朝上躺平在 XZ 平面（与既有 polygon 一致）的 textured quad。
//
// 文本：用 Canvas 绘制单个字符串，textbox 自适应。
// 图标：URL → ImageBitmap / SVG → CanvasTexture。
// 引线：薄 ribbon，与 ThickLine 类似但更简单。
//

import {
	BufferGeometry,
	CanvasTexture,
	DoubleSide,
	Float32BufferAttribute,
	LinearFilter,
	Mesh,
	MeshBasicMaterial,
} from 'three';
import { createThickLineMesh } from './ThickLineMaterial.js';

const _imageCache = new Map();
const _milsymbolWarned = { value: false };

function makeTextCanvas( prim ) {

	const padding = prim.padding ?? 4;
	const fontSize = Math.max( 8, prim.fontSize );
	const font = `${ fontSize }px ${ prim.fontFamily }`;

	// canvas 尺寸是基于像素度量；这里按"1 字号 = 1 世界单位"映射回去
	let canvas;
	if ( typeof OffscreenCanvas !== 'undefined' ) {

		canvas = new OffscreenCanvas( 1, 1 );

	} else if ( typeof document !== 'undefined' ) {

		canvas = document.createElement( 'canvas' );

	} else {

		// 无 DOM 环境（如 Node 测试），返回 null 表示跳过
		return null;

	}

	const ctx = canvas.getContext( '2d' );
	ctx.font = font;
	const lines = String( prim.text ?? '' ).split( '\n' );
	const widths = lines.map( line => ctx.measureText( line ).width );
	const textWidth = Math.max( 1, ...widths );
	const lineHeight = fontSize * 1.2;
	const textHeight = lineHeight * lines.length;
	const w = Math.ceil( textWidth + padding * 2 );
	const h = Math.ceil( textHeight + padding * 2 );

	canvas.width = w;
	canvas.height = h;
	ctx.font = font;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	if ( prim.bgColor ) {

		ctx.fillStyle = prim.bgColor;
		ctx.fillRect( 0, 0, w, h );

	}

	if ( prim.strokeColor && prim.strokeWidth > 0 ) {

		ctx.strokeStyle = prim.strokeColor;
		ctx.lineWidth = prim.strokeWidth;
		ctx.strokeRect( 0.5, 0.5, w - 1, h - 1 );

	}

	ctx.fillStyle = prim.fontColor;
	for ( let i = 0; i < lines.length; i ++ ) {

		const cy = padding + lineHeight * ( i + 0.5 );
		ctx.fillText( lines[ i ], w * 0.5, cy );

	}

	return { canvas, w, h, fontSize };

}

function buildQuadGeometry( cx, cy, height, width, depth, rotation = 0 ) {

	// 顶点位置：以 anchor 为中心，长 = width，宽 = depth（XZ 平面）
	// 三角形面绕 Y 朝上
	const halfW = width * 0.5;
	const halfD = depth * 0.5;

	const cos = Math.cos( rotation );
	const sin = Math.sin( rotation );
	const corners = [
		[ - halfW, - halfD ],
		[  halfW, - halfD ],
		[  halfW,  halfD ],
		[ - halfW,  halfD ],
	].map( ( [ x, z ] ) => [ x * cos - z * sin + cx, height, x * sin + z * cos + cy ] );

	const positions = [
		...corners[ 0 ], ...corners[ 1 ], ...corners[ 2 ],
		...corners[ 0 ], ...corners[ 2 ], ...corners[ 3 ],
	];
	const uvs = [
		0, 1, 1, 1, 1, 0,
		0, 1, 1, 0, 0, 0,
	];

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
	geometry.computeBoundingBox?.();
	geometry.computeBoundingSphere?.();
	return geometry;

}

export function createTextMesh( prim ) {

	const result = makeTextCanvas( prim );
	if ( ! result ) return null;
	const { canvas, w, h, fontSize } = result;
	const texture = new CanvasTexture( canvas );
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;

	const aspect = w / h;
	const worldHeight = fontSize === prim.fontSize ? prim.fontSize : prim.fontSize;
	// 让画布像素比例与世界尺寸保持一致：worldWidth / worldHeight = aspect
	const widthWorld = worldHeight * aspect;
	const heightWorld = worldHeight;

	const geometry = buildQuadGeometry(
		prim.anchor[ 0 ],
		prim.anchor[ 1 ],
		prim.height,
		widthWorld,
		heightWorld,
		0,
	);

	const material = new MeshBasicMaterial( {
		map: texture,
		transparent: true,
		side: DoubleSide,
		depthWrite: false,
	} );

	const mesh = new Mesh( geometry, material );
	mesh.userData.plotKind = 'text';
	mesh.userData._disposable = [ texture, material, geometry ];
	return mesh;

}

function loadIconImage( source ) {

	if ( ! source ) return Promise.resolve( null );
	if ( typeof source !== 'string' ) {

		// 已经是 image / canvas
		return Promise.resolve( source );

	}

	const cached = _imageCache.get( source );
	if ( cached ) return cached;

	if ( typeof Image === 'undefined' ) return Promise.resolve( null );

	const promise = new Promise( ( resolve, reject ) => {

		const image = new Image();
		image.crossOrigin = 'anonymous';
		image.onload = () => resolve( image );
		image.onerror = reject;
		image.src = source;

	} ).catch( ( error ) => {

		console.warn( '[SpriteFactory] icon load failed', source, error );
		return null;

	} );

	_imageCache.set( source, promise );
	return promise;

}

function rasterizeMilsymbol( sidc, options ) {

	const ms = globalThis.ms || globalThis.milsymbol || null;
	if ( ! ms ) {

		if ( ! _milsymbolWarned.value ) {

			console.warn( '[SpriteFactory] milsymbol library not found on globalThis. Skipping milsymbol rasterization.' );
			_milsymbolWarned.value = true;

		}

		return null;

	}

	try {

		const symbol = new ms.Symbol( sidc, options || {} );
		const canvas = symbol.asCanvas?.() ?? null;
		return canvas;

	} catch ( error ) {

		console.warn( '[SpriteFactory] milsymbol render failed', sidc, error );
		return null;

	}

}

export function createIconMesh( prim, callbacks = {} ) {

	const geometry = buildQuadGeometry(
		prim.anchor[ 0 ],
		prim.anchor[ 1 ],
		prim.altitude,
		prim.width,
		prim.height,
		prim.rotation,
	);

	const material = new MeshBasicMaterial( {
		transparent: true,
		side: DoubleSide,
		depthWrite: false,
		opacity: 1,
	} );

	const mesh = new Mesh( geometry, material );
	mesh.userData.plotKind = 'icon';
	mesh.userData._disposable = [ geometry, material ];

	// milsymbol 同步路径
	if ( prim.sidc ) {

		const canvas = rasterizeMilsymbol( prim.sidc, prim.milOptions );
		if ( canvas ) {

			const texture = new CanvasTexture( canvas );
			texture.minFilter = LinearFilter;
			texture.magFilter = LinearFilter;
			texture.generateMipmaps = false;
			material.map = texture;
			material.needsUpdate = true;
			mesh.userData._disposable.push( texture );

		}

		return mesh;

	}

	// 异步加载 url icon
	loadIconImage( prim.source ).then( image => {

		if ( ! image || mesh.userData._disposed ) return;
		const texture = new CanvasTexture( image );
		texture.minFilter = LinearFilter;
		texture.magFilter = LinearFilter;
		texture.generateMipmaps = false;
		material.map = texture;
		material.needsUpdate = true;
		mesh.userData._disposable.push( texture );
		callbacks.onTextureReady?.();

	} );

	return mesh;

}

export function createLeaderLineMesh( prim ) {

	return createThickLineMesh( {
		points: [
			[ prim.from[ 0 ], prim.height, prim.from[ 1 ] ],
			[ prim.to[ 0 ], prim.height, prim.to[ 1 ] ],
		],
		kind: 'line-thick',
		style: { strokeWidth: prim.width },
		strokeColor: parseColorString( prim.color ),
		opacity: 1,
	} );

}

function parseColorString( value ) {

	if ( ! value ) return [ 1, 1, 1, 1 ];
	if ( typeof value === 'string' && value.startsWith( '#' ) ) {

		let hex = value.slice( 1 );
		if ( hex.length === 3 ) hex = hex.split( '' ).map( c => c + c ).join( '' );
		return [
			parseInt( hex.slice( 0, 2 ), 16 ) / 255,
			parseInt( hex.slice( 2, 4 ), 16 ) / 255,
			parseInt( hex.slice( 4, 6 ), 16 ) / 255,
			1,
		];

	}

	return [ 1, 1, 1, 1 ];

}

export function disposeSpriteMesh( mesh ) {

	const list = mesh?.userData?._disposable;
	if ( ! list ) return;
	for ( const item of list ) item?.dispose?.();
	mesh.userData._disposed = true;

}
