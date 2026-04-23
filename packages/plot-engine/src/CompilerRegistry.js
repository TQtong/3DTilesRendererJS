import { registerDefaultCompilers } from './compilers/defaultCompilers.js';

export class CompilerRegistry {

	constructor( options = {} ) {

		this._compilers = new Map();
		if ( options.defaultCompilers !== false ) {

			registerDefaultCompilers( this );

		}

	}

	register( kind, compiler ) {

		if ( typeof compiler !== 'function' ) {

			throw new Error( `CompilerRegistry: compiler for "${ kind }" must be a function.` );

		}

		this._compilers.set( kind, compiler );
		return this;

	}

	unregister( kind ) {

		return this._compilers.delete( kind );

	}

	has( kind ) {

		return this._compilers.has( kind );

	}

	compile( shape ) {

		const compiler = this._compilers.get( shape.kind );
		if ( ! compiler ) {

			throw new Error( `CompilerRegistry: no compiler registered for "${ shape.kind }".` );

		}

		return compiler( shape, this );

	}

	compileMany( shapes ) {

		const result = [];
		for ( const shape of shapes ) {

			const compiled = this.compile( shape );
			if ( compiled ) result.push( compiled );

		}

		return result;

	}

}
