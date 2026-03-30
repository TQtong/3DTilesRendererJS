import { createFineArrow, createCurvedArrow, createAttackArrow } from './ArrowUtils.js';
import {
	Scene,
	WebGLRenderTarget,
	DepthTexture,
	ShaderMaterial,
	PlaneGeometry,
	Mesh,
	OrthographicCamera,
	Matrix4,
	Vector3,
	DataTexture,
	CanvasTexture,
	FloatType,
	RGBAFormat,
	NearestFilter,
	LinearFilter,
	LinearSRGBColorSpace,
	MathUtils,
	GLSL3,
} from 'three';

// ── Shaders ──

const DECAL_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const DECAL_FRAGMENT = /* glsl */ `
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tShapeData;
uniform sampler2D tLabelAtlas;
uniform mat4 uInvProjection;
uniform mat4 uViewToECEF;
uniform vec3 uOffsetHigh;
uniform vec3 uOffsetLow;
uniform vec3 uEast;
uniform vec3 uNorth;
uniform float uGlobalOpacity;

float readF( int i ) {
	int pi = i / 4;
	vec4 t = texelFetch( tShapeData, ivec2( pi, 0 ), 0 );
	int c = i - pi * 4;
	return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w;
}

float sdBox( vec2 p, vec2 b ) {
	vec2 d = abs( p ) - b;
	return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 );
}

float sdSeg( vec2 p, vec2 a, vec2 b ) {
	vec2 pa = p - a, ba = b - a;
	float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
	return length( pa - ba * h );
}

float sdTri( vec2 p, vec2 a, vec2 b, vec2 c ) {
	vec2 e0 = b - a, e1 = c - b, e2 = a - c;
	vec2 v0 = p - a, v1 = p - b, v2 = p - c;
	vec2 q0 = v0 - e0 * clamp( dot( v0, e0 ) / dot( e0, e0 ), 0.0, 1.0 );
	vec2 q1 = v1 - e1 * clamp( dot( v1, e1 ) / dot( e1, e1 ), 0.0, 1.0 );
	vec2 q2 = v2 - e2 * clamp( dot( v2, e2 ) / dot( e2, e2 ), 0.0, 1.0 );
	float s = sign( e0.x * e2.y - e0.y * e2.x );
	vec2 d0 = vec2( dot( q0, q0 ), s * ( v0.x * e0.y - v0.y * e0.x ) );
	vec2 d1 = vec2( dot( q1, q1 ), s * ( v1.x * e1.y - v1.y * e1.x ) );
	vec2 d2 = vec2( dot( q2, q2 ), s * ( v2.x * e2.y - v2.y * e2.x ) );
	vec2 dm = min( min( d0, d1 ), d2 );
	return - sqrt( dm.x ) * sign( dm.y );
}

float arrowSdf( vec2 local, int style, float sz, float hw ) {
	float w = max( sz * 0.45, hw * 1.5 );
	sz = max( sz, hw * 4.0 );
	float ov = hw * 2.0;
	if ( style == 1 || style == 2 ) {
		return sdTri( local, vec2( sz, 0.0 ), vec2( - ov, w ), vec2( - ov, - w ) );
	} else if ( style == 3 || style == 4 ) {
		vec2 shifted = vec2( local.x + ov * 0.5, local.y );
		vec2 al = abs( shifted );
		float hs = ( sz + ov ) * 0.5;
		return ( al.x / hs + al.y / w ) - 1.0;
	} else if ( style == 5 || style == 6 ) {
		return length( local ) - max( sz * 0.4, hw * 2.0 );
	} else if ( style == 7 ) {
		return sdBox( local, vec2( sz * 0.08, w)  );
	}
	return 1e10;
}

void applyFill( inout vec4 result, vec4 fc, float sdf, float aa, float op ) {
	if ( fc.w > 0.001 && sdf < aa ) {
		float m = 1.0 - smoothstep( - aa, 0.0, sdf );
		result = mix( result, vec4( fc.rgb, 1.0 ), fc.w * op * m * uGlobalOpacity );
	}
}

void applyStroke( inout vec4 result, vec4 sc, float sdf, float sw, float aa, float op ) {
	if ( sc.w > 0.001 && sw > 0.0 ) {
		float inner = smoothstep( - aa, 0.0, sdf );
		float outer = 1.0 - smoothstep( sw, sw + aa, sdf );
		float m = inner * outer;
		result = mix( result, vec4( sc.rgb, 1.0 ), sc.w * op * m * uGlobalOpacity );
	}
}

void main() {
	vec4 scene = texture( tColor, vUv );
	float depth = texture( tDepth, vUv ).r;

	fragColor = scene;
	if ( depth >= 0.9999 ) return;
	if ( fwidth( depth ) > 0.0005 ) return;

	vec4 cp = vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
	vec4 vp = uInvProjection * cp;
	vec3 view = vp.xyz / vp.w;
	vec3 rot = mat3( uViewToECEF ) * view;
	vec3 delta = ( rot + uOffsetHigh ) + uOffsetLow;

	float e = dot( delta, uEast );
	float n = dot( delta, uNorth );
	vec2 pos = vec2( e, n );

	float aa = max( fwidth( e ), fwidth( n ) ) * 1.5;

	int count = int( readF( 0 ) );
	int off = 1;
	vec4 result = scene;

	for ( int s = 0; s < 64; s ++ ) {

		if ( s >= count ) break;

		int type  = int( readF( off ) );
		int total = int( readF( off + 1 ) );

		vec4  fc = vec4( readF( off + 2 ), readF( off + 3 ), readF( off + 4 ), readF( off + 5 ) );
		vec4  sc = vec4( readF( off + 6 ), readF( off + 7 ), readF( off + 8 ), readF( off + 9 ) );
		float sw = readF( off + 10 );
		float op = readF( off + 11 );

		if ( type == 0 ) {

			vec2 c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			vec2 hs = vec2( readF( off + 14 ), readF( off + 15 ) );
			float d = sdBox( pos - c, hs );
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		} else if ( type == 1 ) {

			vec2  c = vec2( readF( off + 12 ), readF( off + 13 ) );
			float r = readF( off + 14 );
			float d = length( pos - c ) - r;
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		} else if ( type == 2 ) {

			int vc = int( readF( off + 12 ) );
			int vs = off + 13;
			int wn = 0;
			float ed = 1e10;

			for ( int i = 0; i < 64; i ++ ) {

				if ( i >= vc ) break;
				int j = i + 1 < vc ? i + 1 : 0;
				vec2 a = vec2( readF( vs + i * 2 ), readF( vs + i * 2 + 1 ) );
				vec2 b = vec2( readF( vs + j * 2 ), readF( vs + j * 2 + 1 ) );

				ed = min( ed, sdSeg( pos, a, b ) );

				if ( a.y <= pos.y ) {
					if ( b.y > pos.y ) {
						if ( ( b.x - a.x ) * ( pos.y - a.y ) - ( pos.x - a.x ) * ( b.y - a.y ) > 0.0 ) wn ++;
					}
				} else {
					if ( b.y <= pos.y ) {
						if ( ( b.x - a.x ) * ( pos.y - a.y ) - ( pos.x - a.x ) * ( b.y - a.y ) < 0.0 ) wn --;
					}
				}

			}

			bool inside = wn != 0;
			float d = inside ? - ed : ed;
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		} else if ( type == 3 ) {

			int   vc = int( readF( off + 12 ) );
			float hw = readF( off + 13 );
			int   sa = int( readF( off + 14 ) );
			int   ea = int( readF( off + 15 ) );
			float asz = readF( off + 16 );
			int   vs = off + 17;
			float d  = 1e10;

			vec2 v0 = vec2( readF( vs ), readF( vs + 1 ) );
			vec2 v1 = vec2( readF( vs + 2 ), readF( vs + 3 ) );
			vec2 vL = vec2( readF( vs + ( vc - 1 ) * 2 ), readF( vs + ( vc - 1 ) * 2 + 1 ) );
			vec2 vP = vec2( readF( vs + ( vc - 2 ) * 2 ), readF( vs + ( vc - 2 ) * 2 + 1 ) );

			for ( int i = 0; i < 63; i ++ ) {

				if ( i >= vc - 1 ) break;
				vec2 a = vec2( readF( vs + i * 2 ),       readF( vs + i * 2 + 1 ) );
				vec2 b = vec2( readF( vs + ( i + 1 ) * 2 ), readF( vs + ( i + 1 ) * 2 + 1 ) );
				d = min( d, sdSeg( pos, a, b ) );

			}

			d -= hw;

			if ( sa > 0 ) {

				float beyond = - dot( pos - v0, normalize( v1 - v0 ) );
				if ( beyond > 0.0 ) d = max( d, beyond );

			}

			if ( ea > 0 ) {

				float beyond = - dot( pos - vL, normalize( vP - vL ) );
				if ( beyond > 0.0 ) d = max( d, beyond );

			}

			float arrowD = 1e10;

			if ( sa > 0 ) {

				vec2 dr = normalize( v0 - v1 );
				vec2 lc = vec2( dot( pos - v0, dr ), dot( pos - v0, vec2( - dr.y, dr.x ) ) );
				float ad = arrowSdf( lc, sa, asz, hw );
				arrowD = min( arrowD, ad );

			}

			if ( ea > 0 ) {

				vec2 dr = normalize( vL - vP );
				vec2 lc = vec2( dot( pos - vL, dr ), dot( pos - vL, vec2( - dr.y, dr.x ) ) );
				float ad = arrowSdf( lc, ea, asz, hw );
				arrowD = min( arrowD, ad );

			}

			bool arrowFilled = ( sa == 1 || sa == 3 || sa == 5 || ea == 1 || ea == 3 || ea == 5 );
			float combined = min( d, arrowD );

			if ( combined < aa ) {

				vec4 lc = sc.w > 0.001 ? sc : fc;

				if ( arrowFilled && arrowD < d && arrowD < aa ) {

					applyFill( result, lc, arrowD, aa, op );
					applyStroke( result, lc, arrowD, sw, aa, op );

				} else {

					float m = 1.0 - smoothstep( - aa, 0.0, combined );
					result = mix( result, vec4( lc.rgb, 1.0 ), max( lc.w, fc.w ) * op * m * uGlobalOpacity );

				}

			}

			if ( arrowD < aa && ! arrowFilled ) {

				vec4 lc = sc.w > 0.001 ? sc : fc;
				applyStroke( result, lc, arrowD, sw * 0.5, aa, op );

			}

		} else if ( type == 4 ) {

			vec2 c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			vec2 hs = vec2( readF( off + 14 ), readF( off + 15 ) );
			vec4 ub = vec4( readF( off + 16 ), readF( off + 17 ), readF( off + 18 ), readF( off + 19 ) );

			vec2 local = vec2(
				( pos.x - c.x + hs.x ) / ( 2.0 * hs.x ),
				1.0 - ( pos.y - c.y + hs.y ) / ( 2.0 * hs.y )
			);

			if ( local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0 ) {
				vec2 auv = mix( ub.xy, ub.zw, local );
				vec4 lc = texture( tLabelAtlas, auv );
				if ( lc.a > 0.01 ) {
					result = mix( result, vec4( lc.rgb, 1.0 ), lc.a * op * uGlobalOpacity );
				}
			}

		} else if ( type == 5 ) {

			vec2  c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			float r  = readF( off + 14 );
			float sa = readF( off + 15 );
			float da = readF( off + 16 );

			vec2 d = pos - c;
			float dist = length( d );

			vec2 e1 = vec2( cos( sa ), sin( sa ) );
			vec2 e2 = vec2( cos( sa + da ), sin( sa + da ) );
			float cr1 = d.x * e1.y - d.y * e1.x;
			float cr2 = d.x * e2.y - d.y * e2.x;

			bool inAngle = da <= 3.14159 ? ( cr1 >= 0.0 && cr2 <= 0.0 ) : ( cr1 >= 0.0 || cr2 <= 0.0 );
			bool inside = inAngle && dist <= r;

			float ed = min( sdSeg( d, vec2( 0.0 ), r * e1 ), sdSeg( d, vec2( 0.0 ), r * e2 ) );
			if ( inAngle ) ed = min( ed, abs( dist - r ) );

			float fillSdf = inAngle ? ( dist - r ) : ed;
			applyFill( result, fc, fillSdf, aa, op );
			float arcSdf = inAngle ? ( dist - r ) : 1e10;
			applyStroke( result, sc, arcSdf, sw, aa, op );

		} else if ( type == 6 ) {

			vec2  c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			float hs = readF( off + 14 );
			int   ps = int( readF( off + 15 ) );

			float sdf = ps == 1 ? sdBox( pos - c, vec2( hs ) ) : length( pos - c ) - hs;
			applyFill( result, fc, sdf, aa, op );
			applyStroke( result, sc, sdf, sw, aa, op );

		}

		off += total;

	}

	fragColor = result;
}
`;

// ── Helpers ──

let _nextId = 1;
const DEG2RAD = MathUtils.DEG2RAD;
const REF_DENSITY = 4096;
const LABEL_ATLAS = 2048;

const _pos = new Vector3();

function lonLatToMeters( lonDeg, latDeg, centerLonRad, centerLatRad, ellipsoid, east, north, centerECEF ) {

	ellipsoid.getCartographicToPosition( latDeg * DEG2RAD, lonDeg * DEG2RAD, 0, _pos );
	const dx = _pos.x - centerECEF.x;
	const dy = _pos.y - centerECEF.y;
	const dz = _pos.z - centerECEF.z;
	return {
		e: dx * east.x + dy * east.y + dz * east.z,
		n: dx * north.x + dy * north.y + dz * north.z,
	};

}

function parseColorToRGBA( color ) {

	if ( ! color || color === 'transparent' ) return [ 0, 0, 0, 0 ];

	if ( typeof color === 'string' ) {

		const m = color.match( /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/ );
		if ( m ) {

			return [
				parseInt( m[ 1 ] ) / 255,
				parseInt( m[ 2 ] ) / 255,
				parseInt( m[ 3 ] ) / 255,
				m[ 4 ] !== undefined ? parseFloat( m[ 4 ] ) : 1.0,
			];

		}

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

function resolveOpacity( style, base ) {

	if ( style.fillOpacity !== undefined ) base[ 0 ] = style.fillOpacity / 100;
	else if ( style.opacity !== undefined ) base[ 0 ] = style.opacity;
	else base[ 0 ] = 1;

	if ( style.strokeOpacity !== undefined ) base[ 1 ] = style.strokeOpacity / 100;
	else if ( style.opacity !== undefined ) base[ 1 ] = style.opacity;
	else base[ 1 ] = 1;

}

// ── GroundDecalManager ──

export class GroundDecalManager {

	constructor( renderer, options = {} ) {

		this._renderer = renderer;
		this._items = new Map();
		this._dataDirty = true;
		this._globalOpacity = options.opacity ?? 1.0;

		this._centerECEF = new Vector3();
		this._east = new Vector3();
		this._north = new Vector3();
		this._up = new Vector3();
		this._centerLatRad = 0;
		this._centerLonRad = 0;
		this._ellipsoid = null;
		this._tilesGroup = null;

		this._maxExtent = 1;

		this._viewToECEF = new Matrix4();

		this._shapeDataTex = null;
		this._shapeDataTexWidth = 1;
		this._labelCanvas = document.createElement( 'canvas' );
		this._labelCanvas.width = LABEL_ATLAS;
		this._labelCanvas.height = LABEL_ATLAS;
		this._labelAtlasTex = new CanvasTexture( this._labelCanvas );
		this._labelAtlasTex.flipY = false;
		this._labelAtlasTex.minFilter = LinearFilter;
		this._labelAtlasTex.magFilter = LinearFilter;

		this._depthRT = null;
		this._compositeScene = null;
		this._compositeCamera = null;
		this._compositeMaterial = null;

		this._initGPU();

	}

	// ── Public: shape creation ──

	addRect( center, size, style = {} ) {

		const id = _nextId ++;
		const halfW = ( size.w || size ) / 2;
		const halfH = ( size.h || size ) / 2;
		this._items.set( id, {
			type: 'rect',
			center: { lon: center.lon, lat: center.lat },
			halfW,
			halfH,
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	addCircle( center, radius, style = {} ) {

		const id = _nextId ++;
		this._items.set( id, {
			type: 'circle',
			center: { lon: center.lon, lat: center.lat },
			radius,
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	addPolygon( coords, style = {} ) {

		const id = _nextId ++;
		this._items.set( id, {
			type: 'polygon',
			coords,
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	addPolyline( coords, style = {} ) {

		const id = _nextId ++;
		this._items.set( id, {
			type: 'polyline',
			coords,
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	addLabel( center, text, style = {} ) {

		const id = _nextId ++;
		this._items.set( id, {
			type: 'label',
			center: { lon: center.lon, lat: center.lat },
			text,
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	addSector( center, radius, startAngle, sectorAngle, style = {} ) {

		const id = _nextId ++;
		this._items.set( id, {
			type: 'sector',
			center: { lon: center.lon, lat: center.lat },
			radius,
			startAngle,
			sectorAngle,
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	addPoint( center, size, style = {} ) {

		const id = _nextId ++;
		this._items.set( id, {
			type: 'point',
			center: { lon: center.lon, lat: center.lat },
			size,
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	addArrowPlot( controlPoints, style = {} ) {

		const id = _nextId ++;
		this._items.set( id, {
			type: 'arrowPlot',
			controlPoints: controlPoints.map( c => [ c[ 0 ], c[ 1 ] ] ),
			coords: [],
			style,
		} );
		this._dataDirty = true;
		return id;

	}

	remove( id ) {

		if ( this._items.delete( id ) ) {

			this._dataDirty = true;

		}

	}

	clear() {

		this._items.clear();
		this._dataDirty = true;

	}

	// ── Public: query & modify ──

	getItem( id ) {

		const item = this._items.get( id );
		if ( ! item ) return null;

		const out = { type: item.type, style: { ...item.style } };

		if ( item.center ) out.center = { lon: item.center.lon, lat: item.center.lat };
		if ( item.coords ) out.coords = item.coords.map( c => [ ...c ] );
		if ( item.halfW !== undefined ) {

			out.halfW = item.halfW;
			out.halfH = item.halfH;

		}

		if ( item.radius !== undefined ) out.radius = item.radius;
		if ( item.text !== undefined ) out.text = item.text;
		if ( item.startAngle !== undefined ) out.startAngle = item.startAngle;
		if ( item.sectorAngle !== undefined ) out.sectorAngle = item.sectorAngle;
		if ( item.size !== undefined ) out.size = item.size;
		if ( item.controlPoints ) out.controlPoints = item.controlPoints.map( c => [ ...c ] );

		return out;

	}

	setStyle( id, style ) {

		const item = this._items.get( id );
		if ( ! item ) return;

		Object.assign( item.style, style );
		this._dataDirty = true;

	}

	setCenter( id, center ) {

		const item = this._items.get( id );
		if ( ! item || ! item.center ) return;

		if ( center.lon !== undefined ) item.center.lon = center.lon;
		if ( center.lat !== undefined ) item.center.lat = center.lat;
		this._dataDirty = true;

	}

	setSize( id, size ) {

		const item = this._items.get( id );
		if ( ! item ) return;

		if ( item.type === 'rect' ) {

			if ( typeof size === 'number' ) {

				item.halfW = size / 2;
				item.halfH = size / 2;

			} else {

				if ( size.w !== undefined ) item.halfW = size.w / 2;
				if ( size.h !== undefined ) item.halfH = size.h / 2;

			}

		} else if ( item.type === 'circle' || item.type === 'sector' ) {

			item.radius = ( typeof size === 'number' ) ? size : ( size.radius ?? item.radius );
			if ( size.startAngle !== undefined && item.type === 'sector' ) item.startAngle = size.startAngle;
			if ( size.sectorAngle !== undefined && item.type === 'sector' ) item.sectorAngle = size.sectorAngle;

		} else if ( item.type === 'point' ) {

			item.size = ( typeof size === 'number' ) ? size : ( size.size ?? item.size );

		}

		this._dataDirty = true;

	}

	setCoords( id, coords ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;

		item.coords = coords.map( c => [ ...c ] );
		this._dataDirty = true;

	}

	setCoord( id, index, coord ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;
		if ( index < 0 || index >= item.coords.length ) return;

		if ( coord[ 0 ] !== undefined ) item.coords[ index ][ 0 ] = coord[ 0 ];
		if ( coord[ 1 ] !== undefined ) item.coords[ index ][ 1 ] = coord[ 1 ];
		this._dataDirty = true;

	}

	insertCoord( id, index, coord ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;

		const idx = Math.max( 0, Math.min( index, item.coords.length ) );
		item.coords.splice( idx, 0, [ ...coord ] );
		this._dataDirty = true;

	}

	removeCoord( id, index ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;
		if ( index < 0 || index >= item.coords.length ) return;

		const minVerts = item.type === 'polygon' ? 3 : 2;
		if ( item.coords.length <= minVerts ) return;

		item.coords.splice( index, 1 );
		this._dataDirty = true;

	}

	translateCoords( id, dLon, dLat ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;

		for ( const c of item.coords ) {

			c[ 0 ] += dLon;
			c[ 1 ] += dLat;

		}

		this._dataDirty = true;

	}

	setText( id, text ) {

		const item = this._items.get( id );
		if ( ! item || item.type !== 'label' ) return;

		item.text = text;
		this._dataDirty = true;

	}

	setGlobalOpacity( opacity ) {

		this._globalOpacity = opacity;

	}

	getCoordCount( id ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return 0;
		return item.coords.length;

	}

	findNearestCoord( id, lon, lat ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords || item.coords.length === 0 ) return - 1;

		let bestIdx = 0;
		let bestDist = Infinity;

		for ( let i = 0; i < item.coords.length; i ++ ) {

			const dLon = item.coords[ i ][ 0 ] - lon;
			const dLat = item.coords[ i ][ 1 ] - lat;
			const d = dLon * dLon + dLat * dLat;
			if ( d < bestDist ) {

				bestDist = d;
				bestIdx = i;

			}

		}

		return bestIdx;

	}

	// ── Public: lifecycle ──

	setEllipsoid( ellipsoid, tilesGroup ) {

		this._ellipsoid = ellipsoid;
		this._tilesGroup = tilesGroup;
		this._dataDirty = true;

	}

	resize( w, h ) {

		if ( ! this._depthRT ) return;
		const pw = w * window.devicePixelRatio;
		const ph = h * window.devicePixelRatio;
		this._depthRT.setSize( pw, ph );

	}

	render( scene, camera, tilesGroup ) {

		if ( this._items.size === 0 || ! this._ellipsoid ) return;

		if ( this._dataDirty ) {

			this._rebuildShapeData();

		}

		const renderer = this._renderer;

		renderer.setRenderTarget( this._depthRT );
		renderer.render( scene, camera );
		renderer.setRenderTarget( null );

		this._viewToECEF.multiplyMatrices( tilesGroup.matrixWorldInverse, camera.matrixWorld );
		const el = this._viewToECEF.elements;

		const ox = el[ 12 ] - this._centerECEF.x;
		const oy = el[ 13 ] - this._centerECEF.y;
		const oz = el[ 14 ] - this._centerECEF.z;

		const u = this._compositeMaterial.uniforms;
		u.tColor.value = this._depthRT.texture;
		u.tDepth.value = this._depthRT.depthTexture;
		u.tShapeData.value = this._shapeDataTex;
		u.tLabelAtlas.value = this._labelAtlasTex;
		u.uInvProjection.value.copy( camera.projectionMatrixInverse );
		u.uViewToECEF.value.copy( this._viewToECEF );
		u.uOffsetHigh.value.set( Math.fround( ox ), Math.fround( oy ), Math.fround( oz ) );
		u.uOffsetLow.value.set( ox - Math.fround( ox ), oy - Math.fround( oy ), oz - Math.fround( oz ) );
		u.uEast.value.copy( this._east );
		u.uNorth.value.copy( this._north );
		u.uGlobalOpacity.value = this._globalOpacity;

		renderer.render( this._compositeScene, this._compositeCamera );

	}

	dispose() {

		if ( this._depthRT ) this._depthRT.dispose();
		if ( this._shapeDataTex ) this._shapeDataTex.dispose();
		if ( this._labelAtlasTex ) this._labelAtlasTex.dispose();
		if ( this._compositeMaterial ) this._compositeMaterial.dispose();

	}

	// ── Private: GPU resources ──

	_initGPU() {

		const w = window.innerWidth * window.devicePixelRatio;
		const h = window.innerHeight * window.devicePixelRatio;

		this._depthRT = new WebGLRenderTarget( w, h, {
			depthTexture: new DepthTexture( w, h ),
		} );

		const emptyData = new Float32Array( 4 );
		this._shapeDataTex = new DataTexture( emptyData, 1, 1, RGBAFormat, FloatType );
		this._shapeDataTex.minFilter = NearestFilter;
		this._shapeDataTex.magFilter = NearestFilter;
		this._shapeDataTex.colorSpace = LinearSRGBColorSpace;
		this._shapeDataTex.needsUpdate = true;

		this._compositeMaterial = new ShaderMaterial( {
			glslVersion: GLSL3,
			uniforms: {
				tColor: { value: null },
				tDepth: { value: null },
				tShapeData: { value: this._shapeDataTex },
				tLabelAtlas: { value: this._labelAtlasTex },
				uInvProjection: { value: new Matrix4() },
				uViewToECEF: { value: new Matrix4() },
				uOffsetHigh: { value: new Vector3() },
				uOffsetLow: { value: new Vector3() },
				uEast: { value: new Vector3() },
				uNorth: { value: new Vector3() },
				uGlobalOpacity: { value: 1.0 },
			},
			vertexShader: DECAL_VERTEX,
			fragmentShader: DECAL_FRAGMENT,
			depthWrite: false,
			depthTest: false,
			transparent: true,
		} );

		const quad = new Mesh( new PlaneGeometry( 2, 2 ), this._compositeMaterial );
		this._compositeCamera = new OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
		this._compositeScene = new Scene();
		this._compositeScene.add( quad );

	}

	// ── Private: data rebuild ──

	_rebuildShapeData() {

		this._dataDirty = false;

		if ( this._items.size === 0 || ! this._ellipsoid ) return;

		this._computeCenter();
		this._computeMaxExtent();

		const mPerPx = this._maxExtent / REF_DENSITY;
		const labelTiles = this._buildLabelAtlas( mPerPx );

		let shapeCount = 0;
		const arr = [ 0 ];
		const opBuf = [ 1, 1 ];

		for ( const [ id, item ] of this._items ) {

			if ( item.style.visible === false ) continue;

			const fill = parseColorToRGBA( item.style.fill || item.style.fillColor );
			const stroke = parseColorToRGBA( item.style.stroke || item.style.strokeColor );

			resolveOpacity( item.style, opBuf );
			fill[ 3 ] *= opBuf[ 0 ];
			stroke[ 3 ] *= opBuf[ 1 ];

			const sw = ( item.style.strokeWidth || 0 ) * mPerPx;
			const op = 1.0;

			if ( item.type === 'rect' ) {

				const m = this._toMeters( item.center.lon, item.center.lat );
				arr.push(
					0, 16,
					fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
					stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
					sw, op,
					m.e, m.n, item.halfW, item.halfH
				);
				shapeCount ++;

			} else if ( item.type === 'circle' ) {

				const m = this._toMeters( item.center.lon, item.center.lat );
				arr.push(
					1, 15,
					fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
					stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
					sw, op,
					m.e, m.n, item.radius
				);
				shapeCount ++;

			} else if ( item.type === 'polygon' ) {

				const vc = item.coords.length;
				const total = 13 + vc * 2;
				arr.push(
					2, total,
					fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
					stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
					sw, op,
					vc
				);
				for ( const c of item.coords ) {

					const m = this._toMeters( c[ 0 ], c[ 1 ] );
					arr.push( m.e, m.n );

				}

				shapeCount ++;

			} else if ( item.type === 'polyline' ) {

				const vc = item.coords.length;
				const hw = ( item.style.strokeWidth || 3 ) * mPerPx / 2;
				const sa = this._arrowStyleToInt( item.style.startArrowStyle );
				const ea = this._arrowStyleToInt( item.style.endArrowStyle );
				const asz = ( item.style.arrowSize || 0 ) * mPerPx;
				const total = 17 + vc * 2;
				const lineColor = parseColorToRGBA( item.style.stroke || item.style.strokeColor || item.style.fill || '#ffffff' );
				lineColor[ 3 ] *= opBuf[ 1 ];
				arr.push(
					3, total,
					lineColor[ 0 ], lineColor[ 1 ], lineColor[ 2 ], lineColor[ 3 ],
					0, 0, 0, 0,
					0, op,
					vc, hw, sa, ea, asz
				);
				for ( const c of item.coords ) {

					const m = this._toMeters( c[ 0 ], c[ 1 ] );
					arr.push( m.e, m.n );

				}

				shapeCount ++;

			} else if ( item.type === 'label' ) {

				const m = this._toMeters( item.center.lon, item.center.lat );
				const tile = labelTiles.get( id );
				if ( ! tile ) continue;

				arr.push(
					4, 20,
					0, 0, 0, 0,
					0, 0, 0, 0,
					0, op,
					m.e, m.n, tile.halfW, tile.halfH,
					tile.u0, tile.v0, tile.u1, tile.v1
				);
				shapeCount ++;

			} else if ( item.type === 'sector' ) {

				const m = this._toMeters( item.center.lon, item.center.lat );
				arr.push(
					5, 17,
					fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
					stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
					sw, op,
					m.e, m.n, item.radius,
					item.startAngle * DEG2RAD,
					item.sectorAngle * DEG2RAD
				);
				shapeCount ++;

			} else if ( item.type === 'point' ) {

				const m = this._toMeters( item.center.lon, item.center.lat );
				const halfSize = item.size / 2;
				const ps = item.style.pointStyle === 'square' ? 1 : 0;
				arr.push(
					6, 16,
					fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
					stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
					sw, op,
					m.e, m.n, halfSize, ps
				);
				shapeCount ++;

			} else if ( item.type === 'arrowPlot' ) {

				const cp = item.controlPoints;
				const arrowType = item.style.arrowType || 'straight';
				let verts;
				if ( arrowType === 'fine' ) {

					verts = createFineArrow( cp[ 0 ], cp[ 1 ] );

				} else if ( arrowType === 'curved' ) {

					verts = createCurvedArrow( cp );

				} else if ( arrowType === 'attack' && cp.length >= 3 ) {

					verts = createAttackArrow( cp );

				} else {

					verts = createFineArrow( cp[ 0 ], cp[ cp.length - 1 ] );

				}

				item.coords = verts;
				const vc = verts.length;
				const total = 13 + vc * 2;
				arr.push(
					2, total,
					fill[ 0 ], fill[ 1 ], fill[ 2 ], fill[ 3 ],
					stroke[ 0 ], stroke[ 1 ], stroke[ 2 ], stroke[ 3 ],
					sw, op,
					vc
				);
				for ( const c of verts ) {

					const m = this._toMeters( c[ 0 ], c[ 1 ] );
					arr.push( m.e, m.n );

				}

				shapeCount ++;

			}

		}

		arr[ 0 ] = shapeCount;

		const data = new Float32Array( arr );
		const texWidth = Math.ceil( data.length / 4 );
		const padded = new Float32Array( texWidth * 4 );
		padded.set( data );

		if ( this._shapeDataTex ) this._shapeDataTex.dispose();
		this._shapeDataTex = new DataTexture( padded, texWidth, 1, RGBAFormat, FloatType );
		this._shapeDataTex.minFilter = NearestFilter;
		this._shapeDataTex.magFilter = NearestFilter;
		this._shapeDataTex.colorSpace = LinearSRGBColorSpace;
		this._shapeDataTex.needsUpdate = true;
		this._shapeDataTexWidth = texWidth;

	}

	_computeCenter() {

		let lonSum = 0, latSum = 0, count = 0;

		for ( const item of this._items.values() ) {

			if ( item.center ) {

				lonSum += item.center.lon;
				latSum += item.center.lat;
				count ++;

			} else if ( item.coords ) {

				for ( const c of item.coords ) {

					lonSum += c[ 0 ];
					latSum += c[ 1 ];
					count ++;

				}

			}

		}

		if ( count === 0 ) return;

		this._centerLonRad = ( lonSum / count ) * DEG2RAD;
		this._centerLatRad = ( latSum / count ) * DEG2RAD;

		this._ellipsoid.getCartographicToPosition(
			this._centerLatRad, this._centerLonRad, 0, this._centerECEF
		);
		this._ellipsoid.getEastNorthUpAxes(
			this._centerLatRad, this._centerLonRad,
			this._east, this._north, this._up
		);

	}

	_computeMaxExtent() {

		let eMin = Infinity, eMax = - Infinity;
		let nMin = Infinity, nMax = - Infinity;

		const addPoint = ( lon, lat ) => {

			const m = this._toMeters( lon, lat );
			if ( m.e < eMin ) eMin = m.e;
			if ( m.e > eMax ) eMax = m.e;
			if ( m.n < nMin ) nMin = m.n;
			if ( m.n > nMax ) nMax = m.n;

		};

		for ( const item of this._items.values() ) {

			if ( item.type === 'rect' ) {

				addPoint( item.center.lon, item.center.lat );
				const dLon = item.halfW / ( 111320 * Math.cos( item.center.lat * DEG2RAD ) );
				const dLat = item.halfH / 111320;
				addPoint( item.center.lon - dLon, item.center.lat - dLat );
				addPoint( item.center.lon + dLon, item.center.lat + dLat );

			} else if ( item.type === 'circle' || item.type === 'sector' ) {

				const dLon = item.radius / ( 111320 * Math.cos( item.center.lat * DEG2RAD ) );
				const dLat = item.radius / 111320;
				addPoint( item.center.lon - dLon, item.center.lat - dLat );
				addPoint( item.center.lon + dLon, item.center.lat + dLat );

			} else if ( item.type === 'polygon' || item.type === 'polyline' ) {

				for ( const c of item.coords ) addPoint( c[ 0 ], c[ 1 ] );

			} else if ( item.type === 'arrowPlot' ) {

				for ( const c of item.controlPoints ) addPoint( c[ 0 ], c[ 1 ] );

			} else if ( item.type === 'label' || item.type === 'point' ) {

				addPoint( item.center.lon, item.center.lat );

			}

		}

		const rangeE = ( eMax - eMin ) || 1;
		const rangeN = ( nMax - nMin ) || 1;
		this._maxExtent = Math.max( rangeE, rangeN );

	}

	_arrowStyleToInt( style ) {

		if ( ! style ) return 0;
		const map = {
			'filled': 1, 'open': 2,
			'filledDiamond': 3, 'openDiamond': 4,
			'filledCircle': 5, 'openCircle': 6,
			'bar': 7,
		};
		return map[ style ] || 0;

	}

	_toMeters( lonDeg, latDeg ) {

		return lonLatToMeters(
			lonDeg, latDeg,
			this._centerLonRad, this._centerLatRad,
			this._ellipsoid, this._east, this._north, this._centerECEF
		);

	}

	// ── Private: label atlas ──

	_buildLabelAtlas( mPerPx ) {

		const tiles = new Map();
		const ctx = this._labelCanvas.getContext( '2d' );
		ctx.clearRect( 0, 0, LABEL_ATLAS, LABEL_ATLAS );

		let cursorX = 0, cursorY = 0, rowH = 0;

		for ( const [ id, item ] of this._items ) {

			if ( item.type !== 'label' ) continue;

			const font = item.style.font || '48px sans-serif';
			const pad = ( item.style.strokeWidth || 4 ) + 6;

			ctx.font = font;
			const metrics = ctx.measureText( item.text );
			const tw = Math.ceil( metrics.width + pad * 2 );
			const fontSize = parseInt( font ) || 48;
			const th = Math.ceil( fontSize * 1.4 + pad * 2 );

			if ( cursorX + tw > LABEL_ATLAS ) {

				cursorX = 0;
				cursorY += rowH;
				rowH = 0;

			}

			if ( cursorY + th > LABEL_ATLAS ) break;

			const tx = cursorX;
			const ty = cursorY;
			const cx = tx + tw / 2;
			const cy = ty + th / 2;

			ctx.font = font;
			ctx.textAlign = item.style.textAlign || 'center';
			ctx.textBaseline = 'middle';

			if ( item.style.stroke ) {

				ctx.strokeStyle = item.style.stroke;
				ctx.lineWidth = item.style.strokeWidth || 4;
				ctx.strokeText( item.text, cx, cy );

			}

			ctx.fillStyle = item.style.fontColor || item.style.fill || '#ffffff';
			ctx.globalAlpha = 1;
			ctx.fillText( item.text, cx, cy );

			const halfW = tw * mPerPx / 2;
			const halfH = th * mPerPx / 2;

			tiles.set( id, {
				halfW,
				halfH,
				u0: tx / LABEL_ATLAS,
				v0: ty / LABEL_ATLAS,
				u1: ( tx + tw ) / LABEL_ATLAS,
				v1: ( ty + th ) / LABEL_ATLAS,
			} );

			cursorX += tw;
			if ( th > rowH ) rowH = th;

		}

		this._labelAtlasTex.needsUpdate = true;
		return tiles;

	}

}
