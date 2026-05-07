// ============================================================
// editor/HandleLayer.js — 编辑手柄渲染层
// 层级：编辑层 / 渲染
// 职责：把 ShapeEditAdapter 给出的 Handle[] 转为 Three.js 可拾取对象，
//       并维护选中高亮 outline。所有材质 depthTest=false 永远渲染在最上层。
// 依赖：three（既有项目栈），./ShapeEditAdapters.js
// 被消费：EditSession（编辑期挂载）、PlotEditor（选中高亮挂载）
//
// 坐标约定：
//   shape.coordinates 中存储的 [x, y, z] 是逻辑平面上的点（x = 经度/东向，
//   y = 纬度/北向，z = 高度）。PlotEngine 在渲染到 3D 世界时使用 Y-up 约定，
//   实际放置位置为 (x, z, y)（高度作为世界 Y）。本层在写入 InstancedMesh 与
//   outline 时统一进行该坐标置换。
// ============================================================

import {
	BufferAttribute,
	BufferGeometry,
	CircleGeometry,
	Group,
	InstancedMesh,
	Line,
	LineBasicMaterial,
	LineLoop,
	Matrix4,
	MeshBasicMaterial,
	RingGeometry,
	Vector3,
} from 'three';

import {
	HANDLE_ANGLE,
	HANDLE_CENTER,
	HANDLE_MIDPOINT,
	HANDLE_RADIUS,
	HANDLE_VERTEX,
	HANDLE_WIDTH,
} from './ShapeEditAdapters.js';

// 渲染顺序：编辑层永远在 PlotEngine 渲染之上
const HANDLE_RENDER_ORDER = 999;

// Handle 视觉常量（局部坐标单位；调用方按 target 的尺度可乘以 sizeScale）
const VERTEX_HANDLE_SIZE = 1.0;
const MIDPOINT_HANDLE_SIZE = 0.7;
const CENTER_HANDLE_SIZE = 1.2;
const RADIUS_HANDLE_SIZE = 1.0;
const ANGLE_HANDLE_SIZE = 0.9;
const WIDTH_HANDLE_SIZE = 0.9;

const VERTEX_COLOR = 0x60a5fa;
const MIDPOINT_COLOR = 0xf59e0b;
const CENTER_COLOR = 0xec4899;
const RADIUS_COLOR = 0x10b981;
const ANGLE_COLOR = 0x10b981;
const WIDTH_COLOR = 0x8b5cf6;
const HOVER_COLOR = 0xffffff;
const OUTLINE_COLOR = 0xfacc15;

const _matrix = new Matrix4();
const _vec = new Vector3();

/**
 * 将 shape 坐标 [x, y, z?] 转换为 3D 世界局部坐标 [x, z, y]。
 * z 缺省时取 0（贴在 y=0 的水平面）。
 *
 * @param {Array<number>} point
 * @param {Vector3} out
 */
function shapeToWorld( point, out ) {

	const sx = Number( point[ 0 ] ) || 0;
	const sy = Number( point[ 1 ] ) || 0;
	const sz = point.length > 2 ? Number( point[ 2 ] ) || 0 : 0;
	out.set( sx, sz, sy );
	return out;

}

/**
 * 一个 HandleLayer 服务于"一个正在编辑的 shape"。
 * 内部维护：
 *  - 一个 LineLoop / Line 显示 shape 的轮廓（高亮）
 *  - 多个 InstancedMesh，按 handle 类型分桶（避免每个 handle 一个 Mesh 撑爆 drawcall）
 *  - 一个 mapping 表：instanceId → handleId，用于 raycast 命中后反查
 */
export class HandleLayer {

	constructor( options = {} ) {

		this.group = new Group();
		this.group.name = 'PlotEditor.HandleLayer';
		this.group.matrixAutoUpdate = true;

		this._sizeScale = Number( options.sizeScale ?? 1 );
		this._maxInstances = options.maxInstances ?? 4096;

		this._discGeometry = new CircleGeometry( 1, 24 );
		this._discGeometry.rotateX( - Math.PI / 2 ); // 圆面朝上（XZ 平面）
		this._ringGeometry = new RingGeometry( 0.7, 1.0, 24 );
		this._ringGeometry.rotateX( - Math.PI / 2 );

		this._buckets = new Map();
		this._buildBucket( HANDLE_VERTEX, this._discGeometry, VERTEX_COLOR, VERTEX_HANDLE_SIZE );
		this._buildBucket( HANDLE_MIDPOINT, this._discGeometry, MIDPOINT_COLOR, MIDPOINT_HANDLE_SIZE );
		this._buildBucket( HANDLE_CENTER, this._discGeometry, CENTER_COLOR, CENTER_HANDLE_SIZE );
		this._buildBucket( HANDLE_RADIUS, this._ringGeometry, RADIUS_COLOR, RADIUS_HANDLE_SIZE );
		this._buildBucket( HANDLE_ANGLE, this._ringGeometry, ANGLE_COLOR, ANGLE_HANDLE_SIZE );
		this._buildBucket( HANDLE_WIDTH, this._ringGeometry, WIDTH_COLOR, WIDTH_HANDLE_SIZE );

		this._outlineMaterial = new LineBasicMaterial( {
			color: OUTLINE_COLOR,
			transparent: true,
			opacity: 0.9,
			depthTest: false,
			depthWrite: false,
		} );
		this._outline = null;

		this._hovered = null;

	}

	setSizeScale( scale ) {

		const next = Number( scale );
		if ( ! Number.isFinite( next ) || next <= 0 ) return;
		if ( next === this._sizeScale ) return;
		this._sizeScale = next;
		for ( const bucket of this._buckets.values() ) {

			this._rebuildBucketMatrices( bucket );

		}

	}

	updateHandles( handles ) {

		for ( const bucket of this._buckets.values() ) {

			bucket.count = 0;
			bucket.ids.length = 0;
			bucket.positions.length = 0;

		}

		for ( const handle of handles || [] ) {

			const bucket = this._buckets.get( handle.type );
			if ( ! bucket ) continue;
			if ( bucket.count >= this._maxInstances ) continue;
			bucket.ids.push( handle.id );
			bucket.positions.push( handle.position );
			bucket.count ++;

		}

		for ( const bucket of this._buckets.values() ) {

			this._rebuildBucketMatrices( bucket );

		}

		this._hovered = null;

	}

	updateOutline( kind, shape ) {

		if ( this._outline ) {

			this.group.remove( this._outline );
			this._outline.geometry?.dispose?.();
			this._outline = null;

		}

		const polyline = this._sampleOutlinePolyline( kind, shape );
		if ( ! polyline || polyline.length < 2 ) return;

		const closed = kind === 'polygon' || kind === 'rectangle' || kind === 'circle' || kind === 'sector';
		const positions = new Float32Array( polyline.length * 3 );
		for ( let index = 0; index < polyline.length; index ++ ) {

			const point = polyline[ index ];
			// shape (x, y, z) → world (x, z, y)
			positions[ index * 3 + 0 ] = point[ 0 ];
			positions[ index * 3 + 1 ] = point.length > 2 ? point[ 2 ] : 0;
			positions[ index * 3 + 2 ] = point[ 1 ];

		}

		const geometry = new BufferGeometry();
		geometry.setAttribute( 'position', new BufferAttribute( positions, 3 ) );

		this._outline = closed
			? new LineLoop( geometry, this._outlineMaterial )
			: new Line( geometry, this._outlineMaterial );
		this._outline.renderOrder = HANDLE_RENDER_ORDER - 1;
		this._outline.matrixAutoUpdate = true;
		this._outline.frustumCulled = false;
		this._outline.raycast = () => {};
		this.group.add( this._outline );

	}

	setHovered( target ) {

		const previous = this._hovered;
		this._hovered = target;

		if ( previous ) {

			const bucket = this._buckets.get( previous.type );
			if ( bucket ) this._setInstanceColor( bucket, previous.instanceId, bucket.baseColor );

		}

		if ( target ) {

			const bucket = this._buckets.get( target.type );
			if ( bucket ) this._setInstanceColor( bucket, target.instanceId, HOVER_COLOR );

		}

	}

	resolveHit( hitMesh, instanceId ) {

		for ( const [ type, bucket ] of this._buckets ) {

			if ( bucket.mesh !== hitMesh ) continue;
			if ( instanceId < 0 || instanceId >= bucket.count ) return null;
			return {
				type,
				handleId: bucket.ids[ instanceId ],
				instanceId,
			};

		}

		return null;

	}

	getRaycastTargets() {

		const result = [];
		for ( const bucket of this._buckets.values() ) {

			if ( bucket.count > 0 ) result.push( bucket.mesh );

		}

		return result;

	}

	dispose() {

		this.group.removeFromParent();
		for ( const bucket of this._buckets.values() ) {

			bucket.mesh.material?.dispose?.();

		}

		this._buckets.clear();
		this._discGeometry.dispose();
		this._ringGeometry.dispose();
		this._outlineMaterial.dispose();
		if ( this._outline ) {

			this._outline.geometry?.dispose?.();
			this._outline = null;

		}

	}

	// ── 内部 ──

	_buildBucket( type, geometry, color, size ) {

		const material = new MeshBasicMaterial( {
			color,
			transparent: true,
			opacity: 0.95,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
		} );

		const mesh = new InstancedMesh( geometry, material, this._maxInstances );
		mesh.name = `PlotEditor.HandleLayer.${ type }`;
		mesh.count = 0;
		mesh.frustumCulled = false;
		mesh.renderOrder = HANDLE_RENDER_ORDER;
		mesh.matrixAutoUpdate = true;

		mesh.instanceColor = null;

		this.group.add( mesh );
		this._buckets.set( type, {
			type,
			mesh,
			count: 0,
			baseSize: size,
			baseColor: color,
			ids: [],
			positions: [],
		} );

	}

	_rebuildBucketMatrices( bucket ) {

		const mesh = bucket.mesh;
		const finalScale = bucket.baseSize * this._sizeScale;
		for ( let index = 0; index < bucket.count; index ++ ) {

			const point = bucket.positions[ index ];
			shapeToWorld( point, _vec );
			_matrix.makeScale( finalScale, finalScale, finalScale );
			_matrix.setPosition( _vec );
			mesh.setMatrixAt( index, _matrix );

		}

		mesh.count = bucket.count;
		if ( mesh.instanceMatrix ) mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere?.();
		mesh.computeBoundingBox?.();

	}

	_setInstanceColor( bucket, instanceId, color ) {

		const mesh = bucket.mesh;
		if ( ! mesh.instanceColor ) {

			const colors = new Float32Array( this._maxInstances * 3 );
			for ( let index = 0; index < this._maxInstances; index ++ ) {

				const r = ( ( bucket.baseColor >> 16 ) & 0xff ) / 255;
				const g = ( ( bucket.baseColor >> 8 ) & 0xff ) / 255;
				const b = ( bucket.baseColor & 0xff ) / 255;
				colors[ index * 3 + 0 ] = r;
				colors[ index * 3 + 1 ] = g;
				colors[ index * 3 + 2 ] = b;

			}

			mesh.instanceColor = new BufferAttribute( colors, 3 );

		}

		const colorBuf = mesh.instanceColor;
		colorBuf.array[ instanceId * 3 + 0 ] = ( ( color >> 16 ) & 0xff ) / 255;
		colorBuf.array[ instanceId * 3 + 1 ] = ( ( color >> 8 ) & 0xff ) / 255;
		colorBuf.array[ instanceId * 3 + 2 ] = ( color & 0xff ) / 255;
		colorBuf.needsUpdate = true;

	}

	/**
	 * 根据 shape kind 把几何"采样"为一串折线点（仍处于 shape 坐标）；
	 * 由 updateOutline 在写入 BufferAttribute 时统一进行 (x,y,z)→(x,z,y) 置换。
	 *
	 * @param {string} kind
	 * @param {object} shape
	 * @returns {Array<Array<number>>|null}
	 */
	_sampleOutlinePolyline( kind, shape ) {

		const coords = shape.coordinates || [];

		if ( kind === 'point' ) return null;

		if ( kind === 'line' || kind === 'polyline' || kind === 'polygon' ) {

			return coords.map( point => point.length > 2
				? [ point[ 0 ], point[ 1 ], point[ 2 ] ]
				: [ point[ 0 ], point[ 1 ], 0 ] );

		}

		if ( kind === 'rectangle' ) {

			const a = coords[ 0 ];
			const b = coords[ 1 ];
			if ( ! a || ! b ) return null;
			const z = a.length > 2 ? a[ 2 ] : 0;
			const minX = Math.min( a[ 0 ], b[ 0 ] );
			const minY = Math.min( a[ 1 ], b[ 1 ] );
			const maxX = Math.max( a[ 0 ], b[ 0 ] );
			const maxY = Math.max( a[ 1 ], b[ 1 ] );
			return [
				[ minX, minY, z ],
				[ maxX, minY, z ],
				[ maxX, maxY, z ],
				[ minX, maxY, z ],
			];

		}

		if ( kind === 'arrow' ) {

			const a = coords[ 0 ];
			const b = coords[ coords.length - 1 ];
			if ( ! a || ! b ) return null;
			const z = a.length > 2 ? a[ 2 ] : 0;
			const dx = b[ 0 ] - a[ 0 ];
			const dy = b[ 1 ] - a[ 1 ];
			const length = Math.hypot( dx, dy );
			if ( length === 0 ) return null;
			const width = Number( shape.style?.width ?? length * 0.08 );
			const headLength = Number( shape.style?.headLength ?? Math.min( length * 0.3, width * 4 ) );
			const ux = dx / length;
			const uy = dy / length;
			const nx = - uy;
			const ny = ux;
			const neckX = b[ 0 ] - ux * headLength;
			const neckY = b[ 1 ] - uy * headLength;
			return [
				[ a[ 0 ] + nx * width * 0.35, a[ 1 ] + ny * width * 0.35, z ],
				[ neckX + nx * width, neckY + ny * width, z ],
				[ b[ 0 ], b[ 1 ], z ],
				[ neckX - nx * width, neckY - ny * width, z ],
				[ a[ 0 ] - nx * width * 0.35, a[ 1 ] - ny * width * 0.35, z ],
			];

		}

		if ( kind === 'circle' ) {

			const center = coords[ 0 ];
			if ( ! center ) return null;
			const z = center.length > 2 ? center[ 2 ] : 0;
			const radius = Number( shape.style?.radius ?? 1 );
			const segments = 64;
			const points = new Array( segments );
			for ( let index = 0; index < segments; index ++ ) {

				const angle = ( index / segments ) * Math.PI * 2;
				points[ index ] = [
					center[ 0 ] + radius * Math.cos( angle ),
					center[ 1 ] + radius * Math.sin( angle ),
					z,
				];

			}

			return points;

		}

		if ( kind === 'sector' ) {

			const center = coords[ 0 ];
			if ( ! center ) return null;
			const z = center.length > 2 ? center[ 2 ] : 0;
			const radius = Number( shape.style?.radius ?? 1 );
			const startAngle = Number( shape.style?.startAngle ?? 0 );
			const sectorAngle = Number( shape.style?.sectorAngle ?? Math.PI * 0.5 );
			const segments = Math.max( 8, Math.min( 64, Math.round( ( sectorAngle / ( Math.PI * 2 ) ) * 64 ) ) );
			const points = [];
			points.push( [ center[ 0 ], center[ 1 ], z ] );
			for ( let index = 0; index <= segments; index ++ ) {

				const t = index / segments;
				const angle = startAngle + sectorAngle * t;
				points.push( [
					center[ 0 ] + radius * Math.cos( angle ),
					center[ 1 ] + radius * Math.sin( angle ),
					z,
				] );

			}

			return points;

		}

		return null;

	}

}
