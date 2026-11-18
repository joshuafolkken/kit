import path from 'node:path'
import { direct_importers, type ImportMap } from './direct-importers'
import type { Resolve } from './test-symbol-facts'

// **The source file a module specifier names**, for the symbol-level test selection
// (`test-symbol-select.ts`): a relative, `$lib` or `package.json` `imports` specifier, tried as
// written and then with each source extension and as a directory's `index`; the first candidate in
// the source set wins. A package import, or one naming no source, resolves to `undefined`.

const LIB_ALIAS = '$lib'
const LIB_DIRECTORY = 'src/lib'
const INDEX = 'index'
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.svelte']

// The path a specifier names before any extension is tried, or `undefined` for a package import.
function written_of(specifier: string, from: string, imports: ImportMap): string | undefined {
	if (specifier.startsWith('.')) return path.posix.join(path.posix.dirname(from), specifier)

	if (specifier === LIB_ALIAS || specifier.startsWith(`${LIB_ALIAS}/`)) {
		return path.posix.join(LIB_DIRECTORY, specifier.slice(LIB_ALIAS.length))
	}

	return direct_importers.resolve_specifier(specifier, from, imports)
}

function candidates_of(written: string): Array<string> {
	const stems = [written, direct_importers.module_key(written), path.posix.join(written, INDEX)]

	return [written, ...stems.flatMap((stem) => EXTENSIONS.map((extension) => stem + extension))]
}

// A resolver over `sources`, root-relative and `/`-separated.
function resolver(sources: ReadonlyArray<{ file: string }>, imports: ImportMap): Resolve {
	const files = new Set(sources.map((source) => source.file))

	return function resolve(specifier: string, from: string): string | undefined {
		const written = written_of(specifier, from, imports)

		return written === undefined
			? undefined
			: candidates_of(written).find((candidate) => files.has(candidate))
	}
}

const test_symbol_resolve = { resolver }

export { test_symbol_resolve }
