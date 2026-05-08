import { registerDefaultCompilers } from './compilers/defaultCompilers.js';
import { registerMilitaryArrowCompilers } from './compilers/militaryArrowCompilers.js';
import { registerTextCompiler } from './compilers/textCompiler.js';
import { registerIconCompiler } from './compilers/iconCompiler.js';

export class CompilerRegistry {

	constructor( options = {} ) {

		this._compilers = new Map();
		this._revision = 0;
		if ( options.defaultCompilers !== false ) {

			registerDefaultCompilers( this );
			registerMilitaryArrowCompilers( this );
			registerTextCompiler( this );
			registerIconCompiler( this );

		}

	}

	get revision() {

		return this._revision;

	}

	register( kind, compiler ) {

		if ( typeof compiler !== 'function' ) {

			throw new Error( `CompilerRegistry: compiler for "${ kind }" must be a function.` );

		}

		this._compilers.set( kind, compiler );
		this._revision ++;
		return this;

	}

	unregister( kind ) {

		const removed = this._compilers.delete( kind );
		if ( removed ) this._revision ++;
		return removed;

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
