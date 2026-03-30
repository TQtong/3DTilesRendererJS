/**
 * GroundDecalManager — 地面贴花/标绘渲染管理器
 *
 * 核心原理：使用 shader-based SDF（Signed Distance Field）方式，
 * 将标绘图形直接在 fragment shader 中解析式计算，无需 Canvas 纹理图集。
 *
 * 渲染流程：
 * 1. 将场景渲染到深度纹理（depthRT）
 * 2. 在全屏后处理 pass 中，每个 fragment 从深度缓冲重建 ECEF 世界坐标
 * 3. 将 ECEF 投影到 ENU（East-North-Up）局部切面坐标 (e, n)（米制）
 * 4. 对每个图形，用 SDF 函数计算 fragment 到图形边界的距离
 * 5. 根据 SDF 值应用 fill/stroke 颜色与 smoothstep 抗锯齿
 *
 * 支持的图形类型（shader type ID）：
 *   0 = rect（矩形）       — sdBox SDF
 *   1 = circle（圆）       — 点到圆心距离 SDF
 *   2 = polygon（多边形）  — winding number 内外判定 + 边距离（箭头标绘也复用此类型）
 *   3 = polyline（折线）   — 到线段最小距离 - 半线宽 + 端点箭头 SDF（triangle/diamond/circle/bar）
 *   4 = label（文字标签）  — 采样 label atlas 纹理
 *   5 = sector（扇形）     — 角度+半径判定 + 弧线 SDF
 *   6 = point（点标记）    — 圆形/方形 SDF
 *
 * 箭头标绘（arrowPlot）：细箭头/曲线箭头/攻击箭头等，由 ArrowUtils.js 在 CPU 端
 * 根据控制点生成多边形顶点，打包为 type 2 (polygon) 渲染，无需额外 shader 类型。
 *
 * 图形数据通过 Float32 DataTexture 传入 shader，每个图形占若干 float：
 *   [type, totalFloats, fillRGBA(4), strokeRGBA(4), strokeWidth, opacity, ...typeSpecificData]
 */
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
// 顶点着色器：全屏四边形，传递 UV 坐标
// 片元着色器：从深度缓冲重建位置，逐 fragment 计算所有图形的 SDF

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

// ── Uniforms ──
uniform sampler2D tColor;       // 场景颜色纹理（深度 pass 的色彩输出）
uniform sampler2D tDepth;       // 场景深度纹理（用于重建世界坐标）
uniform sampler2D tShapeData;   // 图形数据纹理（Float32 DataTexture，存储所有图形参数）
uniform sampler2D tLabelAtlas;  // 文字标签 atlas 纹理
uniform mat4 uInvProjection;    // 相机投影矩阵的逆（clip → view 空间）
uniform mat4 uViewToECEF;       // view → ECEF 变换矩阵（tilesGroup.matrixWorldInverse * camera.matrixWorld）
uniform vec3 uOffsetHigh;       // 双精度偏移（高位）：相机在 ECEF 中相对于参考中心的位移
uniform vec3 uOffsetLow;        // 双精度偏移（低位）：补偿 float32 精度不足
uniform vec3 uEast;             // ENU 坐标系东向单位向量（ECEF 空间）
uniform vec3 uNorth;            // ENU 坐标系北向单位向量（ECEF 空间）
uniform float uGlobalOpacity;   // 全局不透明度（0~1）

// ── 数据读取 ──
// 从 Float32 DataTexture 中按索引读取一个 float 值。
// 数据以 RGBA 四通道存储，索引 i 对应第 i/4 个像素的第 i%4 个通道。
float readF( int i ) {
	int pi = i / 4;
	vec4 t = texelFetch( tShapeData, ivec2( pi, 0 ), 0 );
	int c = i - pi * 4;
	return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w;
}

// ── SDF 基础原语 ──

// 轴对齐矩形 SDF：负值在内部，正值在外部
float sdBox( vec2 p, vec2 b ) {
	vec2 d = abs( p ) - b;
	return length( max( d, 0.0 ) ) + min( max( d.x, d.y ), 0.0 );
}

// 线段距离：点 p 到线段 [a, b] 的最短距离（无符号）
float sdSeg( vec2 p, vec2 a, vec2 b ) {
	vec2 pa = p - a, ba = b - a;
	float h = clamp( dot( pa, ba ) / dot( ba, ba ), 0.0, 1.0 );
	return length( pa - ba * h );
}

// 三角形 SDF（Inigo Quilez 经典实现）：负值在内部，正值在外部
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
// 在局部旋转坐标系中计算箭头形状。local.x = 沿线方向，local.y = 垂直方向。
// style: 1=filled三角, 2=open三角, 3=filled菱形, 4=open菱形,
//        5=filled圆, 6=open圆, 7=bar横杠
// sz: 箭头大小（mPerPx 缩放后的米制值）
// hw: 折线半线宽（米），用于计算重叠量 ov 以消除线段与箭头的接缝
float arrowSdf( vec2 local, int style, float sz, float hw ) {
	float w = sz * 0.45;       // 翼宽 = 箭头大小的 45%
	float ov = hw * 2.0;       // 重叠量：向线段内延伸 2 倍半线宽，消除接缝
	if ( style == 1 || style == 2 ) {
		// 三角形：尖端在 (sz,0)，底边在 x=-ov 处展开 ±w
		return sdTri( local, vec2( sz, 0.0 ), vec2( - ov, w ), vec2( - ov, - w ) );
	} else if ( style == 3 || style == 4 ) {
		// 菱形：L1 范数（曼哈顿距离）构成的菱形 SDF
		vec2 shifted = vec2( local.x + ov * 0.5, local.y );
		vec2 al = abs( shifted );
		float hs = ( sz + ov ) * 0.5;
		return ( al.x / hs + al.y / w ) - 1.0;
	} else if ( style == 5 || style == 6 ) {
		// 圆点：点到中心距离 - 半径
		return length( local ) - sz * 0.4;
	} else if ( style == 7 ) {
		// 横杠：沿线方向窄（8%），垂直方向宽（w）
		return sdBox( local, vec2( sz * 0.08, w ) );
	}
	return 1e10;
}

// ── Fill / Stroke 渲染 ──

// 应用填充色。sdf < 0 表示在图形内部。
// smoothstep(-aa, 0, sdf) 在边界处产生平滑过渡（抗锯齿），宽度 = aa 米。
void applyFill( inout vec4 result, vec4 fc, float sdf, float aa, float op ) {
	if ( fc.w > 0.001 && sdf < aa ) {
		float m = 1.0 - smoothstep( - aa, 0.0, sdf );
		result = mix( result, vec4( fc.rgb, 1.0 ), fc.w * op * m * uGlobalOpacity );
	}
}

// 应用描边色。stroke 仅在 fill 边界外侧绘制，宽度 = sw 米。
// inner: 从 sdf=0（边界）向外过渡到 1，确保不侵入 fill 内部。
// outer: 从 sdf=sw（描边外缘）向外过渡到 0。
// m = inner * outer: 仅在 sdf ∈ [0, sw] 区间为正值。
void applyStroke( inout vec4 result, vec4 sc, float sdf, float sw, float aa, float op ) {
	if ( sc.w > 0.001 && sw > 0.0 ) {
		float inner = smoothstep( - aa, 0.0, sdf );
		float outer = 1.0 - smoothstep( sw, sw + aa, sdf );
		float m = inner * outer;
		result = mix( result, vec4( sc.rgb, 1.0 ), sc.w * op * m * uGlobalOpacity );
	}
}

void main() {
	// 读取当前像素的场景颜色和深度
	vec4 scene = texture( tColor, vUv );
	float depth = texture( tDepth, vUv ).r;

	fragColor = scene;
	// 天空像素（深度≈1）不需要贴花
	if ( depth >= 0.9999 ) return;
	// 深度梯度过大说明处于地形 LOD 瓦片边界，位置重建不可靠
	if ( fwidth( depth ) > 0.0005 ) return;

	// ── 从深度重建 ECEF 世界坐标 ──
	// 1. 屏幕 UV + 深度 → NDC clip 坐标
	vec4 cp = vec4( vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
	// 2. clip → view 空间（相机坐标系）
	vec4 vp = uInvProjection * cp;
	vec3 view = vp.xyz / vp.w;
	// 3. view → ECEF（通过旋转部分 + 双精度平移偏移）
	vec3 rot = mat3( uViewToECEF ) * view;
	// 双精度技巧：分 high + low 两步相加，避免大坐标 + 小偏移的精度丢失
	vec3 delta = ( rot + uOffsetHigh ) + uOffsetLow;

	// ── 投影到 ENU 局部切面坐标（米制） ──
	// delta 是 fragment 在 ECEF 中相对于参考中心的偏移向量
	// dot 到 East/North 轴得到局部米制坐标 (e, n)
	float e = dot( delta, uEast );
	float n = dot( delta, uNorth );
	vec2 pos = vec2( e, n );

	// 抗锯齿宽度：基于相邻像素的位置差异，限制上限防止 LOD 边界渗透
	float aa = max( fwidth( e ), fwidth( n ) ) * 1.5;

	// ── 遍历所有图形 ──
	// 数据格式：arr[0] = 图形总数，之后每个图形：[type, total, fill4, stroke4, sw, op, ...params]
	int count = int( readF( 0 ) );
	int off = 1;
	vec4 result = scene;

	for ( int s = 0; s < 64; s ++ ) {    // 最多处理 64 个图形

		if ( s >= count ) break;

		// 读取图形公共头部（12 floats）
		int type  = int( readF( off ) );       // 图形类型 ID
		int total = int( readF( off + 1 ) );   // 该图形占用的总 float 数（用于跳到下一个图形）

		vec4  fc = vec4( readF( off + 2 ), readF( off + 3 ), readF( off + 4 ), readF( off + 5 ) );  // fill RGBA（alpha 已含 fillOpacity）
		vec4  sc = vec4( readF( off + 6 ), readF( off + 7 ), readF( off + 8 ), readF( off + 9 ) );  // stroke RGBA（alpha 已含 strokeOpacity）
		float sw = readF( off + 10 );          // 描边宽度（米）
		float op = readF( off + 11 );          // 可见性标记（1.0 可见，0.0 隐藏）

		// ── type 0: 矩形 ──
		// 数据：[12] centerE, [13] centerN, [14] halfW, [15] halfH
		if ( type == 0 ) {

			vec2 c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			vec2 hs = vec2( readF( off + 14 ), readF( off + 15 ) );
			float d = sdBox( pos - c, hs );
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		// ── type 1: 圆 ──
		// 数据：[12] centerE, [13] centerN, [14] radius
		} else if ( type == 1 ) {

			vec2  c = vec2( readF( off + 12 ), readF( off + 13 ) );
			float r = readF( off + 14 );
			float d = length( pos - c ) - r;
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		// ── type 2: 多边形（也用于箭头标绘图形） ──
		// 数据：[12] vertexCount, [13..] v0_e, v0_n, v1_e, v1_n, ...
		// 内外判定使用 Winding Number 算法，描边使用到最近边的距离
		} else if ( type == 2 ) {

			int vc = int( readF( off + 12 ) );   // 顶点数
			int vs = off + 13;                    // 顶点数据起始偏移
			int wn = 0;                           // winding number（非零 = 内部）
			float ed = 1e10;                      // 到最近边的距离

			for ( int i = 0; i < 64; i ++ ) {    // 最多 64 个顶点

				if ( i >= vc ) break;
				int j = i + 1 < vc ? i + 1 : 0;  // 下一个顶点（闭合回到第一个）
				vec2 a = vec2( readF( vs + i * 2 ), readF( vs + i * 2 + 1 ) );
				vec2 b = vec2( readF( vs + j * 2 ), readF( vs + j * 2 + 1 ) );

				ed = min( ed, sdSeg( pos, a, b ) );

				// Winding Number 算法：统计多边形边界绕测试点的圈数
				// 向上穿越且在左侧 → wn++，向下穿越且在右侧 → wn--
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

			bool inside = wn != 0;               // wn ≠ 0 → 点在多边形内部
			float d = inside ? - ed : ed;         // 有符号距离：内部为负
			applyFill( result, fc, d, aa, op );
			applyStroke( result, sc, d, sw, aa, op );

		// ── type 3: 折线 + 端点箭头 ──
		// 数据：[12] vc, [13] hw, [14] startArrowStyle, [15] endArrowStyle,
		//       [16] arrowSize, [17..] v0_e, v0_n, v1_e, v1_n, ...
		} else if ( type == 3 ) {

			int   vc = int( readF( off + 12 ) );   // 顶点数
			float hw = readF( off + 13 );           // 半线宽（米）
			int   sa = int( readF( off + 14 ) );    // 起点箭头样式（0=无）
			int   ea = int( readF( off + 15 ) );    // 终点箭头样式（0=无）
			float asz = readF( off + 16 );           // 箭头大小（米）
			int   vs = off + 17;                     // 顶点数据起始偏移
			float d  = 1e10;

			// 预读首段和末段端点（用于箭头方向计算）
			vec2 v0 = vec2( readF( vs ), readF( vs + 1 ) );                                      // 第一个顶点
			vec2 v1 = vec2( readF( vs + 2 ), readF( vs + 3 ) );                                  // 第二个顶点
			vec2 vL = vec2( readF( vs + ( vc - 1 ) * 2 ), readF( vs + ( vc - 1 ) * 2 + 1 ) );   // 最后一个顶点
			vec2 vP = vec2( readF( vs + ( vc - 2 ) * 2 ), readF( vs + ( vc - 2 ) * 2 + 1 ) );   // 倒数第二个顶点

			// 计算到所有线段的最小距离（capsule 形状）
			for ( int i = 0; i < 63; i ++ ) {

				if ( i >= vc - 1 ) break;
				vec2 a = vec2( readF( vs + i * 2 ),       readF( vs + i * 2 + 1 ) );
				vec2 b = vec2( readF( vs + ( i + 1 ) * 2 ), readF( vs + ( i + 1 ) * 2 + 1 ) );
				d = min( d, sdSeg( pos, a, b ) );

			}

			d -= hw; // 减去半线宽：capsule → 折线 SDF

			// 裁剪端点圆弧：有箭头的端点用半平面裁剪，移除 capsule 的圆形端帽
			// beyond > 0 表示 fragment 在端点之外（圆弧区域），强制 d 为正值
			if ( sa > 0 ) {

				float beyond = - dot( pos - v0, normalize( v1 - v0 ) );
				if ( beyond > 0.0 ) d = max( d, beyond );

			}

			if ( ea > 0 ) {

				float beyond = - dot( pos - vL, normalize( vP - vL ) );
				if ( beyond > 0.0 ) d = max( d, beyond );

			}

			// 计算端点箭头 SDF
			float arrowD = 1e10;

			if ( sa > 0 && asz > 0.0 ) {

				// 起点箭头：建立局部坐标系（x=从线内指向线外，y=垂直）
				vec2 dr = normalize( v0 - v1 );
				vec2 lc = vec2( dot( pos - v0, dr ), dot( pos - v0, vec2( - dr.y, dr.x ) ) );
				float ad = arrowSdf( lc, sa, asz, hw );
				arrowD = min( arrowD, ad );

			}

			if ( ea > 0 && asz > 0.0 ) {

				// 终点箭头：同理，方向为最后一段的延伸方向
				vec2 dr = normalize( vL - vP );
				vec2 lc = vec2( dot( pos - vL, dr ), dot( pos - vL, vec2( - dr.y, dr.x ) ) );
				float ad = arrowSdf( lc, ea, asz, hw );
				arrowD = min( arrowD, ad );

			}

			// 合并折线 SDF 和箭头 SDF（取并集）
			bool arrowFilled = ( sa == 1 || sa == 3 || sa == 5 || ea == 1 || ea == 3 || ea == 5 );
			float combined = min( d, arrowD );

			if ( combined < aa ) {

				vec4 lc = sc.w > 0.001 ? sc : fc;

				if ( arrowFilled && arrowD < d && arrowD < aa ) {

					// 实心箭头区域：用箭头 SDF 独立渲染 fill + stroke
					applyFill( result, lc, arrowD, aa, op );
					applyStroke( result, lc, arrowD, sw, aa, op );

				} else {

					// 折线体部或非实心箭头区域
					float m = 1.0 - smoothstep( - aa, 0.0, combined );
					result = mix( result, vec4( lc.rgb, 1.0 ), max( lc.w, fc.w ) * op * m * uGlobalOpacity );

				}

			}

			// 空心箭头（open）：仅描边，不填充
			if ( arrowD < aa && ! arrowFilled ) {

				vec4 lc = sc.w > 0.001 ? sc : fc;
				applyStroke( result, lc, arrowD, sw * 0.5, aa, op );

			}

		// ── type 4: 文字标签 ──
		// 数据：[12] centerE, [13] centerN, [14] halfW, [15] halfH,
		//       [16] u0, [17] v0, [18] u1, [19] v1（atlas UV 边界）
		// 文字预渲染到 label atlas canvas，shader 中采样纹理。
		// 每个标签在 atlas 中有独立的均匀缩放 tile，不受全局 extent 影响。
		} else if ( type == 4 ) {

			vec2 c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			vec2 hs = vec2( readF( off + 14 ), readF( off + 15 ) );
			vec4 ub = vec4( readF( off + 16 ), readF( off + 17 ), readF( off + 18 ), readF( off + 19 ) );

			// 将 ENU 位置映射到标签 tile 的局部 UV [0,1]
			vec2 local = vec2(
				( pos.x - c.x + hs.x ) / ( 2.0 * hs.x ),
				1.0 - ( pos.y - c.y + hs.y ) / ( 2.0 * hs.y )  // y 翻转：北→上 对应 UV v=0
			);

			if ( local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0 ) {
				// 将局部 UV 映射到 atlas 中的 tile UV 范围
				vec2 auv = mix( ub.xy, ub.zw, local );
				vec4 lc = texture( tLabelAtlas, auv );
				if ( lc.a > 0.01 ) {
					result = mix( result, vec4( lc.rgb, 1.0 ), lc.a * op * uGlobalOpacity );
				}
			}

		// ── type 5: 扇形 ──
		// 数据：[12] centerE, [13] centerN, [14] radius, [15] startAngle(rad), [16] sectorAngle(rad)
		// 内外判定：dist <= radius AND 角度在 [startAngle, startAngle+sectorAngle] 内
		// 角度测试使用叉积（cross product），比 atan2 更稳定且无跨 π 问题
		} else if ( type == 5 ) {

			vec2  c  = vec2( readF( off + 12 ), readF( off + 13 ) );
			float r  = readF( off + 14 );
			float sa = readF( off + 15 );   // 起始角（弧度）
			float da = readF( off + 16 );   // 扇形角（弧度）

			vec2 d = pos - c;               // 到扇形中心的向量
			float dist = length( d );

			// 扇形两条半径的方向向量
			vec2 e1 = vec2( cos( sa ), sin( sa ) );
			vec2 e2 = vec2( cos( sa + da ), sin( sa + da ) );
			// 叉积判断点在边向量的哪一侧
			float cr1 = d.x * e1.y - d.y * e1.x;
			float cr2 = d.x * e2.y - d.y * e2.x;

			// 角度判定：扇形角 ≤ π 时用 AND，> π 时用 OR
			bool inAngle = da <= 3.14159 ? ( cr1 >= 0.0 && cr2 <= 0.0 ) : ( cr1 >= 0.0 || cr2 <= 0.0 );
			bool inside = inAngle && dist <= r;

			// 边缘距离（用于 fill AA）
			float ed = min( sdSeg( d, vec2( 0.0 ), r * e1 ), sdSeg( d, vec2( 0.0 ), r * e2 ) );
			if ( inAngle ) ed = min( ed, abs( dist - r ) );

			// Fill 只用弧线距离（直线边保持硬边界，避免渗透线条）
			float fillSdf = inAngle ? ( dist - r ) : ed;
			applyFill( result, fc, fillSdf, aa, op );
			// Stroke 仅沿弧线绘制（不在两条半径上描边）
			float arcSdf = inAngle ? ( dist - r ) : 1e10;
			applyStroke( result, sc, arcSdf, sw, aa, op );

		// ── type 6: 点标记 ──
		// 数据：[12] centerE, [13] centerN, [14] halfSize, [15] pointStyle (0=圆, 1=方)
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

// 自增图形 ID
let _nextId = 1;
const DEG2RAD = MathUtils.DEG2RAD;
// 参考密度，用于将像素单位的 strokeWidth 换算到米制
const REF_DENSITY = 4096;
// 标签 atlas 画布尺寸
const LABEL_ATLAS = 2048;
// 复用的临时 Vector3（避免每次 lonLatToMeters 创建新对象）
const _pos = new Vector3();

/**
 * 将经纬度坐标转换为 ENU 局部切面坐标（米制）
 * 算法：lon/lat → ECEF（通过椭球体）→ 减去参考中心 → 投影到 East/North 轴
 */
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

	// 支持格式：'#hex', 'rgb(r,g,b)', 'rgba(r,g,b,a)', 'transparent', null
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

/**
 * 解析不透明度参数，向后兼容两种格式：
 * - store 格式：fillOpacity/strokeOpacity（0-100 整数百分比）
 * - 旧格式：opacity（0-1 浮点数，同时应用于 fill 和 stroke）
 * 结果写入 base[0]=fillOpacity(0-1), base[1]=strokeOpacity(0-1)
 */
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

	/**
	 * @param {WebGLRenderer} renderer - three.js WebGL 渲染器
	 * @param {object} [options] - 初始化选项
	 * @param {number} [options.opacity=1.0] - 全局不透明度
	 */
	constructor( renderer, options = {} ) {

		this._renderer = renderer;
		// 所有图形存储在 Map<id, itemData> 中，key 是自增 ID
		this._items = new Map();
		// 脏标记：任何图形的增删改都会设为 true，下次 render() 时触发 _rebuildShapeData()
		this._dataDirty = true;
		this._globalOpacity = options.opacity ?? 1.0;

		// ENU（East-North-Up）参考坐标系，以所有图形的地理中心为原点
		this._centerECEF = new Vector3();
		this._east = new Vector3();
		this._north = new Vector3();
		this._up = new Vector3();
		this._centerLatRad = 0;
		this._centerLonRad = 0;
		this._ellipsoid = null;
		this._tilesGroup = null;

		// 所有图形的最大范围（米），用于 strokeWidth 像素→米换算
		this._maxExtent = 1;

		// view → ECEF 变换矩阵（每帧更新）
		this._viewToECEF = new Matrix4();

		// 图形数据纹理（Float32 RGBA DataTexture，存储所有图形的 SDF 参数）
		this._shapeDataTex = null;
		this._shapeDataTexWidth = 1;
		// 标签 atlas：每个文字标签预渲染到此 canvas，shader 中采样
		this._labelCanvas = document.createElement( 'canvas' );
		this._labelCanvas.width = LABEL_ATLAS;
		this._labelCanvas.height = LABEL_ATLAS;
		this._labelAtlasTex = new CanvasTexture( this._labelCanvas );
		// 不翻转 Y，使 canvas y=0 对应纹理 v=0
		this._labelAtlasTex.flipY = false;
		this._labelAtlasTex.minFilter = LinearFilter;
		this._labelAtlasTex.magFilter = LinearFilter;

		// GPU 资源
		// GPU 资源（在 _initGPU 中创建）
		this._depthRT = null;
		this._compositeScene = null;
		this._compositeCamera = null;
		this._compositeMaterial = null;

		this._initGPU();

	}

	// ── Public: 图形创建 ──
	// 每个 add* 方法创建一个图形项，存入 _items，返回唯一 ID。
	// 设置 _dataDirty = true，下次 render() 时自动重建数据纹理。

	/**
	 * 添加矩形
	 * @param {{lon: number, lat: number}} center - 中心经纬度
	 * @param {{w: number, h: number} | number} size - 宽高（米），或单一数值表示正方形
	 * @param {object} [style] - 样式参数
	 * @returns {number} 图形 ID
	 */
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

	/**
	 * 添加圆
	 * @param {{lon, lat}} center - 中心经纬度
	 * @param {number} radius - 半径（米）
	 */
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

	/**
	 * 添加多边形
	 * @param {Array<[lon, lat]>} coords - 顶点数组，至少 3 个（shader 最多支持 64 个）
	 */
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

	/**
	 * 添加折线
	 * @param {Array<[lon, lat]>} coords - 顶点数组，至少 2 个
	 * @param {object} [style] - 可含 startArrowStyle, endArrowStyle, arrowSize
	 */
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

	/**
	 * 添加文字标签（预渲染到 label atlas canvas，shader 中纹理采样）
	 * @param {{lon, lat}} center - 中心经纬度
	 * @param {string} text - 文字内容
	 * @param {object} [style] - 可含 font, fill, stroke, strokeWidth, textAlign, fontColor
	 */
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

	/**
	 * 添加扇形
	 * @param {{lon, lat}} center - 中心经纬度
	 * @param {number} radius - 半径（米）
	 * @param {number} startAngle - 起始角度（度，从东向逆时针）
	 * @param {number} sectorAngle - 扇形角度（度）
	 */
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

	/**
	 * 添加点标记
	 * @param {{lon, lat}} center - 中心经纬度
	 * @param {number} size - 直径（米）
	 * @param {object} [style] - 可含 pointStyle: 'circle' | 'square'
	 */
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

	/**
	 * 添加箭头标绘图形（CPU 端由 ArrowUtils 生成多边形顶点，复用 type 2 渲染）
	 * @param {Array<[lon, lat]>} controlPoints - 控制点数组
	 * @param {object} [style] - 可含 arrowType: 'fine'|'curved'|'attack'|'straight', headSize
	 */
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

	// ── Public: 查询与修改 ──
	// 所有修改方法都设置 _dataDirty = true，下次 render() 时自动重建。

	/** 获取图形的数据快照（深拷贝），返回 null 表示不存在 */
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

	/** 合并更新图形的样式属性（Object.assign 方式，只覆盖传入的字段） */
	setStyle( id, style ) {

		const item = this._items.get( id );
		if ( ! item ) return;

		Object.assign( item.style, style );
		this._dataDirty = true;

	}

	/** 修改图形中心坐标，支持只传 lon 或 lat */
	setCenter( id, center ) {

		const item = this._items.get( id );
		if ( ! item || ! item.center ) return;

		if ( center.lon !== undefined ) item.center.lon = center.lon;
		if ( center.lat !== undefined ) item.center.lat = center.lat;
		this._dataDirty = true;

	}

	/** 修改图形大小。rect: {w,h}或数字; circle/sector: 数字或{radius,startAngle,sectorAngle}; point: 数字 */
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

	/** 替换多边形/折线的全部顶点坐标 */
	setCoords( id, coords ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;

		item.coords = coords.map( c => [ ...c ] );
		this._dataDirty = true;

	}

	/** 修改单个顶点坐标（用于拖拽编辑） */
	setCoord( id, index, coord ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;
		if ( index < 0 || index >= item.coords.length ) return;

		if ( coord[ 0 ] !== undefined ) item.coords[ index ][ 0 ] = coord[ 0 ];
		if ( coord[ 1 ] !== undefined ) item.coords[ index ][ 1 ] = coord[ 1 ];
		this._dataDirty = true;

	}

	/** 在指定索引处插入新顶点 */
	insertCoord( id, index, coord ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;

		const idx = Math.max( 0, Math.min( index, item.coords.length ) );
		item.coords.splice( idx, 0, [ ...coord ] );
		this._dataDirty = true;

	}

	/** 删除指定索引的顶点（保证不低于最小顶点数：多边形 3，折线 2） */
	removeCoord( id, index ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;
		if ( index < 0 || index >= item.coords.length ) return;

		const minVerts = item.type === 'polygon' ? 3 : 2;
		if ( item.coords.length <= minVerts ) return;

		item.coords.splice( index, 1 );
		this._dataDirty = true;

	}

	/** 平移所有顶点（用于整体拖拽） */
	translateCoords( id, dLon, dLat ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return;

		for ( const c of item.coords ) {

			c[ 0 ] += dLon;
			c[ 1 ] += dLat;

		}

		this._dataDirty = true;

	}

	/** 修改标签文字内容 */
	setText( id, text ) {

		const item = this._items.get( id );
		if ( ! item || item.type !== 'label' ) return;

		item.text = text;
		this._dataDirty = true;

	}

	/** 设置全局不透明度（不触发数据重建，直接修改 uniform） */
	setGlobalOpacity( opacity ) {

		this._globalOpacity = opacity;

	}

	/** 获取顶点数量 */
	getCoordCount( id ) {

		const item = this._items.get( id );
		if ( ! item || ! item.coords ) return 0;
		return item.coords.length;

	}

	/** 查找距给定经纬度最近的顶点索引（用于鼠标命中检测） */
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

	// ── Public: 生命周期 ──

	/** 设置椭球体和瓦片组引用（必须在 render 前调用） */
	setEllipsoid( ellipsoid, tilesGroup ) {

		this._ellipsoid = ellipsoid;
		this._tilesGroup = tilesGroup;
		this._dataDirty = true;

	}

	/** 窗口大小变化时更新深度渲染目标尺寸 */
	resize( w, h ) {

		if ( ! this._depthRT ) return;
		const pw = w * window.devicePixelRatio;
		const ph = h * window.devicePixelRatio;
		this._depthRT.setSize( pw, ph );

	}

	/**
	 * 每帧渲染入口。执行两个 pass：
	 * 1. 深度 pass：将场景渲染到 depthRT（获取颜色+深度纹理）
	 * 2. 合成 pass：全屏四边形 + SDF shader，从深度重建位置并绘制所有标绘图形
	 */
	render( scene, camera, tilesGroup ) {

		if ( this._items.size === 0 || ! this._ellipsoid ) return;

		// 脏数据时重建 DataTexture（惰性更新，避免每帧重建）
		if ( this._dataDirty ) {

			this._rebuildShapeData();

		}

		const renderer = this._renderer;

		// Pass 1: 渲染场景到深度目标
		renderer.setRenderTarget( this._depthRT );
		renderer.render( scene, camera );
		renderer.setRenderTarget( null );

		// 计算 view → ECEF 变换矩阵和双精度偏移
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

	/** 释放所有 GPU 资源 */
	dispose() {

		if ( this._depthRT ) this._depthRT.dispose();
		if ( this._shapeDataTex ) this._shapeDataTex.dispose();
		if ( this._labelAtlasTex ) this._labelAtlasTex.dispose();
		if ( this._compositeMaterial ) this._compositeMaterial.dispose();

	}

	// ── Private: GPU 资源初始化 ──

	/** 创建深度渲染目标、图形数据纹理、合成 ShaderMaterial、全屏四边形 */
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

	// ── Private: 数据重建 ──

	/**
	 * 将所有图形数据打包到 Float32 DataTexture 中。
	 * 格式：arr[0] = 图形总数，之后每个图形按类型打包：
	 *   [type, totalFloats, fillRGBA(4), strokeRGBA(4), strokeWidth, opacity, ...typeData]
	 *
	 * 此方法在每次 render() 发现 _dataDirty 时被调用，触发场景包括：
	 * - 添加/删除/修改图形
	 * - 修改样式
	 * - 修改顶点坐标
	 */
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

	/**
	 * 计算所有图形的地理中心（经纬度平均值），
	 * 然后在该中心点建立 ENU 局部坐标系（East/North/Up 轴向量）
	 */
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

	/**
	 * 计算所有图形的最大空间范围（米），用于：
	 * 1. strokeWidth 像素到米的换算：mPerPx = maxExtent / REF_DENSITY
	 * 2. 标签 atlas 的 metersPerPixel 计算
	 */
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

	/** 将箭头样式字符串映射为 shader 中的整数 ID（0=无，1-7 对应 arrowSdf 的 style 参数） */
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

	/** 经纬度 → ENU 米制坐标的便捷封装 */
	_toMeters( lonDeg, latDeg ) {

		return lonLatToMeters(
			lonDeg, latDeg,
			this._centerLonRad, this._centerLatRad,
			this._ellipsoid, this._east, this._north, this._centerECEF
		);

	}

	// ── Private: 标签 atlas 构建 ──

	/**
	 * 将所有标签文字渲染到 label atlas canvas 中。
	 * 每个标签获得一个独立的矩形 tile，行打包布局。
	 * 返回 Map<id, {halfW, halfH, u0, v0, u1, v1}>，
	 * 其中 halfW/halfH 是地理半尺寸（米），u0~v1 是 atlas 中的 UV 边界。
	 *
	 * @param {number} mPerPx - 每 canvas 像素对应的米数（= maxExtent / REF_DENSITY）
	 */
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
