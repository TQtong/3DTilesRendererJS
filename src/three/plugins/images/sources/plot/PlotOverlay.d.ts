import { Color, Texture } from 'three';
import { PlotImageSource } from './PlotImageSource.js';

export class PlotOverlay {

	readonly isPlanarProjection: boolean;
	get projection(): unknown;
	get aspectRatio(): number;

	opacity: number;
	color: Color;
	frame: unknown;
	fetchOptions: unknown;
	preprocessURL: unknown;
	alphaMask: boolean;
	alphaInvert: boolean;
	imageSource: PlotImageSource;

	constructor( options?: Record<string, unknown> );
	init(): void;
	whenReady(): Promise<void>;
	fetch( url: string, options?: RequestInit ): Promise<Response>;
	getAttributions(): unknown;
	hasContent( range: number[] ): boolean;
	getTexture( range: number[] ): Texture | null | Promise<Texture | null>;
	lockTexture( range: number[], _tile?: object ): unknown;
	releaseTexture( range: number[], _tile?: object ): void;
	setResolution( resolution: number ): void;
	shouldSplit(): boolean;
	redraw(): void;

}
