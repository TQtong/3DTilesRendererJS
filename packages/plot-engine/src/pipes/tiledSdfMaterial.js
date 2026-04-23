import {
	DataTexture,
	FloatType,
	NearestFilter,
	RGBAFormat,
	Vector4,
} from 'three';

const PLOT_SDF_STATE = Symbol( 'PLOT_SDF_STATE' );

const EMPTY_TEXTURE = /* @__PURE__ */ new DataTexture(
	new Float32Array( 4 ),
	1,
	1,
	RGBAFormat,
	FloatType,
);
EMPTY_TEXTURE.minFilter = NearestFilter;
EMPTY_TEXTURE.magFilter = NearestFilter;
EMPTY_TEXTURE.needsUpdate = true;

const vertexPreamble = /* glsl */`
	attribute vec2 plotUv;
	varying vec2 vPlotUv;
`;

const fragmentPreamble = /* glsl */`
	uniform sampler2D plotSdfTexture;
	uniform float plotSdfTextureWidth;
	uniform vec4 plotTileBounds;
	uniform float plotOpacity;
	varying vec2 vPlotUv;

	float plotGetValue( float index ) {

		float texelIndex = floor( index / 4.0 );
		float channel = mod( index, 4.0 );
		vec2 uv = vec2( ( texelIndex + 0.5 ) / max( plotSdfTextureWidth, 1.0 ), 0.5 );
		vec4 texel = texture2D( plotSdfTexture, uv );
		if ( channel < 0.5 ) return texel.r;
		if ( channel < 1.5 ) return texel.g;
		if ( channel < 2.5 ) return texel.b;
		return texel.a;

	}

	vec2 plotGetCoord() {

		return vec2(
			mix( plotTileBounds.x, plotTileBounds.z, vPlotUv.x ),
			mix( plotTileBounds.y, plotTileBounds.w, vPlotUv.y )
		);

	}

	vec2 plotReadPoint( float start, int index ) {

		float base = start + float( index ) * 2.0;
		return vec2( plotGetValue( base ), plotGetValue( base + 1.0 ) );

	}

	float plotDistanceToSegment( vec2 point, vec2 start, vec2 end ) {

		vec2 segment = end - start;
		float lengthSq = dot( segment, segment );
		if ( lengthSq <= 1e-12 ) return distance( point, start );

		float t = clamp( dot( point - start, segment ) / lengthSq, 0.0, 1.0 );
		return distance( point, start + segment * t );

	}

	float plotDistanceToPolyline( vec2 point, float pointsOffset, int pointCount, bool closed ) {

		float minDistance = 1e20;
		for ( int index = 0; index < 128; index ++ ) {

			if ( index >= pointCount - 1 && ! closed ) break;
			if ( index >= pointCount ) break;

			int nextIndex = index + 1;
			if ( closed ) {

				nextIndex = ( index + 1 ) % max( pointCount, 1 );

			} else if ( nextIndex >= pointCount ) {

				break;

			}

			vec2 start = plotReadPoint( pointsOffset, index );
			vec2 end = plotReadPoint( pointsOffset, nextIndex );
			minDistance = min( minDistance, plotDistanceToSegment( point, start, end ) );

		}

		return minDistance;

	}

	bool plotPolygonContains( vec2 point, float pointsOffset, int pointCount ) {

		bool inside = false;
		for ( int index = 0; index < 128; index ++ ) {

			if ( index >= pointCount ) break;

			int prevIndex = index == 0 ? pointCount - 1 : index - 1;
			vec2 current = plotReadPoint( pointsOffset, index );
			vec2 previous = plotReadPoint( pointsOffset, prevIndex );
			float denom = previous.y - current.y;
			if ( abs( denom ) < 1e-6 ) denom = denom < 0.0 ? - 1e-6 : 1e-6;

			bool intersects =
				( current.y > point.y ) != ( previous.y > point.y ) &&
				point.x < ( previous.x - current.x ) * ( point.y - current.y ) / denom + current.x;

			if ( intersects ) inside = ! inside;

		}

		return inside;

	}

	float plotSdBox( vec2 point, vec2 center, vec2 halfSize ) {

		vec2 delta = abs( point - center ) - halfSize;
		return length( max( delta, 0.0 ) ) + min( max( delta.x, delta.y ), 0.0 );

	}

	vec4 plotBlend( vec4 baseColor, vec4 overlayColor ) {

		float outAlpha = overlayColor.a + baseColor.a * ( 1.0 - overlayColor.a );
		if ( outAlpha <= 1e-6 ) return vec4( 0.0 );

		vec3 outRgb =
			( overlayColor.rgb * overlayColor.a + baseColor.rgb * baseColor.a * ( 1.0 - overlayColor.a ) ) /
			outAlpha;

		return vec4( outRgb, outAlpha );

	}

	vec4 plotSampleShape( float offset, vec2 coord ) {

		float shapeType = plotGetValue( offset );
		vec4 fill = vec4(
			plotGetValue( offset + 2.0 ),
			plotGetValue( offset + 3.0 ),
			plotGetValue( offset + 4.0 ),
			plotGetValue( offset + 5.0 )
		);
		vec4 stroke = vec4(
			plotGetValue( offset + 6.0 ),
			plotGetValue( offset + 7.0 ),
			plotGetValue( offset + 8.0 ),
			plotGetValue( offset + 9.0 )
		);
		float strokeWidth = plotGetValue( offset + 10.0 );
		float payloadOffset = offset + 12.0;

		float signedDistance = 1e20;
		bool supportsFill = true;
		bool supportsStroke = strokeWidth > 0.0;

		if ( abs( shapeType - 0.0 ) < 0.5 ) {

			vec2 center = vec2( plotGetValue( payloadOffset ), plotGetValue( payloadOffset + 1.0 ) );
			vec2 halfSize = vec2( plotGetValue( payloadOffset + 2.0 ), plotGetValue( payloadOffset + 3.0 ) );
			signedDistance = plotSdBox( coord, center, halfSize );

		} else if ( abs( shapeType - 1.0 ) < 0.5 || abs( shapeType - 6.0 ) < 0.5 ) {

			vec2 center = vec2( plotGetValue( payloadOffset ), plotGetValue( payloadOffset + 1.0 ) );
			float radius = plotGetValue( payloadOffset + 2.0 );
			signedDistance = distance( coord, center ) - radius;

		} else if ( abs( shapeType - 2.0 ) < 0.5 ) {

			int pointCount = int( floor( plotGetValue( payloadOffset ) + 0.5 ) );
			float pointsOffset = payloadOffset + 1.0;
			float edgeDistance = plotDistanceToPolyline( coord, pointsOffset, pointCount, true );
			signedDistance = plotPolygonContains( coord, pointsOffset, pointCount ) ? - edgeDistance : edgeDistance;

		} else if ( abs( shapeType - 3.0 ) < 0.5 ) {

			int pointCount = int( floor( plotGetValue( payloadOffset ) + 0.5 ) );
			float pointsOffset = payloadOffset + 1.0;
			signedDistance = plotDistanceToPolyline( coord, pointsOffset, pointCount, false );
			supportsFill = false;
			supportsStroke = true;

		} else if ( abs( shapeType - 5.0 ) < 0.5 ) {

			vec2 center = vec2( plotGetValue( payloadOffset ), plotGetValue( payloadOffset + 1.0 ) );
			float radius = plotGetValue( payloadOffset + 2.0 );
			float startAngle = plotGetValue( payloadOffset + 4.0 );
			float sectorAngle = plotGetValue( payloadOffset + 5.0 );
			signedDistance = distance( coord, center ) - radius;

			if ( signedDistance <= 0.0 ) {

				float angle = atan( coord.y - center.y, coord.x - center.x ) - startAngle;
				float circle = 6.28318530718;
				while ( angle < 0.0 ) angle += circle;
				while ( angle > circle ) angle -= circle;
				if ( angle > sectorAngle ) signedDistance = radius;

			}

		}

		if ( supportsStroke && abs( signedDistance ) <= strokeWidth * 0.5 ) return stroke;
		if ( supportsFill && signedDistance <= 0.0 ) return fill;
		return vec4( 0.0 );

	}
`;

const fragmentApply = /* glsl */`
	if ( plotOpacity > 1e-4 ) {

		vec2 coord = plotGetCoord();
		float shapeCount = plotGetValue( 0.0 );
		float offset = 1.0;
		vec4 plotColor = vec4( 0.0 );

		for ( int shapeIndex = 0; shapeIndex < 128; shapeIndex ++ ) {

			if ( float( shapeIndex ) >= shapeCount ) break;

			vec4 shapeColor = plotSampleShape( offset, coord );
			if ( shapeColor.a > 0.0 ) {

				plotColor = plotBlend( plotColor, shapeColor );

			}

			offset += plotGetValue( offset + 1.0 );

		}

		plotColor.a *= plotOpacity;
		if ( plotColor.a > 1e-4 ) {

			plotColor.rgb *= plotColor.a;
			diffuseColor = plotColor + diffuseColor * ( 1.0 - plotColor.a );

		}

	}
`;

function logTiledSdfMaterial( ...args ) {

	console.log( '[PlotEngine][TiledSdfMaterial]', ...args );

}

function getState( material ) {

	return material?.userData?.[ PLOT_SDF_STATE ] ?? null;

}

function ensureUserData( material ) {

	if ( ! material.userData ) material.userData = {};
	return material.userData;

}

function assignTexture( state, nextTexture ) {

	state.uniforms.plotSdfTexture.value = nextTexture;
	state.uniforms.plotSdfTextureWidth.value = nextTexture.image?.width ?? 1;

}

export function wrapTiledSdfMaterial( material ) {

	if ( ! material ) return null;

	const existing = getState( material );
	if ( existing ) return existing;

	const userData = ensureUserData( material );
	const previousOnBeforeCompile = material.onBeforeCompile;
	const previousProgramCacheKey = typeof material.customProgramCacheKey === 'function'
		? material.customProgramCacheKey.bind( material )
		: null;

	const state = {
		uniforms: {
			plotSdfTexture: { value: EMPTY_TEXTURE },
			plotSdfTextureWidth: { value: 1 },
			plotTileBounds: { value: new Vector4() },
			plotOpacity: { value: 0 },
		},
		previousOnBeforeCompile,
		previousProgramCacheKey,
	};

	userData[ PLOT_SDF_STATE ] = state;

	material.onBeforeCompile = shader => {

		previousOnBeforeCompile?.( shader );
		logTiledSdfMaterial( 'onBeforeCompile', {
			materialName: material.name || '(unnamed-material)',
			materialType: material.type || '(unknown-type)',
		} );

		shader.uniforms = {
			...shader.uniforms,
			...state.uniforms,
		};

		shader.vertexShader = shader.vertexShader
			.replace(
				/void main\(\s*\)\s*{/,
				match => `${ vertexPreamble }\n${ match }\n\tvPlotUv = plotUv;`,
			);

		shader.fragmentShader = shader.fragmentShader
			.replace(
				/void main\(\s*\)/,
				match => `${ fragmentPreamble }\n${ match }`,
			)
			.replace(
				'#include <alphamap_fragment>',
				`${ fragmentApply }\n\t#include <alphamap_fragment>`,
			);

	};

	material.customProgramCacheKey = () => {

		const previousKey = previousProgramCacheKey ? previousProgramCacheKey() : '';
		return `${ previousKey }|plot-engine-tiled-sdf-v2`;

	};

	material.needsUpdate = true;
	return state;

}

export function updateWrappedTiledSdfMaterial( material, texture, bounds, opacity = 1 ) {

	const state = wrapTiledSdfMaterial( material );
	if ( ! state ) return null;

	assignTexture( state, texture ?? EMPTY_TEXTURE );
	state.uniforms.plotTileBounds.value.set( bounds[ 0 ], bounds[ 1 ], bounds[ 2 ], bounds[ 3 ] );
	state.uniforms.plotOpacity.value = texture ? opacity : 0;
	return state;

}

export function clearWrappedTiledSdfMaterial( material ) {

	const state = getState( material );
	if ( ! state ) return;

	assignTexture( state, EMPTY_TEXTURE );
	state.uniforms.plotOpacity.value = 0;

}

export function disposeWrappedTiledSdfMaterial( material ) {

	const state = getState( material );
	if ( ! state ) return;

	clearWrappedTiledSdfMaterial( material );
	delete material.userData[ PLOT_SDF_STATE ];
	material.onBeforeCompile = state.previousOnBeforeCompile;
	if ( state.previousProgramCacheKey ) {

		material.customProgramCacheKey = state.previousProgramCacheKey;

	} else {

		delete material.customProgramCacheKey;

	}

	material.needsUpdate = true;

}
