import { B3DMBaseResult, I3DMBaseResult, PNTSBaseResult, CMPTLoaderBase } from 'um-3d-tiles-renderer/core';
import { Group, LoadingManager } from 'three';

export interface CMPTResult {

	tiles : Array<B3DMBaseResult|I3DMBaseResult|PNTSBaseResult>;
	scene : Group;

}

export class CMPTLoader<Result extends CMPTResult = CMPTResult, ParseResult = Promise<Result>>
	extends CMPTLoaderBase<Result, ParseResult> {

	constructor( manager : LoadingManager );

}
