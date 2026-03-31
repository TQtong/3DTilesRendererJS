export class PlotBase {

	id: number;
	category: string;
	options: Record<string, unknown>;

	constructor( options?: Record<string, unknown> );
	update( patch: Record<string, unknown> ): void;
	getSnapshot(): { type: string; options: Record<string, unknown> };
	getCenterPoints(): number[][];
	getExtentPoints(): number[][];

}
