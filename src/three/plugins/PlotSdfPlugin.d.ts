export class PlotSdfPlugin {

	name: string;
	priority: number;
	shapes: Map<unknown, unknown>;
	opacity: number;
	contentBounds: number[] | null;

	constructor( options?: {
		shapes?: Map<unknown, unknown>,
		opacity?: number,
	} );

	init( tiles: unknown ): void;
	processTileModel( scene: unknown, tile: unknown ): void;
	disposeTile( tile: unknown ): void;
	dispose(): void;
	redraw(): void;

}
