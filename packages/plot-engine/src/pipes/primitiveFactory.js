import {
	BufferGeometry,
	DoubleSide,
	Float32BufferAttribute,
	Group,
	Line,
	LineBasicMaterial,
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

function colorValue( rgba, fallback = 0xffffff ) {

	if ( ! rgba ) return fallback;
	return ( Math.round( rgba[ 0 ] * 255 ) << 16 ) |
		( Math.round( rgba[ 1 ] * 255 ) << 8 ) |
		Math.round( rgba[ 2 ] * 255 );

}

function getHeight( compiled, point = null ) {

	if ( ( compiled?.attachment?.mode ?? 'world' ) !== 'world' ) {

		return 0;

	}

	if ( point && point.length > 2 && Number.isFinite( Number( point[ 2 ] ) ) ) {

		return Number( point[ 2 ] );

	}

	return Number( compiled.height ?? compiled.style?.altitude ?? compiled.style?.elevation ?? compiled.style?.z ?? 0 );

}

function isWorldAttachment( compiled ) {

	return ( compiled?.attachment?.mode ?? 'world' ) === 'world';

}

function createPolygonMaterial( compiled ) {

	const material = new MeshBasicMaterial( {
		color: colorValue( compiled.sdf.style.fill ),
		side: DoubleSide,
		transparent: true,
		opacity: compiled.sdf.style.opacity ?? 1,
		depthWrite: false,
	} );

	if ( isWorldAttachment( compiled ) ) {

		material.polygonOffset = true;
		material.polygonOffsetFactor = WORLD_POLYGON_OFFSET_FACTOR;
		material.polygonOffsetUnits = WORLD_POLYGON_OFFSET_UNITS;

	}

	return material;

}

function makePointObject( compiled ) {

	const geometry = new BufferGeometry();
	const point = compiled.shape.coordinates[ 0 ];
	const [ x, y ] = point;
	geometry.setAttribute( 'position', new Float32BufferAttribute( [ x, getHeight( compiled, point ), y ], 3 ) );

	return new Points( geometry, new PointsMaterial( {
		size: compiled.style.size ?? 6,
		sizeAttenuation: false,
		color: colorValue( compiled.sdf.style.stroke ),
		transparent: true,
		opacity: compiled.sdf.style.opacity ?? 1,
	} ) );

}

function makeLineObject( compiled ) {

	const coordinates = compiled.shape.coordinates || [];
	const positions = [];
	for ( const point of coordinates ) {

		positions.push( point[ 0 ], getHeight( compiled, point ), point[ 1 ] );

	}

	const geometry = new BufferGeometry();
	geometry.setAttribute( 'position', new Float32BufferAttribute( positions, 3 ) );
	return new Line( geometry, new LineBasicMaterial( {
		color: colorValue( compiled.sdf.style.stroke ),
		transparent: true,
		opacity: compiled.sdf.style.opacity ?? 1,
	} ) );

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

function makePolygonObject( compiled ) {

	const heightAwareGeometry = makeHeightAwarePolygonGeometry( compiled );
	if ( heightAwareGeometry ) {

		return new Mesh( heightAwareGeometry, createPolygonMaterial( compiled ) );

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

export function disposeObjectTree( root ) {

	root.traverse?.( child => {

		child.geometry?.dispose?.();
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
