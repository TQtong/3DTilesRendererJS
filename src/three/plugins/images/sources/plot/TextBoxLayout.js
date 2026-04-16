import { getTextStyle } from 'text-to-canvas';

const DEG2RAD = Math.PI / 180;
const LINE_BREAK = /[\n\u2028\u2029]/;
const LINE_BREAK_GLOBAL = /[\n\u2028\u2029]/g;

function isFiniteNumber( value ) {

	return typeof value === 'number' && isFinite( value );

}

function roundUp( value ) {

	return Math.max( 1, Math.ceil( value ) );

}

function getMetersPerDegreeLongitude( latDeg ) {

	return 111320 * Math.max( Math.abs( Math.cos( latDeg * DEG2RAD ) ), 1e-6 );

}

function getBaseTextFormat( options ) {

	return {
		fontFamily: options.fontFamily,
		fontSize: options.fontSize,
		fontWeight: options.fontWeight,
		fontStyle: options.fontStyle,
		fontVariant: options.fontVariant,
		fontColor: options.fontColor,
		strokeColor: options.strokeColor,
		strokeWidth: options.strokeWidth,
	};

}

function withTextStyle( ctx, options, callback ) {

	const prevFont = ctx.font;
	ctx.font = getTextStyle( getBaseTextFormat( options ) );
	const result = callback();
	ctx.font = prevFont;
	return result;

}

function measureTextWidth( ctx, text, options ) {

	return withTextStyle( ctx, options, () => ctx.measureText( text ).width );

}

function measureTextBox( ctx, text, options ) {

	return withTextStyle( ctx, options, () => {

		const metrics = ctx.measureText( text );
		const left = metrics.actualBoundingBoxLeft ?? 0;
		const right = metrics.actualBoundingBoxRight ?? metrics.width;
		const ascent = metrics.actualBoundingBoxAscent ?? options.fontSize * 0.8;
		const descent = metrics.actualBoundingBoxDescent ?? options.fontSize * 0.2;
		const inkWidth = Math.max( left + right, metrics.width, 0 );
		const inkHeight = Math.max( ascent + descent, options.fontSize, 0 );

		return {
			width: metrics.width,
			left,
			right,
			ascent,
			descent,
			inkWidth,
			inkHeight,
		};

	} );

}

function measureTextLineHeight( ctx, options ) {

	return withTextStyle( ctx, options, () => {

		const metrics = ctx.measureText( 'Mg' );
		const measured = ( metrics.fontBoundingBoxAscent || 0 ) + ( metrics.fontBoundingBoxDescent || 0 );
		return Math.max( measured, options.fontSize * 1.2 ) + options.strokeWidth;

	} );

}

function getHardLines( content ) {

	if ( content === '' ) return [ '' ];
	return content.replace( /\r/g, '' ).split( LINE_BREAK_GLOBAL );

}

function tokenizeHorizontalLine( line ) {

	if ( line === '' ) return [ '' ];
	if ( ! /\s/.test( line ) ) return Array.from( line );

	const tokens = [];
	let current = '';
	let currentIsWhitespace = null;
	for ( const char of Array.from( line ) ) {

		const isWhitespace = /\s/.test( char );
		if ( current !== '' && currentIsWhitespace !== isWhitespace ) {

			tokens.push( current );
			current = '';

		}

		current += char;
		currentIsWhitespace = isWhitespace;

	}

	if ( current !== '' ) tokens.push( current );
	return tokens;

}

function wrapTokenByCharacter( ctx, token, options, maxWidth ) {

	const pieces = [];
	let current = '';
	for ( const char of Array.from( token ) ) {

		const candidate = current + char;
		if ( current !== '' && measureTextWidth( ctx, candidate, options ) > maxWidth ) {

			pieces.push( current );
			current = char;

		} else {

			current = candidate;

		}

	}

	if ( current !== '' ) pieces.push( current );
	return pieces.length > 0 ? pieces : [ token ];

}

function wrapHorizontalLine( ctx, line, options, innerWidth ) {

	if ( ! isFiniteNumber( options.boxWidth ) ) return [ line ];

	const tokens = tokenizeHorizontalLine( line );
	const lines = [];
	let current = '';
	for ( const token of tokens ) {

		const candidate = current + token;
		if ( current !== '' && measureTextWidth( ctx, candidate, options ) > innerWidth ) {

			const trimmed = current.trimEnd();
			lines.push( trimmed );
			current = token.trimStart();

			if ( current !== '' && measureTextWidth( ctx, current, options ) > innerWidth ) {

				const broken = wrapTokenByCharacter( ctx, current, options, innerWidth );
				lines.push( ...broken.slice( 0, - 1 ) );
				current = broken[ broken.length - 1 ];

			}

		} else if ( current === '' && measureTextWidth( ctx, token, options ) > innerWidth ) {

			const broken = wrapTokenByCharacter( ctx, token, options, innerWidth );
			lines.push( ...broken.slice( 0, - 1 ) );
			current = broken[ broken.length - 1 ];

		} else {

			current = candidate;

		}

	}

	lines.push( current.trimEnd() );
	return lines;

}

function getHorizontalLines( ctx, options, innerWidth ) {

	if ( ! isFiniteNumber( options.boxWidth ) ) {

		return getHardLines( options.content );

	}

	return getHardLines( options.content ).flatMap( line => wrapHorizontalLine( ctx, line, options, innerWidth ) );

}

function alignOffset( outerSize, innerSize, mode ) {

	if ( mode === 'right' || mode === 'bottom' ) {

		return outerSize - innerSize;

	} else if ( mode === 'center' || mode === 'middle' ) {

		return ( outerSize - innerSize ) / 2;

	}

	return 0;

}

function normalizeLayoutDirection( value ) {

	return value === 'vertical-rl' || value === 'vertical-lr' ? value : 'horizontal';

}

function normalizeAlign( value ) {

	return value === 'left' || value === 'right' ? value : 'center';

}

function normalizeVerticalAlign( value ) {

	return value === 'top' || value === 'bottom' ? value : 'middle';

}

function normalizeAnchorX( value ) {

	return value === 'left' || value === 'right' ? value : 'center';

}

function normalizeAnchorY( value ) {

	return value === 'top' || value === 'bottom' ? value : 'middle';

}

function getAnchorOffsetX( width, mode ) {

	if ( mode === 'left' ) {

		return width / 2;

	} else if ( mode === 'right' ) {

		return - width / 2;

	}

	return 0;

}

function getAnchorOffsetY( height, mode ) {

	if ( mode === 'top' ) {

		return height / 2;

	} else if ( mode === 'bottom' ) {

		return - height / 2;

	}

	return 0;

}

function getMaxBoxSizeInLayoutUnits( atlasSize, renderScale ) {

	return Math.max( 1, atlasSize - 2 ) / Math.max( renderScale, 1e-6 );

}

function clampMinimumBoxHeight( requestedHeight, minHeight ) {

	if ( requestedHeight === null ) return null;
	return Math.max( requestedHeight, minHeight );

}

function fitLayoutToAtlas( ctx, rawOptions, atlasSize, renderScale ) {

	const maxBoxSize = getMaxBoxSizeInLayoutUnits( atlasSize, renderScale );
	const options = { ...rawOptions };

	for ( let i = 0; i < 3; i ++ ) {

		const layout = layoutTextBox( ctx, options, renderScale );
		if ( layout.boxWidth <= atlasSize && layout.boxHeight <= atlasSize ) {

			return layout;

		}

		let changed = false;
		if ( layout.boxWidth > atlasSize ) {

			const nextWidth = Math.min(
				isFiniteNumber( options.boxWidth ) && options.boxWidth > 0 ? options.boxWidth : maxBoxSize,
				maxBoxSize,
			);
			if ( options.boxWidth !== nextWidth ) {

				options.boxWidth = nextWidth;
				changed = true;

			}

		}

		if ( layout.boxHeight > atlasSize ) {

			const nextHeight = Math.min(
				isFiniteNumber( options.boxHeight ) && options.boxHeight > 0 ? options.boxHeight : maxBoxSize,
				maxBoxSize,
			);
			if ( options.boxHeight !== nextHeight ) {

				options.boxHeight = nextHeight;
				changed = true;

			}

		}

		if ( ! changed ) {

			return layout;

		}

	}

	return layoutTextBox( ctx, options, renderScale );

}

function normalizeOptions( options = {}, renderScale = 1 ) {

	const strokeWidth = isFiniteNumber( options.strokeWidth ) ? Math.max( options.strokeWidth, 0 ) : 0;
	const defaultPadding = strokeWidth + 6;
	const padding = isFiniteNumber( options.padding ) ? Math.max( options.padding, 0 ) : defaultPadding;
	const boxWidth = isFiniteNumber( options.boxWidth ) && options.boxWidth > 0 ? options.boxWidth : null;
	const boxHeight = isFiniteNumber( options.boxHeight ) && options.boxHeight > 0 ? options.boxHeight : null;

	return {
		content: options.content || '',
		fontSize: ( options.fontSize || 48 ) * renderScale,
		fontColor: options.fontColor || '#ffffff',
		fontFamily: options.fontFamily || 'sans-serif',
		fontWeight: options.fontWeight || '400',
		fontStyle: options.fontStyle || '',
		fontVariant: options.fontVariant || '',
		strokeColor: options.strokeColor || '#000000',
		strokeWidth: strokeWidth * renderScale,
		fillColor: options.fillColor || null,
		fillOpacity: options.fillOpacity !== undefined ? options.fillOpacity / 100 : 1,
		padding: padding * renderScale,
		boxWidth: boxWidth !== null ? boxWidth * renderScale : null,
		boxHeight: boxHeight !== null ? boxHeight * renderScale : null,
		textAlign: normalizeAlign( options.textAlign ),
		verticalAlign: normalizeVerticalAlign( options.verticalAlign ),
		anchorX: normalizeAnchorX( options.anchorX ),
		anchorY: normalizeAnchorY( options.anchorY ),
		layoutDirection: normalizeLayoutDirection( options.layoutDirection ),
		rotation: options.rotation || 0,
		offsetX: options.offsetX || 0,
		offsetY: options.offsetY || 0,
		renderScale,
	};

}

function layoutHorizontalTextBox( ctx, options ) {

	const lineHeight = measureTextLineHeight( ctx, options );
	const minBoxHeight = roundUp( lineHeight + options.padding * 2 );
	let innerWidth = options.boxWidth !== null ? Math.max( 1, options.boxWidth - options.padding * 2 ) : null;
	const lines = getHorizontalLines( ctx, options, innerWidth || 1 );
	const lineMetrics = lines.map( line => measureTextBox( ctx, line, options ) );
	const contentWidth = lineMetrics.length > 0 ? Math.max( ...lineMetrics.map( metrics => metrics.inkWidth ) ) : 0;
	const contentHeight = Math.max( lineHeight, lines.length * lineHeight );
	const boxWidth = options.boxWidth !== null ? options.boxWidth : roundUp( contentWidth + options.padding * 2 );
	const boxHeight = options.boxHeight !== null
		? clampMinimumBoxHeight( options.boxHeight, minBoxHeight )
		: roundUp( contentHeight + options.padding * 2 );
	innerWidth = Math.max( 1, boxWidth - options.padding * 2 );
	const innerHeight = Math.max( 1, boxHeight - options.padding * 2 );
	const startY = options.padding + alignOffset( innerHeight, contentHeight, options.verticalAlign );

	const items = lines.map( ( line, index ) => {

		const metrics = lineMetrics[ index ];
		const lineLeft = options.padding + alignOffset( innerWidth, metrics.inkWidth, options.textAlign );
		return {
			text: line,
			x: lineLeft,
			y: startY + index * lineHeight,
			drawX: lineLeft + metrics.left,
			drawY: startY + index * lineHeight + lineHeight / 2,
			width: metrics.inkWidth,
			height: lineHeight,
			column: index,
		};

	} );

	return {
		...options,
		type: 'horizontal',
		boxWidth,
		boxHeight,
		contentWidth,
		contentHeight,
		lineHeight,
		lines,
		items,
	};

}

function getVerticalTokens( content ) {

	if ( content === '' ) return [ '' ];
	return Array.from( content.replace( /\r/g, '' ) );

}

function layoutVerticalTextBox( ctx, options ) {

	const lineHeight = measureTextLineHeight( ctx, options );
	const emptyColumnWidth = Math.max( measureTextBox( ctx, 'M', options ).inkWidth, options.fontSize * 0.5 );
	const minBoxHeight = roundUp( lineHeight + options.padding * 2 );
	const minBoxWidth = roundUp( emptyColumnWidth + options.padding * 2 );
	const tokens = getVerticalTokens( options.content );
	const maxColumnHeight = options.boxHeight !== null
		? Math.max( lineHeight, clampMinimumBoxHeight( options.boxHeight, minBoxHeight ) - options.padding * 2 )
		: Infinity;

	const columns = [];
	let column = [];
	let columnHeight = 0;

	const pushColumn = ( forceBlank = false ) => {

		if ( column.length === 0 && ! forceBlank ) return;
		columns.push( column.length === 0 ? [ {
			text: '',
			width: emptyColumnWidth,
			height: lineHeight,
			blank: true,
		} ] : column );
		column = [];
		columnHeight = 0;

	};

	for ( const token of tokens ) {

		if ( LINE_BREAK.test( token ) ) {

			pushColumn( true );
			continue;

		}

		if ( columnHeight + lineHeight > maxColumnHeight && column.length > 0 ) {

			pushColumn();

		}

		column.push( {
			text: token,
			metrics: token === '' ? null : measureTextBox( ctx, token, options ),
			width: token === '' ? emptyColumnWidth : measureTextBox( ctx, token, options ).inkWidth,
			height: lineHeight,
			blank: token === '',
		} );
		columnHeight += lineHeight;

	}

	pushColumn( true );

	const columnWidths = columns.map( items => {

		return items.reduce( ( maxWidth, item ) => Math.max( maxWidth, item.width ), emptyColumnWidth );

	} );
	const columnHeights = columns.map( items => Math.max( lineHeight, items.length * lineHeight ) );
	const contentWidth = columnWidths.reduce( ( sum, width ) => sum + width, 0 );
	const contentHeight = columnHeights.length > 0 ? Math.max( ...columnHeights ) : lineHeight;
	const boxWidth = options.boxWidth !== null ? Math.max( options.boxWidth, minBoxWidth ) : roundUp( contentWidth + options.padding * 2 );
	const boxHeight = options.boxHeight !== null ? Math.max( options.boxHeight, minBoxHeight ) : roundUp( contentHeight + options.padding * 2 );
	const innerWidth = Math.max( 1, boxWidth - options.padding * 2 );
	const innerHeight = Math.max( 1, boxHeight - options.padding * 2 );
	const blockStartX = options.padding + alignOffset( innerWidth, contentWidth, options.textAlign );
	const blockStartY = options.padding + alignOffset( innerHeight, contentHeight, options.verticalAlign );

	const items = [];
	let cursorX = options.layoutDirection === 'vertical-rl' ? blockStartX + contentWidth : blockStartX;

	columns.forEach( ( columnItems, columnIndex ) => {

		const columnWidth = columnWidths[ columnIndex ];
		const columnHeightPx = columnHeights[ columnIndex ];
		let columnX = cursorX;
		if ( options.layoutDirection === 'vertical-rl' ) {

			columnX -= columnWidth;
			cursorX = columnX;

		}

		const columnY = blockStartY;
		columnItems.forEach( ( item, itemIndex ) => {

			const itemX = columnX + ( columnWidth - item.width ) / 2;
			items.push( {
				text: item.text,
				x: itemX,
				y: columnY + itemIndex * lineHeight,
				drawX: item.blank || ! item.metrics ? itemX : itemX + item.metrics.left,
				drawY: columnY + itemIndex * lineHeight + lineHeight / 2,
				width: item.width,
				height: item.height,
				column: columnIndex,
				blank: item.blank,
			} );

		} );

		if ( options.layoutDirection === 'vertical-lr' ) {

			cursorX += columnWidth;

		}

	} );

	return {
		...options,
		type: options.layoutDirection,
		boxWidth,
		boxHeight,
		contentWidth,
		contentHeight,
		lineHeight,
		columns: columns.map( columnItems => columnItems.map( item => item.text ) ),
		items,
	};

}

export function layoutTextBox( ctx, rawOptions = {}, renderScale = 1 ) {

	const options = normalizeOptions( rawOptions, renderScale );
	if ( options.layoutDirection === 'horizontal' ) {

		return layoutHorizontalTextBox( ctx, options );

	}

	return layoutVerticalTextBox( ctx, options );

}

export function drawTextBox( ctx, layout, x = 0, y = 0 ) {

	ctx.save();
	ctx.translate( x, y );

	if ( layout.fillColor ) {

		ctx.save();
		ctx.globalAlpha = layout.fillOpacity;
		ctx.fillStyle = layout.fillColor;
		ctx.fillRect( 0, 0, layout.boxWidth, layout.boxHeight );
		ctx.restore();

	}

	ctx.beginPath();
	ctx.rect( 0, 0, layout.boxWidth, layout.boxHeight );
	ctx.clip();
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	ctx.lineJoin = 'round';
	ctx.font = getTextStyle( getBaseTextFormat( layout ) );
	ctx.fillStyle = layout.fontColor;
	ctx.strokeStyle = layout.strokeColor;
	ctx.lineWidth = layout.strokeWidth;

	if ( layout.type === 'horizontal' ) {

		ctx.textAlign = 'left';
		for ( const item of layout.items ) {

			if ( item.text === '' ) continue;

			if ( layout.strokeWidth > 0 ) {

				ctx.strokeText( item.text, item.drawX, item.drawY );

			}

			ctx.fillText( item.text, item.drawX, item.drawY );

		}

	} else {

		ctx.textAlign = 'left';

		for ( const item of layout.items ) {

			if ( item.blank || item.text === '' ) continue;

			if ( layout.strokeWidth > 0 ) {

				ctx.strokeText( item.text, item.drawX, item.drawY );

			}

			ctx.fillText( item.text, item.drawX, item.drawY );

		}

	}

	ctx.restore();

}

export function buildTextAtlas( canvas, shapes, {
	atlasSize = canvas.width,
	metersPerPixel = 10,
	renderScale = 1,
} = {} ) {

	const ctx = canvas.getContext( '2d' );
	ctx.clearRect( 0, 0, atlasSize, atlasSize );

	const labelTiles = new Map();
	let cursorX = 0;
	let cursorY = 0;
	let rowHeight = 0;

	for ( const [ id, shape ] of shapes ) {

		if ( shape.category !== 'text' || shape.options.visible === false ) continue;
		const layout = fitLayoutToAtlas( ctx, shape.options, atlasSize, renderScale );
		const width = roundUp( layout.boxWidth );
		const height = roundUp( layout.boxHeight );
		if ( cursorX + width > atlasSize ) {

			cursorX = 0;
			cursorY += rowHeight;
			rowHeight = 0;

		}

		if ( cursorY + height > atlasSize ) break;

		drawTextBox( ctx, layout, cursorX, cursorY );

		const lat = shape.options.points?.[ 0 ]?.[ 1 ] || 0;
		const metersPerDegLon = getMetersPerDegreeLongitude( lat );
		const metersPerDegLat = 111320;
		const metersPerCanvasPx = metersPerPixel / renderScale;
		const halfWidthMeters = width * metersPerCanvasPx / 2;
		const halfHeightMeters = height * metersPerCanvasPx / 2;
		const angle = ( shape.options.rotation || 0 ) * DEG2RAD;
		const cos = Math.cos( angle );
		const sin = Math.sin( angle );
		const anchorOffsetX = getAnchorOffsetX( width, layout.anchorX ) * metersPerCanvasPx;
		const anchorOffsetY = - getAnchorOffsetY( height, layout.anchorY ) * metersPerCanvasPx;
		const userOffsetX = ( shape.options.offsetX || 0 ) * metersPerPixel;
		const userOffsetY = - ( shape.options.offsetY || 0 ) * metersPerPixel;
		const localOffsetX = anchorOffsetX + userOffsetX;
		const localOffsetY = anchorOffsetY + userOffsetY;
		const offsetMetersX = localOffsetX * cos - localOffsetY * sin;
		const offsetMetersY = localOffsetX * sin + localOffsetY * cos;
		const centerLonOffsetDeg = offsetMetersX / metersPerDegLon;
		const centerLatOffsetDeg = offsetMetersY / metersPerDegLat;
		const aabbHalfWidthMeters = Math.abs( cos ) * halfWidthMeters + Math.abs( sin ) * halfHeightMeters;
		const aabbHalfHeightMeters = Math.abs( sin ) * halfWidthMeters + Math.abs( cos ) * halfHeightMeters;
		const centerLon = shape.options.points?.[ 0 ]?.[ 0 ] || 0;
		const centerLat = shape.options.points?.[ 0 ]?.[ 1 ] || 0;

		labelTiles.set( id, {
			layout,
			centerLonOffsetDeg,
			centerLatOffsetDeg,
			halfWDeg: halfWidthMeters / metersPerDegLon,
			halfHDeg: halfHeightMeters / metersPerDegLat,
			cosRotation: cos,
			sinRotation: sin,
			u0: cursorX / atlasSize,
			v0: cursorY / atlasSize,
			u1: ( cursorX + width ) / atlasSize,
			v1: ( cursorY + height ) / atlasSize,
			bounds: [
				centerLon + centerLonOffsetDeg - aabbHalfWidthMeters / metersPerDegLon,
				centerLat + centerLatOffsetDeg - aabbHalfHeightMeters / metersPerDegLat,
				centerLon + centerLonOffsetDeg + aabbHalfWidthMeters / metersPerDegLon,
				centerLat + centerLatOffsetDeg + aabbHalfHeightMeters / metersPerDegLat,
			],
		} );

		cursorX += width;
		rowHeight = Math.max( rowHeight, height );

	}

	return labelTiles;

}

export function getPlotShapeBounds( shape, labelTiles = null ) {

	const pts = shape.options.points;
	if ( ! pts || pts.length === 0 ) return null;

	if ( shape.category === 'text' ) {

		return labelTiles?.get( shape.id )?.bounds || null;

	}

	let minLon = Infinity;
	let minLat = Infinity;
	let maxLon = - Infinity;
	let maxLat = - Infinity;
	for ( const [ lon, lat ] of pts ) {

		minLon = Math.min( minLon, lon );
		maxLon = Math.max( maxLon, lon );
		minLat = Math.min( minLat, lat );
		maxLat = Math.max( maxLat, lat );

	}

	const cat = shape.category;
	if ( cat === 'circle' || cat === 'sector' ) {

		const r = shape.options.radius || 0;
		const dLon = r / getMetersPerDegreeLongitude( pts[ 0 ][ 1 ] );
		const dLat = r / 111320;
		minLon -= dLon;
		maxLon += dLon;
		minLat -= dLat;
		maxLat += dLat;

	} else if ( cat === 'point' ) {

		const size = ( shape.options.size || 0 ) / 2;
		const dLon = size / getMetersPerDegreeLongitude( pts[ 0 ][ 1 ] );
		const dLat = size / 111320;
		minLon -= dLon;
		maxLon += dLon;
		minLat -= dLat;
		maxLat += dLat;

	}

	const strokeWidth = shape.options.strokeWidth || 0;
	if ( strokeWidth > 0 ) {

		const pad = strokeWidth * 0.001;
		minLon -= pad;
		maxLon += pad;
		minLat -= pad;
		maxLat += pad;

	}

	return [ minLon, minLat, maxLon, maxLat ];

}
