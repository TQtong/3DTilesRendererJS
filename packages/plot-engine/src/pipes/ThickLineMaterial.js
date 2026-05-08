// ============================================================
// pipes/ThickLineMaterial.js — 粗线 / 虚线 / 流光线
// ============================================================
//
// 实现策略：把折线在 XZ 平面上"挤出"为 ribbon 三角形条带，宽度由 style.strokeWidth
// 控制，单位与世界坐标一致（不同于 Three 的 Line2，那是屏幕空间像素宽度）。
//
//   优点：没有 examples/jsm 依赖；与既有 polygon 的世界坐标体系一致
//   动画：带 `flow` 时启用 ShaderMaterial，UV 沿弧长滚动
//
// 公开 API：
//   createThickLineMesh( { points, kind, style, strokeColor, opacity, materialPool } )
//   ThickLineMaterialPool — 简单材质缓存（可选）
//

import {
	BufferGeometry,
	Color,
	DoubleSide,
	Float32BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	ShaderMaterial,
	Vector3,
} from 'three';

const _tangent = new Vector3();
const _up = new Vector3( 0, 1, 0 );
const _normal = new Vector3();

function colorFromRgba( rgba, fallback = 0xffffff ) {

	if ( ! rgba ) return new Color( fallback );
	return new Color(
		Math.max( 0, Math.min( 1, rgba[ 0 ] ) ),
		Math.max( 0, Math.min( 1, rgba[ 1 ] ) ),
		Math.max( 0, Math.min( 1, rgba[ 2 ] ) ),
	);

}

// 在世界坐标 XZ 平面上为折线生成 ribbon 顶点 + UV
function buildRibbonGeometry( points, halfWidth ) {

	if ( points.length < 2 ) return null;

	const positions = [];
	const uvs = [];
	const indices = [];
	const arcLengths = [ 0 ];

	let totalLen = 0;
	for ( let i = 1; i < points.length; i ++ ) {

		const dx = points[ i ][ 0 ] - points[ i - 1 ][ 0 ];
		const dz = points[ i ][ 2 ] - points[ i - 1 ][ 2 ];
		totalLen += Math.hypot( dx, dz );
		arcLengths.push( totalLen );

	}

	if ( totalLen <= 0 ) return null;

	for ( let i = 0; i < points.length; i ++ ) {

		const point = points[ i ];

		// 切线（根据相邻点决定方向）
		if ( i === 0 ) {

			_tangent.set(
				points[ 1 ][ 0 ] - point[ 0 ],
				0,
				points[ 1 ][ 2 ] - point[ 2 ],
			);

		} else if ( i === points.length - 1 ) {

			_tangent.set(
				point[ 0 ] - points[ i - 1 ][ 0 ],
				0,
				point[ 2 ] - points[ i - 1 ][ 2 ],
			);

		} else {

			_tangent.set(
				points[ i + 1 ][ 0 ] - points[ i - 1 ][ 0 ],
				0,
				points[ i + 1 ][ 2 ] - points[ i - 1 ][ 2 ],
			);

		}

		_tangent.normalize();
		// 法线 = up × tangent → 仍在 XZ 平面
		_normal.crossVectors( _up, _tangent ).normalize();

		const left = [
			point[ 0 ] + _normal.x * halfWidth,
			point[ 1 ],
			point[ 2 ] + _normal.z * halfWidth,
		];
		const right = [
			point[ 0 ] - _normal.x * halfWidth,
			point[ 1 ],
			point[ 2 ] - _normal.z * halfWidth,
		];

		positions.push( ...left, ...right );
		const u = arcLengths[ i ] / totalLen;
		uvs.push( u, 1, u, 0 );

	}

	for ( let i = 0; i < points.length - 1; i ++ ) {

		const a = i * 2;
		const b = a + 1;
		const c = a + 2;
		const d = a + 3;
		indices.push( a, c, b, b, c, d );

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new Float32BufferAttribute( uvs, 2 ) );
	geometry.setIndex( indices );
	geometry.computeBoundingBox?.();
	geometry.computeBoundingSphere?.();

	geometry.userData.totalLength = totalLen;
	return geometry;

}

// dashed pattern: dashLength + gapLength（世界单位）
function createDashedMaterial( params ) {

	const { color, opacity, dashLength, gapLength, totalLength } = params;
	const period = dashLength + gapLength;
	if ( period <= 0 ) {

		return new MeshBasicMaterial( { color, transparent: true, opacity, side: DoubleSide } );

	}

	const dashRatio = dashLength / period;
	return new ShaderMaterial( {
		transparent: true,
		side: DoubleSide,
		depthWrite: false,
		uniforms: {
			uColor: { value: color },
			uOpacity: { value: opacity },
			uTotalLen: { value: totalLength },
			uPeriod: { value: period },
			uDashRatio: { value: dashRatio },
			uFlow: { value: 0 },
		},
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			}
		`,
		fragmentShader: `
			varying vec2 vUv;
			uniform vec3 uColor;
			uniform float uOpacity;
			uniform float uTotalLen;
			uniform float uPeriod;
			uniform float uDashRatio;
			uniform float uFlow;
			void main() {
				float arc = vUv.x * uTotalLen + uFlow;
				float local = mod( arc, uPeriod ) / uPeriod;
				if ( local > uDashRatio ) discard;
				gl_FragColor = vec4( uColor, uOpacity );
			}
		`,
	} );

}

// flow: 在虚线材质基础上每帧推进 uFlow（在 PlotEngine 的 RAF 循环里更新）
function createFlowMaterial( params ) {

	const material = createDashedMaterial( params );
	material.userData.isFlow = true;
	material.userData.flowSpeed = params.flowSpeed ?? 4;
	material.userData.lastTime = 0;
	material.userData._beforeRender = ( ) => {

		const now = performance.now ? performance.now() : Date.now();
		if ( ! material.userData.lastTime ) material.userData.lastTime = now;
		const dt = ( now - material.userData.lastTime ) / 1000;
		material.userData.lastTime = now;
		material.uniforms.uFlow.value -= material.userData.flowSpeed * dt;

	};

	material.onBeforeRender = material.userData._beforeRender;
	return material;

}

export class ThickLineMaterialPool {

	constructor() {

		this._materials = new Map();

	}

	get( key, create ) {

		let material = this._materials.get( key ) || null;
		if ( ! material ) {

			material = create();
			this._materials.set( key, material );

		}

		return material;

	}

	releaseExcept( activeKeys ) {

		for ( const [ key, material ] of this._materials ) {

			if ( activeKeys.has( key ) ) continue;
			material.dispose?.();
			this._materials.delete( key );

		}

	}

	dispose() {

		this.releaseExcept( new Set() );

	}

}

/**
 * @param {object} options
 * @param {Array<Array<number>>} options.points - [[x, y, z], ...] 世界坐标
 * @param {string} options.kind - line-thick / line-dashed / line-flow
 * @param {object} options.style - { strokeWidth, dashLength, gapLength, flowSpeed, ... }
 * @param {Array<number>} [options.strokeColor] - rgba 0..1
 * @param {number} [options.opacity]
 * @param {ThickLineMaterialPool} [options.materialPool]
 */
export function createThickLineMesh( options ) {

	const {
		points,
		kind,
		style = {},
		strokeColor,
		opacity = 1,
		materialPool,
	} = options;

	if ( ! points || points.length < 2 ) return null;

	const halfWidth = Math.max( ( style.strokeWidth ?? 1 ) * 0.5, 1e-6 );
	const geometry = buildRibbonGeometry( points, halfWidth );
	if ( ! geometry ) return null;

	const totalLength = geometry.userData.totalLength;
	const color = colorFromRgba( strokeColor );
	const params = {
		color,
		opacity: Math.max( 0, Math.min( 1, opacity ) ),
		dashLength: style.dashLength ?? halfWidth * 4,
		gapLength: style.gapLength ?? halfWidth * 4,
		totalLength,
		flowSpeed: style.flowSpeed ?? halfWidth * 8,
	};

	let material;
	const key = `${ kind }|${ color.getHex() }|${ params.opacity.toFixed( 3 ) }|${ params.dashLength }|${ params.gapLength }`;
	const create = () => {

		if ( kind === 'line-flow' ) return createFlowMaterial( params );
		if ( kind === 'line-dashed' ) return createDashedMaterial( params );
		return new MeshBasicMaterial( {
			color,
			transparent: true,
			opacity: params.opacity,
			side: DoubleSide,
			depthWrite: false,
		} );

	};

	material = materialPool ? materialPool.get( key, create ) : create();

	const mesh = new Mesh( geometry, material );
	mesh.userData.plotKind = kind;
	return mesh;

}
