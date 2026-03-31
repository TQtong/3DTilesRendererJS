/**
 * TileSdfShader.js — Per-tile SDF 着色器
 *
 * 在 lon/lat 度坐标系下工作，不依赖深度缓冲重建。
 * UV [0,1] 直接映射到瓦片的 lon/lat 地理范围。
 * smoothstep 提供像素级完美抗锯齿。
 *
 * 数据纹理打包格式（12-float 头部 + 图形特有数据）：
 *   arr[0] = 图形总数
 *   每个图形：
 *     [0]  type           [1]  totalFloats
 *     [2-5]  fillRGBA     [6-9]  strokeRGBA
 *     [10] strokeWidth（度） [11] opacity
 *     [12+] 图形特有数据（坐标全部为 lon/lat 度）
 *
 * 图形类型：
 *   0 = rect:    [12] centerLon [13] centerLat [14] halfWDeg [15] halfHDeg
 *   1 = circle:  [12] centerLon [13] centerLat [14] radiusDegLon [15] radiusDegLat
 *   2 = polygon: [12] vc [13..] lon0,lat0, lon1,lat1, ...
 *   3 = polyline: [12] vc [13] hwDeg [14] startArrow [15] endArrow [16] aszDeg [17..] vertices
 *   4 = text:    [12] centerLon [13] centerLat [14] halfWDeg [15] halfHDeg [16-19] UVs
 *   5 = sector:  [12] centerLon [13] centerLat [14] rDegLon [15] rDegLat [16] startAngle [17] sectorAngle
 *   6 = point:   [12] centerLon [13] centerLat [14] halfSizeDegLon [15] halfSizeDegLat [16] pointStyle
 */

export const TILE_SDF_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

export const TILE_SDF_FRAGMENT = /* glsl */ `
precision highp int;

in vec2 vUv;
out vec4 fragColor;

uniform vec4 uTileBounds;       // [minLon, minLat, maxLon, maxLat] degrees
uniform float uResolution;      // tile texture resolution (pixels)
uniform sampler2D tShapeData;
uniform sampler2D tLabelAtlas;

float readF( int i ) {
	int pi = i / 4;
	vec4 t = texelFetch( tShapeData, ivec2( pi, 0 ), 0 );
	int c = i - pi * 4;
	return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w;
}

// ── SDF 原语（lon/lat 度坐标系） ──

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
	float w = sz * 0.45;
	float ov = hw * 2.0;
	if ( style == 1 || style == 2 ) {
		return sdTri( local, vec2( sz, 0.0 ), vec2( - ov, w ), vec2( - ov, - w ) );
	} else if ( style == 3 || style == 4 ) {
		vec2 shifted = vec2( local.x + ov * 0.5, local.y );
		vec2 al = abs( shifted );
		float hs = ( sz + ov ) * 0.5;
		return ( al.x / hs + al.y / w ) - 1.0;
	} else if ( style == 5 || style == 6 ) {
		return length( local ) - sz * 0.4;
	} else if ( style == 7 ) {
		return sdBox( local, vec2( sz * 0.08, w ) );
	}
	return 1e10;
}

// ── Fill / Stroke ──

void applyFill( inout vec4 result, vec4 fc, float sdf, float aa, float op ) {
	if ( fc.w > 0.001 && sdf < aa ) {
		float m = 1.0 - smoothstep( - aa, 0.0, sdf );
		result = mix( result, vec4( fc.rgb, 1.0 ), fc.w * op * m );
	}
}

void applyStroke( inout vec4 result, vec4 sc, float sdf, float sw, float aa, float op ) {
	if ( sc.w > 0.001 && sw > 0.0 ) {
		float inner = smoothstep( - aa, 0.0, sdf );
		float outer = 1.0 - smoothstep( sw, sw + aa, sdf );
		float m = inner * outer;
		result = mix( result, vec4( sc.rgb, 1.0 ), sc.w * op * m );
	}
}

void main() {
	// UV → lon/lat degrees（WebGL UV.y=0 在底部=南=minLat，不需要翻转）
	float lon = mix( uTileBounds.x, uTileBounds.z, vUv.x );
	float lat = mix( uTileBounds.y, uTileBounds.w, vUv.y );
	vec2 pos = vec2( lon, lat );

	// 每像素覆盖的度数（用于 AA 和 strokeWidth）
	float pxLon = ( uTileBounds.z - uTileBounds.x ) / uResolution;
	float pxLat = ( uTileBounds.w - uTileBounds.y ) / uResolution;
	float aa = max( pxLon, pxLat ) * 1.5;

	int count = int( readF( 0 ) );
	int off = 1;
	vec4 result = vec4( 0.0 );

	for ( int s = 0; s < 64; s ++ ) {

		if ( s >= count ) break;

		int type  = int( readF( off ) );
		int total = int( readF( off + 1 ) );
		vec4 fc = vec4( readF( off + 2 ), readF( off + 3 ), readF( off + 4 ), readF( off + 5 ) );
		vec4 sc = vec4( readF( off + 6 ), readF( off + 7 ), readF( off + 8 ), readF( off + 9 ) );
		float sw = readF( off + 10 );
		float op = readF( off + 11 );

		// ── type 0: rect ──
		if ( type == 0 ) {

			vec2 c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			vec2 hs = vec2( readF( off + 14 ), readF( off + 15 ) );
			float d = sdBox( pos - c, hs );
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		// ── type 1: circle（椭圆，补偿纬度变形） ──
		} else if ( type == 1 ) {

			vec2 c = vec2( readF( off + 12 ), readF( off + 13 ) );
			float rLon = readF( off + 14 );
			float rLat = readF( off + 15 );
			vec2 delta = ( pos - c ) / vec2( rLon, rLat );
			float d = ( length( delta ) - 1.0 ) * min( rLon, rLat );
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		// ── type 2: polygon ──
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

		// ── type 3: polyline + arrows ──
		} else if ( type == 3 ) {

			int   vc  = int( readF( off + 12 ) );
			float hw  = readF( off + 13 );
			int   sa  = int( readF( off + 14 ) );
			int   ea  = int( readF( off + 15 ) );
			float asz = readF( off + 16 );
			int   vs  = off + 17;
			float d   = 1e10;

			vec2 v0 = vec2( readF( vs ), readF( vs + 1 ) );
			vec2 v1 = vec2( readF( vs + 2 ), readF( vs + 3 ) );
			vec2 vL = vec2( readF( vs + ( vc - 1 ) * 2 ), readF( vs + ( vc - 1 ) * 2 + 1 ) );
			vec2 vP = vec2( readF( vs + ( vc - 2 ) * 2 ), readF( vs + ( vc - 2 ) * 2 + 1 ) );

			for ( int i = 0; i < 63; i ++ ) {

				if ( i >= vc - 1 ) break;
				vec2 a = vec2( readF( vs + i * 2 ), readF( vs + i * 2 + 1 ) );
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

			if ( sa > 0 && asz > 0.0 ) {

				vec2 dr = normalize( v0 - v1 );
				vec2 lc = vec2( dot( pos - v0, dr ), dot( pos - v0, vec2( - dr.y, dr.x ) ) );
				arrowD = min( arrowD, arrowSdf( lc, sa, asz, hw ) );

			}

			if ( ea > 0 && asz > 0.0 ) {

				vec2 dr = normalize( vL - vP );
				vec2 lc = vec2( dot( pos - vL, dr ), dot( pos - vL, vec2( - dr.y, dr.x ) ) );
				arrowD = min( arrowD, arrowSdf( lc, ea, asz, hw ) );

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
					result = mix( result, vec4( lc.rgb, 1.0 ), max( lc.w, fc.w ) * op * m );

				}

			}

			if ( arrowD < aa && ! arrowFilled ) {

				vec4 lc = sc.w > 0.001 ? sc : fc;
				applyStroke( result, lc, arrowD, sw * 0.5, aa, op );

			}

		// ── type 4: text ──
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
					result = mix( result, vec4( lc.rgb, 1.0 ), lc.a * op );
				}
			}

		// ── type 5: sector（椭圆补偿） ──
		} else if ( type == 5 ) {

			vec2 c = vec2( readF( off + 12 ), readF( off + 13 ) );
			float rLon = readF( off + 14 );
			float rLat = readF( off + 15 );
			float sa = readF( off + 16 );
			float da = readF( off + 17 );

			vec2 d = pos - c;
			vec2 dn = d / vec2( rLon, rLat );
			float dist = length( dn );

			vec2 e1 = vec2( cos( sa ), sin( sa ) );
			vec2 e2 = vec2( cos( sa + da ), sin( sa + da ) );
			float cr1 = dn.x * e1.y - dn.y * e1.x;
			float cr2 = dn.x * e2.y - dn.y * e2.x;

			bool inAngle = da <= 3.14159 ? ( cr1 <= 0.0 && cr2 >= 0.0 ) : ( cr1 <= 0.0 || cr2 >= 0.0 );

			float fillSdf = ( dist - 1.0 ) * min( rLon, rLat );
			if ( ! inAngle ) fillSdf = abs( fillSdf ) + 0.01;
			applyFill( result, fc, fillSdf, aa, op );

			float arcSdf = inAngle ? fillSdf : 1e10;
			applyStroke( result, sc, arcSdf, sw, aa, op );

		// ── type 6: point ──
		} else if ( type == 6 ) {

			vec2 c = vec2( readF( off + 12 ), readF( off + 13 ) );
			float hsLon = readF( off + 14 );
			float hsLat = readF( off + 15 );
			int ps = int( readF( off + 16 ) );

			float sdf;
			if ( ps == 1 ) {
				sdf = sdBox( pos - c, vec2( hsLon, hsLat ) );
			} else {
				vec2 dn = ( pos - c ) / vec2( hsLon, hsLat );
				sdf = ( length( dn ) - 1.0 ) * min( hsLon, hsLat );
			}
			applyFill( result, fc, sdf, aa, op );
			applyStroke( result, sc, sdf, sw, aa, op );

		}

		off += total;

	}

	fragColor = result;
}
`;
