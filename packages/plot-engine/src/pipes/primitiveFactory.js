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

const noopRaycast = () => {};
const WORLD_POLYGON_OFFSET_FACTOR = 1;
const WORLD_POLYGON_OFFSET_UNITS = 1;

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

	return ( compiled.shape.coordinates || [] ).map( point => [ point[ 0 ], point[ 1 ] ] );

}

function makeHeightAwarePolygonGeometry( compiled ) {

	if ( compiled.kind !== 'polygon' ) return null;

	const coordinates = compiled.shape.coordinates || [];
	if ( coordinates.length < 3 ) return null;

	const hasHeights = coordinates.every( point => point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) );
	if ( ! hasHeights ) return null;

	const contour = coordinates.map( point => new Vector2( point[ 0 ], point[ 1 ] ) );
	const triangles = ShapeUtils.triangulateShape( contour, [] );
	if ( triangles.length === 0 ) return null;

	const positions = [];
	for ( const triangle of triangles ) {

		for ( const index of triangle ) {

			const point = coordinates[ index ];
			positions.push( point[ 0 ], getHeight( compiled, point ), point[ 1 ] );

		}

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
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

export function createPrimitiveObject( compiled ) {

	let object = null;
	switch ( compiled.kind ) {

		case 'point':
			object = makePointObject( compiled );
			break;
		case 'line':
		case 'polyline':
			object = makeLineObject( compiled );
			break;
		case 'polygon':
		case 'rectangle':
		case 'circle':
		case 'sector':
		case 'arrow':
			object = makePolygonObject( compiled );
			break;
		default:
			object = null;

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

	for ( const compiled of compiledShapes ) {

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
			case 'polygon':
			case 'rectangle':
			case 'circle':
			case 'sector':
			case 'arrow': {

				const geometry = createPolygonGeometry( compiled );
				if ( ! geometry ) break;
				const batch = getOrCreateBatch( batches, 'meshes', getPolygonMaterialState( compiled ), materialPool );
				batch.geometries.push( geometry );
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

	group.userData.plotMaterialKeys = materialKeys;
	return group;

}

export function disposeObjectTree( root, options = {} ) {

	const disposeMaterials = options.disposeMaterials !== false;

	root.traverse?.( child => {

		child.geometry?.dispose?.();
		if ( ! disposeMaterials ) return;
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
