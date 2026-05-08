import {
	BufferGeometry,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	Line,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	Points,
	PointsMaterial,
	Shape,
	ShapeGeometry,
	ShapeUtils,
	Vector2,
} from 'three';
import { createThickLineMesh, ThickLineMaterialPool } from './ThickLineMaterial.js';
import {
	createTextMesh,
	createIconMesh,
	createLeaderLineMesh,
	disposeSpriteMesh,
} from './SpriteFactory.js';

const noopRaycast = () => {};
const WORLD_POLYGON_OFFSET_FACTOR = 1;
const WORLD_POLYGON_OFFSET_UNITS = 1;

const MILITARY_ARROW_POLYGON_KINDS = new Set( [
	'arrow-fine',
	'arrow-swallowtail',
	'arrow-curved',
	'arrow-attack',
	'arrow-tailed-attack',
	'arrow-double',
	'gathering-place',
] );

const POLYGON_KINDS = new Set( [
	'polygon',
	'rectangle',
	'circle',
	'sector',
	'arrow',
	...MILITARY_ARROW_POLYGON_KINDS,
] );

const THICK_LINE_KINDS = new Set( [
	'line-thick',
	'line-dashed',
	'line-flow',
] );

const TEXT_KINDS = new Set( [ 'text-label', 'text-leader' ] );
const ICON_KINDS = new Set( [ 'icon', 'milsymbol' ] );

function getPrecomputedPolygonPoints( compiled ) {

	const primitives = compiled.primitives || [];
	const polygonPrim = primitives.find( prim => prim.kind === 'polygon' );
	if ( ! polygonPrim ) return null;
	if ( polygonPrim.points3D ) return polygonPrim.points3D;
	return polygonPrim.points || null;

}

function getAllPrecomputedPolygonPrimitives( compiled ) {

	const primitives = compiled.primitives || [];
	return primitives.filter( prim => prim.kind === 'polygon' );

}

export class PrimitiveMaterialPool {

	constructor() {

		this._materials = new Map();

	}

	get( key, createMaterial ) {

		let material = this._materials.get( key ) || null;
		if ( ! material ) {

			material = createMaterial();
			this._materials.set( key, material );

		}

		return material;

	}

	releaseExcept( activeKeys ) {

		for ( const [ key, material ] of this._materials ) {

			if ( activeKeys.has( key ) ) continue;
			material?.dispose?.();
			this._materials.delete( key );

		}

	}

	dispose() {

		this.releaseExcept( new Set() );

	}

}

function colorValue( rgba, fallback = 0xffffff ) {

	if ( ! rgba ) return fallback;
	return ( Math.round( rgba[ 0 ] * 255 ) << 16 ) |
		( Math.round( rgba[ 1 ] * 255 ) << 8 ) |
		Math.round( rgba[ 2 ] * 255 );

}

function isTilesAttachment( compiled ) {

	return ( compiled?.attachment?.mode ?? 'world' ) === 'tiles';

}

function getHeight( compiled, point = null ) {

	if ( isTilesAttachment( compiled ) ) {

		return 0;

	}

	if ( point && point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) ) {

		return Number( point[ 2 ] );

	}

	return Number( compiled.height ?? compiled.style?.altitude ?? compiled.style?.elevation ?? compiled.style?.z ?? 0 );

}

function getPointMaterialState( compiled ) {

	const color = colorValue( compiled.sdf.style.stroke );
	const opacity = compiled.sdf.style.opacity ?? 1;
	const size = compiled.style.size ?? 6;
	return {
		key: `point|${ color }|${ opacity }|${ size }`,
		create: () => new PointsMaterial( {
			size,
			sizeAttenuation: false,
			color,
			transparent: true,
			opacity,
		} ),
	};

}

function getLineMaterialState( compiled ) {

	const color = colorValue( compiled.sdf.style.stroke );
	const opacity = compiled.sdf.style.opacity ?? 1;
	return {
		key: `line|${ color }|${ opacity }`,
		create: () => new LineBasicMaterial( {
			color,
			transparent: true,
			opacity,
		} ),
	};

}

function getPolygonMaterialState( compiled ) {

	const color = colorValue( compiled.sdf.style.fill );
	const opacity = compiled.sdf.style.opacity ?? 1;
	const polygonOffset = ! isTilesAttachment( compiled );
	return {
		key: `polygon|${ color }|${ opacity }|${ polygonOffset ? 1 : 0 }`,
		create: () => {

			const material = new MeshBasicMaterial( {
				color,
				side: DoubleSide,
				transparent: true,
				opacity,
				depthWrite: false,
			} );

			if ( polygonOffset ) {

				material.polygonOffset = true;
				material.polygonOffsetFactor = WORLD_POLYGON_OFFSET_FACTOR;
				material.polygonOffsetUnits = WORLD_POLYGON_OFFSET_UNITS;

			}

			return material;

		},
	};

}

function createPolygonMaterial( compiled ) {

	return getPolygonMaterialState( compiled ).create();

}

function createGeometryFromPositions( positions ) {

	if ( positions.length === 0 ) return null;
	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	geometry.computeBoundingBox?.();
	geometry.computeBoundingSphere?.();
	return geometry;

}

function makePointPositions( compiled ) {

	const point = compiled.shape.coordinates[ 0 ];
	const [ x, y ] = point;
	return [ x, getHeight( compiled, point ), y ];

}

function makePointObject( compiled ) {

	const geometry = createGeometryFromPositions( makePointPositions( compiled ) );
	if ( ! geometry ) return null;

	return new Points( geometry, getPointMaterialState( compiled ).create() );

}

function makeLineSegmentPositions( compiled ) {

	const coordinates = compiled.shape.coordinates || [];
	const positions = [];
	for ( let index = 1; index < coordinates.length; index ++ ) {

		const previousPoint = coordinates[ index - 1 ];
		const point = coordinates[ index ];
		positions.push(
			previousPoint[ 0 ], getHeight( compiled, previousPoint ), previousPoint[ 1 ],
			point[ 0 ], getHeight( compiled, point ), point[ 1 ],
		);

	}

	return positions;

}

function makeLineObject( compiled ) {

	const positions = makeLineSegmentPositions( compiled );
	if ( positions.length === 0 ) return null;
	const geometry = createGeometryFromPositions( positions );
	if ( ! geometry ) return null;
	return new Line( geometry, getLineMaterialState( compiled ).create() );

}

function makePolygonPoints( compiled ) {

	if ( compiled.kind === 'rectangle' ) {

		const bounds = compiled.bounds;
		return [
			[ bounds[ 0 ], bounds[ 1 ] ],
			[ bounds[ 2 ], bounds[ 1 ] ],
			[ bounds[ 2 ], bounds[ 3 ] ],
			[ bounds[ 0 ], bounds[ 3 ] ],
		];

	}

	if ( compiled.kind === 'circle' || compiled.kind === 'sector' ) {

		const [ centerX, centerY ] = compiled.shape.coordinates[ 0 ];
		const radius = compiled.shape.style?.radius ?? 1;
		const start = compiled.kind === 'sector' ? compiled.shape.style?.startAngle ?? 0 : 0;
		const angle = compiled.kind === 'sector' ? compiled.shape.style?.sectorAngle ?? Math.PI * 0.5 : Math.PI * 2;
		const points = compiled.kind === 'sector' ? [ [ centerX, centerY ] ] : [];
		const segments = 32;
		for ( let index = 0; index <= segments; index ++ ) {

			const theta = start + angle * index / segments;
			points.push( [
				centerX + Math.cos( theta ) * radius,
				centerY + Math.sin( theta ) * radius,
			] );

		}

		return points;

	}

	// 军标箭头家族 / gathering-place：编译器预计算了多边形顶点
	const precomputed = getPrecomputedPolygonPoints( compiled );
	if ( precomputed ) {

		return precomputed.map( point => [ point[ 0 ], point[ 1 ] ] );

	}

	return ( compiled.shape.coordinates || [] ).map( point => [ point[ 0 ], point[ 1 ] ] );

}

function makeHeightAwarePolygonGeometry( compiled ) {

	const isPolygonLike = compiled.kind === 'polygon' || MILITARY_ARROW_POLYGON_KINDS.has( compiled.kind );
	if ( ! isPolygonLike ) return null;

	// 军标箭头：编译器输出的 primitives 中每个 polygon 都是一条独立外环
	const polygonPrimitives = getAllPrecomputedPolygonPrimitives( compiled );

	const buildPositionsForRing = ( ring ) => {

		if ( ! ring || ring.length < 3 ) return null;
		const hasHeights = ring.every( point => point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) );
		if ( ! hasHeights ) return null;
		const contour = ring.map( point => new Vector2( point[ 0 ], point[ 1 ] ) );
		const triangles = ShapeUtils.triangulateShape( contour, [] );
		if ( triangles.length === 0 ) return null;
		const positions = [];
		for ( const triangle of triangles ) {

			for ( const index of triangle ) {

				const point = ring[ index ];
				positions.push( point[ 0 ], getHeight( compiled, point ), point[ 1 ] );

			}

		}

		return positions;

	};

	const allPositions = [];

	if ( polygonPrimitives.length > 0 ) {

		// 多多边形（如 doubleArrow）→ 各自三角化后合并
		for ( const prim of polygonPrimitives ) {

			const ring = prim.points3D || prim.points;
			const positions = buildPositionsForRing( ring );
			if ( positions ) allPositions.push( ...positions );

		}

	} else {

		// 走 shape.coordinates 的兼容路径
		const positions = buildPositionsForRing( compiled.shape.coordinates || [] );
		if ( positions ) allPositions.push( ...positions );

	}

	if ( allPositions.length === 0 ) return null;

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( allPositions, 3 ) );
	geometry.computeBoundingBox?.();
	geometry.computeBoundingSphere?.();
	return geometry;

}

function createPolygonGeometry( compiled ) {

	const heightAwareGeometry = makeHeightAwarePolygonGeometry( compiled );
	if ( heightAwareGeometry ) {

		return heightAwareGeometry;

	}

	const points = makePolygonPoints( compiled );
	if ( points.length < 3 ) return null;

	const shape = new Shape();
	shape.moveTo( points[ 0 ][ 0 ], points[ 0 ][ 1 ] );
	for ( let index = 1; index < points.length; index ++ ) {

		shape.lineTo( points[ index ][ 0 ], points[ index ][ 1 ] );

	}

	const geometry = new ShapeGeometry( shape );
	geometry.rotateX( - Math.PI / 2 );
	geometry.translate( 0, getHeight( compiled ), 0 );
	const renderGeometry = geometry.index ? geometry.toNonIndexed() : geometry;
	const position = renderGeometry.getAttribute( 'position' );
	if ( ! position ) {

		if ( renderGeometry !== geometry ) renderGeometry.dispose();
		geometry.dispose();
		return null;

	}

	const polygonGeometry = new BufferGeometry();
	polygonGeometry.setAttribute( 'position', new Float32BufferAttribute( new Float32Array( position.array ), 3 ) );
	polygonGeometry.computeBoundingBox?.();
	polygonGeometry.computeBoundingSphere?.();
	if ( renderGeometry !== geometry ) renderGeometry.dispose();
	geometry.dispose();
	return polygonGeometry;

}

function makePolygonObject( compiled ) {

	const geometry = createPolygonGeometry( compiled );
	if ( ! geometry ) return null;
	return new Mesh( geometry, createPolygonMaterial( compiled ) );

}

function makeThickLineObject( compiled, thickLineMaterialPool ) {

	const coords = compiled.shape.coordinates || [];
	if ( coords.length < 2 ) return null;
	const points = coords.map( point => {

		const x = Number( point[ 0 ] );
		const y = Number( point[ 1 ] );
		const z = getHeight( compiled, point );
		return [ x, z, y ];

	} );

	return createThickLineMesh( {
		points,
		kind: compiled.kind,
		style: compiled.style || {},
		strokeColor: compiled.sdf?.style?.stroke,
		opacity: compiled.sdf?.style?.opacity ?? 1,
		materialPool: thickLineMaterialPool,
	} );

}

function makeTextObject( compiled ) {

	const group = new Group();
	group.name = `PlotEngine.Text.${ compiled.id }`;
	const primitives = compiled.primitives || [];
	for ( const prim of primitives ) {

		if ( prim.kind === 'text' ) {

			const mesh = createTextMesh( prim );
			if ( mesh ) group.add( mesh );

		} else if ( prim.kind === 'text-leader-line' ) {

			const mesh = createLeaderLineMesh( prim );
			if ( mesh ) group.add( mesh );

		}

	}

	return group.children.length > 0 ? group : null;

}

function makeIconObject( compiled ) {

	const primitives = compiled.primitives || [];
	const iconPrim = primitives.find( prim => prim.kind === 'icon' );
	if ( ! iconPrim ) return null;
	return createIconMesh( iconPrim );

}

export function createPrimitiveObject( compiled, options = {} ) {

	let object = null;
	const thickLineMaterialPool = options.thickLineMaterialPool ?? null;

	if ( THICK_LINE_KINDS.has( compiled.kind ) ) {

		object = makeThickLineObject( compiled, thickLineMaterialPool );

	} else if ( TEXT_KINDS.has( compiled.kind ) ) {

		object = makeTextObject( compiled );

	} else if ( ICON_KINDS.has( compiled.kind ) ) {

		object = makeIconObject( compiled );

	} else if ( POLYGON_KINDS.has( compiled.kind ) ) {

		object = makePolygonObject( compiled );

	} else {

		switch ( compiled.kind ) {

			case 'point':
				object = makePointObject( compiled );
				break;
			case 'line':
			case 'polyline':
				object = makeLineObject( compiled );
				break;
			default:
				object = null;

		}

	}

	if ( object ) {

		object.name = `PlotEngine.Primitive.${ compiled.id }`;
		object.userData.plotShapeId = compiled.id;
		object.raycast = noopRaycast;

	}

	return object;

}

function mergePositionGeometries( geometries ) {

	let totalLength = 0;
	const entries = [];
	for ( const geometry of geometries ) {

		const position = geometry.getAttribute( 'position' );
		if ( ! position ) {

			geometry.dispose();
			continue;

		}

		entries.push( {
			array: position.array,
			geometry,
		} );
		totalLength += position.array.length;

	}

	if ( totalLength === 0 ) return null;

	const merged = new Float32Array( totalLength );
	let offset = 0;
	for ( const entry of entries ) {

		merged.set( entry.array, offset );
		offset += entry.array.length;
		entry.geometry.dispose();

	}

	return createGeometryFromPositions( merged );

}

function getOrCreateBatch( batches, type, materialState, materialPool ) {

	const batchKey = `${ type }|${ materialState.key }`;
	let batch = batches.get( batchKey ) || null;
	if ( ! batch ) {

		batch = {
			type,
			materialKey: materialState.key,
			material: materialPool
				? materialPool.get( materialState.key, materialState.create )
				: materialState.create(),
			positions: [],
			geometries: [],
		};
		batches.set( batchKey, batch );

	}

	return batch;

}

export function createBatchedPrimitiveGroup( compiledShapes, options = {} ) {

	const group = new Group();
	const batches = new Map();
	const materialPool = options.materialPool ?? null;
	const thickLineMaterialPool = options.thickLineMaterialPool ?? null;
	// 厚线 / 流光线、Atlas 通道：暂不参与 batch 合并（它们各自是独立 InstancedMesh / Mesh）
	const standaloneObjects = [];

	for ( const compiled of compiledShapes ) {

		if ( THICK_LINE_KINDS.has( compiled.kind ) ) {

			const object = makeThickLineObject( compiled, thickLineMaterialPool );
			if ( object ) standaloneObjects.push( object );
			continue;

		}

		if ( TEXT_KINDS.has( compiled.kind ) ) {

			const object = makeTextObject( compiled );
			if ( object ) standaloneObjects.push( object );
			continue;

		}

		if ( ICON_KINDS.has( compiled.kind ) ) {

			const object = makeIconObject( compiled );
			if ( object ) standaloneObjects.push( object );
			continue;

		}

		if ( POLYGON_KINDS.has( compiled.kind ) ) {

			const geometry = createPolygonGeometry( compiled );
			if ( ! geometry ) continue;
			const batch = getOrCreateBatch( batches, 'meshes', getPolygonMaterialState( compiled ), materialPool );
			batch.geometries.push( geometry );
			continue;

		}

		switch ( compiled.kind ) {

			case 'point': {

				const batch = getOrCreateBatch( batches, 'points', getPointMaterialState( compiled ), materialPool );
				batch.positions.push( ...makePointPositions( compiled ) );
				break;

			}
			case 'line':
			case 'polyline': {

				const positions = makeLineSegmentPositions( compiled );
				if ( positions.length === 0 ) break;
				const batch = getOrCreateBatch( batches, 'lines', getLineMaterialState( compiled ), materialPool );
				batch.positions.push( ...positions );
				break;

			}
			default:
				break;

		}

	}

	const materialKeys = [];
	for ( const batch of batches.values() ) {

		let object = null;
		if ( batch.type === 'points' ) {

			const geometry = createGeometryFromPositions( batch.positions );
			if ( geometry ) object = new Points( geometry, batch.material );

		} else if ( batch.type === 'lines' ) {

			const geometry = createGeometryFromPositions( batch.positions );
			if ( geometry ) object = new LineSegments( geometry, batch.material );

		} else if ( batch.type === 'meshes' ) {

			const geometry = mergePositionGeometries( batch.geometries );
			if ( geometry ) object = new Mesh( geometry, batch.material );

		}

		if ( ! object ) continue;
		object.name = `PlotEngine.PrimitiveBatch.${ batch.type }`;
		object.userData.plotBatchType = batch.type;
		object.raycast = noopRaycast;
		group.add( object );
		materialKeys.push( batch.materialKey );

	}

	for ( const object of standaloneObjects ) {

		object.raycast = noopRaycast;
		group.add( object );

	}

	group.userData.plotMaterialKeys = materialKeys;
	return group;

}

export function disposeObjectTree( root, options = {} ) {

	const disposeMaterials = options.disposeMaterials !== false;

	root.traverse?.( child => {

		// Sprite mesh 自带的 disposable 列表
		if ( child.userData?._disposable ) disposeSpriteMesh( child );
		child.geometry?.dispose?.();
		if ( ! disposeMaterials ) return;
		// thick-line / sprite 共享的材质由 pool 管理；不在此 dispose
		if ( child.userData?.plotKind === 'line-thick' ||
			child.userData?.plotKind === 'line-dashed' ||
			child.userData?.plotKind === 'line-flow' ) return;
		if ( Array.isArray( child.material ) ) {

			child.material.forEach( material => material?.dispose?.() );

		} else {

			child.material?.dispose?.();

		}

	} );

}

export function createPrimitiveGroup( compiledShapes ) {

	const group = new Group();
	for ( const compiled of compiledShapes ) {

		const object = createPrimitiveObject( compiled );
		if ( object ) group.add( object );

	}

	return group;

}
