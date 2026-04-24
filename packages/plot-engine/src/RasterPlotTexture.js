import {
	CanvasTexture,
	ClampToEdgeWrapping,
	LinearFilter,
} from 'three';
import { SDF_TYPES } from './compilers/defaultCompilers.js';
import { intersectsBounds } from './utils/bounds.js';

const DEFAULT_TEXTURE_SIZE = 512;
const TWO_PI = Math.PI * 2;

function clamp01( value ) {

	return Math.min( Math.max( Number( value ) || 0, 0 ), 1 );

}

function colorStyle( rgba, fallback ) {

	const color = rgba || fallback;
	const red = Math.round( clamp01( color[ 0 ] ) * 255 );
	const green = Math.round( clamp01( color[ 1 ] ) * 255 );
	const blue = Math.round( clamp01( color[ 2 ] ) * 255 );
	const alpha = clamp01( color[ 3 ] ?? 1 );
	return `rgba(${ red }, ${ green }, ${ blue }, ${ alpha })`;

}

function createCanvas( width, height ) {

	if ( typeof globalThis.OffscreenCanvas === 'function' ) {

		return new globalThis.OffscreenCanvas( width, height );

	}

	const document = globalThis.document;
	if ( document?.createElement ) {

		const canvas = document.createElement( 'canvas' );
		canvas.width = width;
		canvas.height = height;
		return canvas;

	}

	return null;

}

function createTransform( bounds, width, height ) {

	const spanX = Math.max( bounds[ 2 ] - bounds[ 0 ], 1e-12 );
	const spanY = Math.max( bounds[ 3 ] - bounds[ 1 ], 1e-12 );
	const scaleX = width / spanX;
	const scaleY = height / spanY;

	return {
		scaleX,
		scaleY,
		strokeScale: Math.min( scaleX, scaleY ),
		x: value => ( value - bounds[ 0 ] ) * scaleX,
		y: value => height - ( value - bounds[ 1 ] ) * scaleY,
	};

}

function moveToWorld( context, transform, x, y ) {

	context.moveTo( transform.x( x ), transform.y( y ) );

}

function lineToWorld( context, transform, x, y ) {

	context.lineTo( transform.x( x ), transform.y( y ) );

}

function drawPolylinePath( context, transform, payload, closed ) {

	const count = Math.floor( Number( payload[ 0 ] ) || 0 );
	if ( count < 2 ) return false;

	moveToWorld( context, transform, payload[ 1 ], payload[ 2 ] );
	for ( let index = 1; index < count; index ++ ) {

		const offset = 1 + index * 2;
		lineToWorld( context, transform, payload[ offset ], payload[ offset + 1 ] );

	}

	if ( closed ) context.closePath();
	return true;

}

function drawSectorPath( context, transform, payload ) {

	const centerX = Number( payload[ 0 ] ) || 0;
	const centerY = Number( payload[ 1 ] ) || 0;
	const radius = Math.max( Number( payload[ 2 ] ) || 0, 0 );
	const startAngle = Number( payload[ 4 ] ) || 0;
	const sectorAngle = Number( payload[ 5 ] ) || 0;
	if ( radius <= 0 || sectorAngle === 0 ) return false;

	const segments = Math.max( 8, Math.ceil( Math.abs( sectorAngle ) / TWO_PI * 64 ) );
	moveToWorld( context, transform, centerX, centerY );
	for ( let index = 0; index <= segments; index ++ ) {

		const theta = startAngle + sectorAngle * index / segments;
		lineToWorld(
			context,
			transform,
			centerX + Math.cos( theta ) * radius,
			centerY + Math.sin( theta ) * radius,
		);

	}

	context.closePath();
	return true;

}

function drawShapePath( context, transform, compiled ) {

	const type = compiled.sdf.type;
	const payload = compiled.sdf.payload || [];

	if ( type === SDF_TYPES.rectangle ) {

		const centerX = Number( payload[ 0 ] ) || 0;
		const centerY = Number( payload[ 1 ] ) || 0;
		const halfWidth = Math.max( Number( payload[ 2 ] ) || 0, 0 );
		const halfHeight = Math.max( Number( payload[ 3 ] ) || 0, 0 );
		if ( halfWidth <= 0 || halfHeight <= 0 ) return false;

		moveToWorld( context, transform, centerX - halfWidth, centerY - halfHeight );
		lineToWorld( context, transform, centerX + halfWidth, centerY - halfHeight );
		lineToWorld( context, transform, centerX + halfWidth, centerY + halfHeight );
		lineToWorld( context, transform, centerX - halfWidth, centerY + halfHeight );
		context.closePath();
		return true;

	}

	if ( type === SDF_TYPES.circle || type === SDF_TYPES.point ) {

		const centerX = transform.x( Number( payload[ 0 ] ) || 0 );
		const centerY = transform.y( Number( payload[ 1 ] ) || 0 );
		const radius = Math.max( Number( payload[ 2 ] ) || 0, 0 );
		if ( radius <= 0 ) return false;

		context.ellipse(
			centerX,
			centerY,
			Math.max( radius * transform.scaleX, 1e-6 ),
			Math.max( radius * transform.scaleY, 1e-6 ),
			0,
			0,
			TWO_PI,
		);
		return true;

	}

	if ( type === SDF_TYPES.polygon ) {

		return drawPolylinePath( context, transform, payload, true );

	}

	if ( type === SDF_TYPES.line ) {

		return drawPolylinePath( context, transform, payload, false );

	}

	if ( type === SDF_TYPES.sector ) {

		return drawSectorPath( context, transform, payload );

	}

	return false;

}

function paintShape( context, transform, compiled ) {

	if ( ! compiled?.sdf || ! intersectsBounds( compiled.bounds, transform.bounds ) ) return;

	const style = compiled.sdf.style || {};
	const fill = style.fill || [ 1, 1, 1, 0.35 ];
	const stroke = style.stroke || [ 1, 1, 1, 1 ];
	const strokeWidth = Math.max( Number( style.strokeWidth ?? 1 ) || 0, 0 ) * transform.strokeScale;
	const canFill = compiled.sdf.type !== SDF_TYPES.line && fill[ 3 ] > 0;
	const canStroke = strokeWidth > 0 && stroke[ 3 ] > 0;

	if ( ! canFill && ! canStroke ) return;

	context.beginPath();
	if ( ! drawShapePath( context, transform, compiled ) ) return;

	if ( canFill ) {

		context.fillStyle = colorStyle( fill, [ 1, 1, 1, 0.35 ] );
		context.fill();

	}

	if ( canStroke ) {

		context.strokeStyle = colorStyle( stroke, [ 1, 1, 1, 1 ] );
		context.lineWidth = strokeWidth;
		context.lineJoin = 'round';
		context.lineCap = 'round';
		context.stroke();

	}

}

export function canBuildRasterPlotTexture() {

	return typeof globalThis.OffscreenCanvas === 'function' || Boolean( globalThis.document?.createElement );

}

export function buildRasterPlotTexture( compiledShapes, bounds, options = {} ) {

	const size = Math.max( 1, Math.floor( options.size ?? DEFAULT_TEXTURE_SIZE ) );
	const canvas = createCanvas( size, size );
	if ( ! canvas ) return null;

	const context = canvas.getContext?.( '2d' );
	if ( ! context ) return null;

	context.clearRect( 0, 0, size, size );
	const transform = {
		...createTransform( bounds, size, size ),
		bounds,
	};

	for ( const compiled of compiledShapes ) {

		paintShape( context, transform, compiled );

	}

	const texture = new CanvasTexture( canvas );
	texture.minFilter = LinearFilter;
	texture.magFilter = LinearFilter;
	texture.wrapS = ClampToEdgeWrapping;
	texture.wrapT = ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	texture.userData.sourceLength = compiledShapes.length;
	texture.userData.mode = 'raster';
	return texture;

}
