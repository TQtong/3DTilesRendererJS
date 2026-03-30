/**
 * shaders.js — GroundDecalManager 使用的 GLSL 着色器
 *
 * 渲染管线：
 *   1. 顶点着色器（DECAL_VERTEX）：全屏四边形，传递 UV
 *   2. 片元着色器（DECAL_FRAGMENT）：
 *      a) 从深度缓冲重建 fragment 的 ECEF 世界坐标
 *      b) 对每个图形，用该图形自己的 ENU 轴将 ECEF 投影到局部坐标
 *      c) 在局部坐标中计算 SDF，应用 fill/stroke + smoothstep 抗锯齿
 *
 * 每个图形独立 ENU 坐标系，互不耦合。
 * strokeWidth / arrowSize 以屏幕像素传入，在 shader 中用 fwidth 逐像素转换为米。
 *
 * 数据纹理打包格式（21-float 公共头部 + 图形特有数据）：
 *   arr[0] = 图形总数
 *   每个图形：
 *     [0]  type
 *     [1]  totalFloats
 *     [2-5]   fillRGBA
 *     [6-9]   strokeRGBA
 *     [10] strokeWidth（像素）
 *     [11] opacity
 *     [12-14] centerOffset（图形 ENU 中心的 ECEF 偏移，相对全局参考点）
 *     [15-17] East（图形 ENU 东向单位向量）
 *     [18-20] North（图形 ENU 北向单位向量）
 *     [21+]   图形特有数据
 */

export const DECAL_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

export const DECAL_FRAGMENT = /* glsl */ `
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

// ── 数据读取 ──
float readF( int i ) {
	int pi = i / 4;
	vec4 t = texelFetch( tShapeData, ivec2( pi, 0 ), 0 );
	int c = i - pi * 4;
	return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w;
}

// ── SDF 原语 ──

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

// ── 折线端点箭头 SDF ──
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

// ── 主函数 ──
void main() {
	vec4 scene = texture( tColor, vUv );
	float depth = texture( tDepth, vUv ).r;

	fragColor = scene;

	// 模板测试已保证此像素在地形表面的有效区域内
	// 不需要任何深度过滤条件（depth >= 0.9999 / fwidth(depth) 等）
	if ( depth >= 1.0 ) return;

	// ── 从深度重建 ECEF 坐标（相对全局参考中心） ──
	vec4 cp = vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
	vec4 vp = uInvProjection * cp;
	vec3 view = vp.xyz / vp.w;
	vec3 rot = mat3( uViewToECEF ) * view;
	vec3 delta = ( rot + uOffsetHigh ) + uOffsetLow;

	// ── 全局 ENU 投影（仅用于 aa 和 mPerPx 计算） ──
	float e0 = dot( delta, uEast );
	float n0 = dot( delta, uNorth );
	float rawAA = max( fwidth( e0 ), fwidth( n0 ) );

	// 远距离渐隐：rawAA 越大 → 位置重建精度越低 → 图形越淡
	// rawAA < 100 m/px: 全不透明 | 100~500: 渐隐 | > 500: 完全透明
	float distFade = 1.0 - smoothstep( 100.0, 500.0, rawAA );
	if ( distFade < 0.01 ) return;

	float aa = rawAA * 1.5;
	float mPerPx = max( rawAA, 0.001 );

	// ── 遍历所有图形 ──
	int count = int( readF( 0 ) );
	int off = 1;
	vec4 result = scene;

	for ( int s = 0; s < 64; s ++ ) {

		if ( s >= count ) break;

		// ── 公共头部（21 floats） ──
		int type  = int( readF( off ) );
		int total = int( readF( off + 1 ) );

		vec4 fc = vec4( readF( off + 2 ), readF( off + 3 ), readF( off + 4 ), readF( off + 5 ) );
		vec4 sc = vec4( readF( off + 6 ), readF( off + 7 ), readF( off + 8 ), readF( off + 9 ) );
		float swPx = readF( off + 10 );
		float op   = readF( off + 11 );

		// per-shape ENU：中心偏移 + 东向/北向轴
		vec3 coff = vec3( readF( off + 12 ), readF( off + 13 ), readF( off + 14 ) );
		vec3 sE   = vec3( readF( off + 15 ), readF( off + 16 ), readF( off + 17 ) );
		vec3 sN   = vec3( readF( off + 18 ), readF( off + 19 ), readF( off + 20 ) );

		// fragment 在该图形局部 ENU 中的坐标
		vec3 sd = delta - coff;
		vec2 pos = vec2( dot( sd, sE ), dot( sd, sN ) );

		// strokeWidth 像素 → 米
		float sw = swPx * mPerPx;

		// 图形特有数据从 off+21 开始

		// ── type 0: 矩形 ──
		// [21] halfW  [22] halfH
		if ( type == 0 ) {

			vec2 hs = vec2( readF( off + 21 ), readF( off + 22 ) );
			float d = sdBox( pos, hs );
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		// ── type 1: 圆 ──
		// [21] radius
		} else if ( type == 1 ) {

			float r = readF( off + 21 );
			float d = length( pos ) - r;
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		// ── type 2: 多边形 ──
		// [21] vc  [22..] vertices
		} else if ( type == 2 ) {

			int vc = int( readF( off + 21 ) );
			int vs = off + 22;
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

		// ── type 3: 折线 + 端点箭头 ──
		// [21] vc  [22] hw_px  [23] startArrow  [24] endArrow  [25] asz_px  [26..] vertices
		} else if ( type == 3 ) {

			int   vc  = int( readF( off + 21 ) );
			float hw  = readF( off + 22 ) * mPerPx;
			int   sa  = int( readF( off + 23 ) );
			int   ea  = int( readF( off + 24 ) );
			float asz = readF( off + 25 ) * mPerPx;
			int   vs  = off + 26;
			float d   = 1e10;

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

			if ( sa > 0 && asz > 0.0 ) {

				vec2 dr = normalize( v0 - v1 );
				vec2 lc = vec2( dot( pos - v0, dr ), dot( pos - v0, vec2( - dr.y, dr.x ) ) );
				float ad = arrowSdf( lc, sa, asz, hw );
				arrowD = min( arrowD, ad );

			}

			if ( ea > 0 && asz > 0.0 ) {

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

		// ── type 4: 文字标签 ──
		// [21] halfW  [22] halfH  [23] u0  [24] v0  [25] u1  [26] v1
		} else if ( type == 4 ) {

			vec2 hs = vec2( readF( off + 21 ), readF( off + 22 ) );
			vec4 ub = vec4( readF( off + 23 ), readF( off + 24 ), readF( off + 25 ), readF( off + 26 ) );

			vec2 local = vec2(
				( pos.x + hs.x ) / ( 2.0 * hs.x ),
				1.0 - ( pos.y + hs.y ) / ( 2.0 * hs.y )
			);

			if ( local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0 ) {
				vec2 auv = mix( ub.xy, ub.zw, local );
				vec4 lc = texture( tLabelAtlas, auv );
				if ( lc.a > 0.01 ) {
					result = mix( result, vec4( lc.rgb, 1.0 ), lc.a * op * uGlobalOpacity );
				}
			}

		// ── type 5: 扇形 ──
		// [21] radius  [22] startAngle  [23] sectorAngle
		} else if ( type == 5 ) {

			float r  = readF( off + 21 );
			float sa = readF( off + 22 );
			float da = readF( off + 23 );

			float dist = length( pos );

			vec2 e1 = vec2( cos( sa ), sin( sa ) );
			vec2 e2 = vec2( cos( sa + da ), sin( sa + da ) );
			float cr1 = pos.x * e1.y - pos.y * e1.x;
			float cr2 = pos.x * e2.y - pos.y * e2.x;

			bool inAngle = da <= 3.14159 ? ( cr1 >= 0.0 && cr2 <= 0.0 ) : ( cr1 >= 0.0 || cr2 <= 0.0 );

			float ed = min( sdSeg( pos, vec2( 0.0 ), r * e1 ), sdSeg( pos, vec2( 0.0 ), r * e2 ) );
			if ( inAngle ) ed = min( ed, abs( dist - r ) );

			float fillSdf = inAngle ? ( dist - r ) : ed;
			applyFill( result, fc, fillSdf, aa, op );
			float arcSdf = inAngle ? ( dist - r ) : 1e10;
			applyStroke( result, sc, arcSdf, sw, aa, op );

		// ── type 6: 点标记 ──
		// [21] halfSize  [22] pointStyle
		} else if ( type == 6 ) {

			float hs = readF( off + 21 );
			int   ps = int( readF( off + 22 ) );

			float sdf = ps == 1 ? sdBox( pos, vec2( hs ) ) : length( pos ) - hs;
			applyFill( result, fc, sdf, aa, op );
			applyStroke( result, sc, sdf, sw, aa, op );

		}

		off += total;

	}

	// 远距离渐隐混合：在精度不足区域平滑过渡到原始场景
	fragColor = mix( scene, result, distFade );
}
`;
