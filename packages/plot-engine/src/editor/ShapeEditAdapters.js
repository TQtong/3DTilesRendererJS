// ============================================================
// editor/ShapeEditAdapters.js — 各 shape kind 的编辑语义
// 层级：编辑层 / 适配器
// 职责：为每种 shape（point/line/polyline/polygon/rectangle/circle/sector/arrow）
//        定义"哪些点可编辑、如何插入/删除顶点、如何计算中点和中心点、
//        如何在编辑期把内部状态映射回 ShapeStore 期望的 coordinates"
// 依赖：无（纯函数 + 数学）
// 被消费：EditSession、HandleLayer、DragController
// ============================================================

/**
 * 编辑语义有 8 种 shape，按几何特征分为三类：
 *   1. 顶点链型：line / polyline / polygon —— 每个 coord 是真实顶点
 *   2. 包围盒型：rectangle —— coordinates 是 [minCorner, maxCorner]
 *                              展开为 4 个角 handle + 4 个边中点 handle
 *   3. 参数型：point / circle / sector / arrow
 *              —— coordinates 只有 1~2 个，多数信息在 style 里
 *
 * 所有 adapter 实现统一接口：
 *   getEditableHandles( shape ) → Handle[]
 *   applyHandleDrag( shape, handleId, point ) → patch
 *   canRemoveVertex( shape, handleId ) → boolean
 *   removeVertex( shape, handleId ) → patch
 *   getInsertableEdges( shape ) → Edge[]
 *   insertVertex( shape, edgeId, point ) → patch
 *   getCenter( shape ) → [x, y]
 *   translate( shape, dx, dy ) → patch
 *
 * patch 的形状始终是 { coordinates?, style? }，与 ShapeStore.update 兼容。
 */

// ── Handle 类型常量 ──────────────────────────────────────────
export const HANDLE_VERTEX = 'vertex';
export const HANDLE_MIDPOINT = 'midpoint';
export const HANDLE_CENTER = 'center';
export const HANDLE_RADIUS = 'radius';
export const HANDLE_ANGLE = 'angle';
export const HANDLE_WIDTH = 'width';

// ── 工具函数 ────────────────────────────────────────────────

function midpoint( a, b ) {

	if ( a.length > 2 && b.length > 2 ) {

		return [ ( a[ 0 ] + b[ 0 ] ) * 0.5, ( a[ 1 ] + b[ 1 ] ) * 0.5, ( a[ 2 ] + b[ 2 ] ) * 0.5 ];

	}

	return [ ( a[ 0 ] + b[ 0 ] ) * 0.5, ( a[ 1 ] + b[ 1 ] ) * 0.5 ];

}

function arithmeticCenter( points ) {

	if ( ! points || points.length === 0 ) return [ 0, 0 ];
	let sumX = 0;
	let sumY = 0;
	let sumZ = 0;
	let hasZ = false;
	for ( const point of points ) {

		sumX += point[ 0 ];
		sumY += point[ 1 ];
		if ( point.length > 2 ) {

			sumZ += point[ 2 ];
			hasZ = true;

		}

	}

	const inv = 1 / points.length;
	return hasZ
		? [ sumX * inv, sumY * inv, sumZ * inv ]
		: [ sumX * inv, sumY * inv ];

}

function copyPoint( point ) {

	return point.length > 2
		? [ point[ 0 ], point[ 1 ], point[ 2 ] ]
		: [ point[ 0 ], point[ 1 ] ];

}

function translateCoords( coordinates, dx, dy ) {

	return coordinates.map( point => point.length > 2
		? [ point[ 0 ] + dx, point[ 1 ] + dy, point[ 2 ] ]
		: [ point[ 0 ] + dx, point[ 1 ] + dy ] );

}

// ── 通用：顶点链型适配器（line/polyline/polygon 共用）────────────────

function makeVertexChainAdapter( { kind, closed, minVertices } ) {

	return {

		kind,

		getEditableHandles( shape ) {

			const coords = shape.coordinates || [];
			const handles = [];

			for ( let index = 0; index < coords.length; index ++ ) {

				handles.push( {
					id: `vertex:${ index }`,
					type: HANDLE_VERTEX,
					position: copyPoint( coords[ index ] ),
					meta: { vertexIndex: index },
				} );

			}

			const edgeCount = closed ? coords.length : Math.max( 0, coords.length - 1 );
			for ( let index = 0; index < edgeCount; index ++ ) {

				const a = coords[ index ];
				const b = coords[ ( index + 1 ) % coords.length ];
				handles.push( {
					id: `midpoint:${ index + 1 }`,
					type: HANDLE_MIDPOINT,
					position: midpoint( a, b ),
					meta: { insertIndex: index + 1 },
				} );

			}

			if ( coords.length > 0 ) {

				handles.push( {
					id: 'center',
					type: HANDLE_CENTER,
					position: arithmeticCenter( coords ),
					meta: {},
				} );

			}

			return handles;

		},

		applyHandleDrag( shape, handleId, point ) {

			const coords = ( shape.coordinates || [] ).map( copyPoint );

			if ( handleId.startsWith( 'vertex:' ) ) {

				const vertexIndex = Number( handleId.slice( 7 ) );
				if ( vertexIndex < 0 || vertexIndex >= coords.length ) return null;
				const z = coords[ vertexIndex ][ 2 ];
				coords[ vertexIndex ] = z !== undefined
					? [ point[ 0 ], point[ 1 ], z ]
					: [ point[ 0 ], point[ 1 ] ];
				return { coordinates: coords };

			}

			if ( handleId === 'center' ) {

				const center = arithmeticCenter( coords );
				const dx = point[ 0 ] - center[ 0 ];
				const dy = point[ 1 ] - center[ 1 ];
				return { coordinates: translateCoords( coords, dx, dy ) };

			}

			return null;

		},

		canRemoveVertex( shape, handleId ) {

			if ( ! handleId.startsWith( 'vertex:' ) ) return false;
			const coords = shape.coordinates || [];
			return coords.length > minVertices;

		},

		removeVertex( shape, handleId ) {

			if ( ! handleId.startsWith( 'vertex:' ) ) return null;
			const vertexIndex = Number( handleId.slice( 7 ) );
			const coords = ( shape.coordinates || [] ).map( copyPoint );
			if ( vertexIndex < 0 || vertexIndex >= coords.length ) return null;
			coords.splice( vertexIndex, 1 );
			return { coordinates: coords, removedIndex: vertexIndex };

		},

		getInsertableEdges( shape ) {

			const coords = shape.coordinates || [];
			const edges = [];
			const edgeCount = closed ? coords.length : Math.max( 0, coords.length - 1 );
			for ( let index = 0; index < edgeCount; index ++ ) {

				edges.push( {
					id: `edge:${ index }`,
					insertIndex: index + 1,
					a: copyPoint( coords[ index ] ),
					b: copyPoint( coords[ ( index + 1 ) % coords.length ] ),
				} );

			}

			return edges;

		},

		insertVertex( shape, handleId, point ) {

			let edgeIndex;
			if ( handleId.startsWith( 'edge:' ) ) {

				edgeIndex = Number( handleId.slice( 5 ) );

			} else if ( handleId.startsWith( 'midpoint:' ) ) {

				const targetInsertIndex = Number( handleId.slice( 9 ) );
				edgeIndex = targetInsertIndex - 1;

			} else {

				return null;

			}

			const coords = ( shape.coordinates || [] ).map( copyPoint );
			const insertIndex = edgeIndex + 1;
			const z = coords[ edgeIndex ]?.[ 2 ];
			const newPoint = z !== undefined
				? [ point[ 0 ], point[ 1 ], z ]
				: [ point[ 0 ], point[ 1 ] ];
			coords.splice( insertIndex, 0, newPoint );
			return { coordinates: coords, insertedIndex: insertIndex };

		},

		getCenter( shape ) {

			return arithmeticCenter( shape.coordinates || [] );

		},

		translate( shape, dx, dy ) {

			return { coordinates: translateCoords( shape.coordinates || [], dx, dy ) };

		},

	};

}

// ── point ────────────────────────────────────────────────────
const pointAdapter = {
	kind: 'point',

	getEditableHandles( shape ) {

		const coords = shape.coordinates || [];
		if ( coords.length === 0 ) return [];
		return [ {
			id: 'center',
			type: HANDLE_CENTER,
			position: copyPoint( coords[ 0 ] ),
			meta: {},
		} ];

	},

	applyHandleDrag( shape, handleId, point ) {

		if ( handleId !== 'center' ) return null;
		const z = shape.coordinates?.[ 0 ]?.[ 2 ];
		return { coordinates: [ z !== undefined ? [ point[ 0 ], point[ 1 ], z ] : [ point[ 0 ], point[ 1 ] ] ] };

	},

	canRemoveVertex() { return false; },
	removeVertex() { return null; },
	getInsertableEdges() { return []; },
	insertVertex() { return null; },

	getCenter( shape ) {

		return copyPoint( shape.coordinates?.[ 0 ] || [ 0, 0 ] );

	},

	translate( shape, dx, dy ) {

		return { coordinates: translateCoords( shape.coordinates || [], dx, dy ) };

	},

};

// ── rectangle ───────────────────────────────────────────────
const rectangleAdapter = {

	kind: 'rectangle',

	_extents( coords ) {

		const a = coords?.[ 0 ];
		const b = coords?.[ 1 ];
		if ( ! a || ! b ) return { minX: 0, minY: 0, maxX: 0, maxY: 0, z: undefined };
		const minX = Math.min( a[ 0 ], b[ 0 ] );
		const minY = Math.min( a[ 1 ], b[ 1 ] );
		const maxX = Math.max( a[ 0 ], b[ 0 ] );
		const maxY = Math.max( a[ 1 ], b[ 1 ] );
		const z = a.length > 2 ? a[ 2 ] : ( b.length > 2 ? b[ 2 ] : undefined );
		return { minX, minY, maxX, maxY, z };

	},

	_pack( ext ) {

		return ext.z !== undefined
			? [ [ ext.minX, ext.minY, ext.z ], [ ext.maxX, ext.maxY, ext.z ] ]
			: [ [ ext.minX, ext.minY ], [ ext.maxX, ext.maxY ] ];

	},

	getEditableHandles( shape ) {

		const ext = this._extents( shape.coordinates || [] );
		const { minX, minY, maxX, maxY, z } = ext;
		const cx = ( minX + maxX ) * 0.5;
		const cy = ( minY + maxY ) * 0.5;
		const make = ( id, x, y, type, meta ) => ( {
			id,
			type,
			position: z !== undefined ? [ x, y, z ] : [ x, y ],
			meta,
		} );

		return [
			make( 'corner:tl', minX, minY, HANDLE_VERTEX, { corner: 'tl' } ),
			make( 'corner:tr', maxX, minY, HANDLE_VERTEX, { corner: 'tr' } ),
			make( 'corner:br', maxX, maxY, HANDLE_VERTEX, { corner: 'br' } ),
			make( 'corner:bl', minX, maxY, HANDLE_VERTEX, { corner: 'bl' } ),
			make( 'edge:t', cx, minY, HANDLE_MIDPOINT, { edge: 't' } ),
			make( 'edge:r', maxX, cy, HANDLE_MIDPOINT, { edge: 'r' } ),
			make( 'edge:b', cx, maxY, HANDLE_MIDPOINT, { edge: 'b' } ),
			make( 'edge:l', minX, cy, HANDLE_MIDPOINT, { edge: 'l' } ),
			make( 'center', cx, cy, HANDLE_CENTER, {} ),
		];

	},

	applyHandleDrag( shape, handleId, point ) {

		const ext = this._extents( shape.coordinates || [] );
		const x = point[ 0 ];
		const y = point[ 1 ];

		if ( handleId === 'corner:tl' ) { ext.minX = x; ext.minY = y; }
		else if ( handleId === 'corner:tr' ) { ext.maxX = x; ext.minY = y; }
		else if ( handleId === 'corner:br' ) { ext.maxX = x; ext.maxY = y; }
		else if ( handleId === 'corner:bl' ) { ext.minX = x; ext.maxY = y; }
		else if ( handleId === 'edge:t' ) { ext.minY = y; }
		else if ( handleId === 'edge:r' ) { ext.maxX = x; }
		else if ( handleId === 'edge:b' ) { ext.maxY = y; }
		else if ( handleId === 'edge:l' ) { ext.minX = x; }
		else if ( handleId === 'center' ) {

			const cx = ( ext.minX + ext.maxX ) * 0.5;
			const cy = ( ext.minY + ext.maxY ) * 0.5;
			const dx = x - cx;
			const dy = y - cy;
			ext.minX += dx; ext.maxX += dx;
			ext.minY += dy; ext.maxY += dy;

		} else {

			return null;

		}

		const normalized = {
			minX: Math.min( ext.minX, ext.maxX ),
			maxX: Math.max( ext.minX, ext.maxX ),
			minY: Math.min( ext.minY, ext.maxY ),
			maxY: Math.max( ext.minY, ext.maxY ),
			z: ext.z,
		};
		return { coordinates: this._pack( normalized ) };

	},

	canRemoveVertex() { return false; },
	removeVertex() { return null; },
	getInsertableEdges() { return []; },
	insertVertex() { return null; },

	getCenter( shape ) {

		const ext = this._extents( shape.coordinates || [] );
		const cx = ( ext.minX + ext.maxX ) * 0.5;
		const cy = ( ext.minY + ext.maxY ) * 0.5;
		return ext.z !== undefined ? [ cx, cy, ext.z ] : [ cx, cy ];

	},

	translate( shape, dx, dy ) {

		const ext = this._extents( shape.coordinates || [] );
		ext.minX += dx; ext.maxX += dx;
		ext.minY += dy; ext.maxY += dy;
		return { coordinates: this._pack( ext ) };

	},

};

// ── circle ──────────────────────────────────────────────────
const circleAdapter = {

	kind: 'circle',

	getEditableHandles( shape ) {

		const center = shape.coordinates?.[ 0 ];
		if ( ! center ) return [];
		const radius = Number( shape.style?.radius ?? 1 );
		const z = center[ 2 ];

		return [
			{
				id: 'center',
				type: HANDLE_CENTER,
				position: copyPoint( center ),
				meta: {},
			},
			{
				id: 'radius',
				type: HANDLE_RADIUS,
				position: z !== undefined
					? [ center[ 0 ] + radius, center[ 1 ], z ]
					: [ center[ 0 ] + radius, center[ 1 ] ],
				meta: { radius },
			},
		];

	},

	applyHandleDrag( shape, handleId, point ) {

		const center = shape.coordinates?.[ 0 ];
		if ( ! center ) return null;
		const z = center[ 2 ];

		if ( handleId === 'center' ) {

			return {
				coordinates: [ z !== undefined
					? [ point[ 0 ], point[ 1 ], z ]
					: [ point[ 0 ], point[ 1 ] ] ],
			};

		}

		if ( handleId === 'radius' ) {

			const dx = point[ 0 ] - center[ 0 ];
			const dy = point[ 1 ] - center[ 1 ];
			const newRadius = Math.max( 1e-6, Math.hypot( dx, dy ) );
			return { style: { radius: newRadius } };

		}

		return null;

	},

	canRemoveVertex() { return false; },
	removeVertex() { return null; },
	getInsertableEdges() { return []; },
	insertVertex() { return null; },

	getCenter( shape ) {

		return copyPoint( shape.coordinates?.[ 0 ] || [ 0, 0 ] );

	},

	translate( shape, dx, dy ) {

		return { coordinates: translateCoords( shape.coordinates || [], dx, dy ) };

	},

};

// ── sector ──────────────────────────────────────────────────
const sectorAdapter = {

	kind: 'sector',

	getEditableHandles( shape ) {

		const center = shape.coordinates?.[ 0 ];
		if ( ! center ) return [];
		const radius = Number( shape.style?.radius ?? 1 );
		const startAngle = Number( shape.style?.startAngle ?? 0 );
		const sectorAngle = Number( shape.style?.sectorAngle ?? Math.PI * 0.5 );
		const z = center[ 2 ];

		const ax = center[ 0 ] + radius * Math.cos( startAngle );
		const ay = center[ 1 ] + radius * Math.sin( startAngle );
		const bx = center[ 0 ] + radius * Math.cos( startAngle + sectorAngle );
		const by = center[ 1 ] + radius * Math.sin( startAngle + sectorAngle );
		const midAngle = startAngle + sectorAngle * 0.5;
		const rx = center[ 0 ] + radius * Math.cos( midAngle );
		const ry = center[ 1 ] + radius * Math.sin( midAngle );

		const at = ( x, y, id, type, meta ) => ( {
			id,
			type,
			position: z !== undefined ? [ x, y, z ] : [ x, y ],
			meta,
		} );

		return [
			at( center[ 0 ], center[ 1 ], 'center', HANDLE_CENTER, {} ),
			at( rx, ry, 'radius', HANDLE_RADIUS, {} ),
			at( ax, ay, 'angle-start', HANDLE_ANGLE, { side: 'start' } ),
			at( bx, by, 'angle-end', HANDLE_ANGLE, { side: 'end' } ),
		];

	},

	applyHandleDrag( shape, handleId, point ) {

		const center = shape.coordinates?.[ 0 ];
		if ( ! center ) return null;
		const z = center[ 2 ];
		const startAngle = Number( shape.style?.startAngle ?? 0 );
		const sectorAngle = Number( shape.style?.sectorAngle ?? Math.PI * 0.5 );

		if ( handleId === 'center' ) {

			return {
				coordinates: [ z !== undefined
					? [ point[ 0 ], point[ 1 ], z ]
					: [ point[ 0 ], point[ 1 ] ] ],
			};

		}

		if ( handleId === 'radius' ) {

			const dx = point[ 0 ] - center[ 0 ];
			const dy = point[ 1 ] - center[ 1 ];
			return { style: { radius: Math.max( 1e-6, Math.hypot( dx, dy ) ) } };

		}

		if ( handleId === 'angle-start' ) {

			const oldEnd = startAngle + sectorAngle;
			const newStart = Math.atan2( point[ 1 ] - center[ 1 ], point[ 0 ] - center[ 0 ] );
			let newSector = oldEnd - newStart;
			while ( newSector < 0 ) newSector += Math.PI * 2;
			while ( newSector > Math.PI * 2 ) newSector -= Math.PI * 2;
			return { style: { startAngle: newStart, sectorAngle: newSector } };

		}

		if ( handleId === 'angle-end' ) {

			const newEnd = Math.atan2( point[ 1 ] - center[ 1 ], point[ 0 ] - center[ 0 ] );
			let newSector = newEnd - startAngle;
			while ( newSector < 0 ) newSector += Math.PI * 2;
			while ( newSector > Math.PI * 2 ) newSector -= Math.PI * 2;
			return { style: { sectorAngle: newSector } };

		}

		return null;

	},

	canRemoveVertex() { return false; },
	removeVertex() { return null; },
	getInsertableEdges() { return []; },
	insertVertex() { return null; },

	getCenter( shape ) {

		return copyPoint( shape.coordinates?.[ 0 ] || [ 0, 0 ] );

	},

	translate( shape, dx, dy ) {

		return { coordinates: translateCoords( shape.coordinates || [], dx, dy ) };

	},

};

// ── arrow ───────────────────────────────────────────────────
const arrowAdapter = {

	kind: 'arrow',

	getEditableHandles( shape ) {

		const coords = shape.coordinates || [];
		if ( coords.length < 2 ) return [];
		const a = coords[ 0 ];
		const b = coords[ coords.length - 1 ];
		const z = ( a.length > 2 ? a[ 2 ] : undefined );

		const dx = b[ 0 ] - a[ 0 ];
		const dy = b[ 1 ] - a[ 1 ];
		const length = Math.hypot( dx, dy );
		const width = Number( shape.style?.width ?? Math.max( length * 0.08, 1e-6 ) );
		const cx = ( a[ 0 ] + b[ 0 ] ) * 0.5;
		const cy = ( a[ 1 ] + b[ 1 ] ) * 0.5;
		const nx = length > 0 ? - dy / length : 0;
		const ny = length > 0 ? dx / length : 0;
		const wx = cx + nx * width;
		const wy = cy + ny * width;

		const at = ( x, y, id, type, meta ) => ( {
			id,
			type,
			position: z !== undefined ? [ x, y, z ] : [ x, y ],
			meta,
		} );

		return [
			at( a[ 0 ], a[ 1 ], 'vertex:0', HANDLE_VERTEX, { vertexIndex: 0 } ),
			at( b[ 0 ], b[ 1 ], 'vertex:1', HANDLE_VERTEX, { vertexIndex: 1 } ),
			at( cx, cy, 'center', HANDLE_CENTER, {} ),
			at( wx, wy, 'width', HANDLE_WIDTH, {} ),
		];

	},

	applyHandleDrag( shape, handleId, point ) {

		const coords = ( shape.coordinates || [] ).map( copyPoint );
		if ( coords.length < 2 ) return null;
		const a = coords[ 0 ];
		const b = coords[ 1 ];
		const z = a.length > 2 ? a[ 2 ] : undefined;

		if ( handleId === 'vertex:0' ) {

			coords[ 0 ] = z !== undefined ? [ point[ 0 ], point[ 1 ], z ] : [ point[ 0 ], point[ 1 ] ];
			return { coordinates: coords };

		}

		if ( handleId === 'vertex:1' ) {

			coords[ 1 ] = z !== undefined ? [ point[ 0 ], point[ 1 ], z ] : [ point[ 0 ], point[ 1 ] ];
			return { coordinates: coords };

		}

		if ( handleId === 'center' ) {

			const cx = ( a[ 0 ] + b[ 0 ] ) * 0.5;
			const cy = ( a[ 1 ] + b[ 1 ] ) * 0.5;
			const dx = point[ 0 ] - cx;
			const dy = point[ 1 ] - cy;
			return { coordinates: translateCoords( coords, dx, dy ) };

		}

		if ( handleId === 'width' ) {

			const ax = a[ 0 ], ay = a[ 1 ];
			const bx = b[ 0 ], by = b[ 1 ];
			const cx = ( ax + bx ) * 0.5;
			const cy = ( ay + by ) * 0.5;
			const ddx = bx - ax;
			const ddy = by - ay;
			const length = Math.hypot( ddx, ddy );
			if ( length === 0 ) return { style: { width: 1e-6 } };
			const nx = - ddy / length;
			const ny = ddx / length;
			const px = point[ 0 ] - cx;
			const py = point[ 1 ] - cy;
			const projected = px * nx + py * ny;
			return { style: { width: Math.max( 1e-6, Math.abs( projected ) ) } };

		}

		return null;

	},

	canRemoveVertex() { return false; },
	removeVertex() { return null; },
	getInsertableEdges() { return []; },
	insertVertex() { return null; },

	getCenter( shape ) {

		const coords = shape.coordinates || [];
		if ( coords.length < 2 ) return copyPoint( coords[ 0 ] || [ 0, 0 ] );
		const a = coords[ 0 ];
		const b = coords[ coords.length - 1 ];
		const z = a.length > 2 ? a[ 2 ] : undefined;
		const cx = ( a[ 0 ] + b[ 0 ] ) * 0.5;
		const cy = ( a[ 1 ] + b[ 1 ] ) * 0.5;
		return z !== undefined ? [ cx, cy, z ] : [ cx, cy ];

	},

	translate( shape, dx, dy ) {

		return { coordinates: translateCoords( shape.coordinates || [], dx, dy ) };

	},

};

// ── 注册表 ──────────────────────────────────────────────────

const _registry = new Map();
_registry.set( 'point', pointAdapter );
_registry.set( 'line', makeVertexChainAdapter( { kind: 'line', closed: false, minVertices: 2 } ) );
_registry.set( 'polyline', makeVertexChainAdapter( { kind: 'polyline', closed: false, minVertices: 2 } ) );
_registry.set( 'polygon', makeVertexChainAdapter( { kind: 'polygon', closed: true, minVertices: 3 } ) );
_registry.set( 'rectangle', rectangleAdapter );
_registry.set( 'circle', circleAdapter );
_registry.set( 'sector', sectorAdapter );
_registry.set( 'arrow', arrowAdapter );

/**
 * 取出指定 kind 的 adapter；找不到返回 null。
 *
 * @param {string} kind
 * @returns {object|null}
 */
export function getShapeEditAdapter( kind ) {

	return _registry.get( kind ) || null;

}

/**
 * 注册自定义 shape 的编辑适配器。
 *
 * @param {string} kind
 * @param {object} adapter
 */
export function registerShapeEditAdapter( kind, adapter ) {

	if ( ! kind || typeof adapter !== 'object' ) return;
	_registry.set( kind, adapter );

}
