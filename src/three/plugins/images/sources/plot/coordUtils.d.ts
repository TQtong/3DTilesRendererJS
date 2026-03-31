import { Vector3 } from 'three';

export const DEG2RAD: number;
export const LABEL_ATLAS: number;

export function lonLatToMeters(
	lonDeg: number,
	latDeg: number,
	centerLonRad: number,
	centerLatRad: number,
	ellipsoid: { getCartographicToPosition: ( ...args: number[] ) => void },
	east: Vector3,
	north: Vector3,
	centerECEF: Vector3
): { e: number; n: number };
