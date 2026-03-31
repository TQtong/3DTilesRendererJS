import { WebGLRenderer } from 'three';

export class PlotImageSource {

	shapes: Map<unknown, unknown>;
	resolution: number;
	projection: unknown;

	constructor( options?: Record<string, unknown> );
	init(): Promise<void>;
	setRenderer( renderer: WebGLRenderer | null ): void;
	redraw(): void;
	hasContent( ...tokens: number[] ): boolean;
	get( ...tokens: number[] ): unknown;
	lock( ...tokens: number[] ): unknown;
	release( ...tokens: number[] ): void;

}
