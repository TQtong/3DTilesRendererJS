import { PlotBase } from './PlotBase.js';

export class PlotArrow extends PlotBase {

	generatedCoords: number[][];

	constructor( options?: Record<string, unknown> );
	generateCoords(): number[][];
	getSnapshot(): { type: string; options: Record<string, unknown>; generatedCoords: number[][] };

}
