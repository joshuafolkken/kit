import { realpathSync } from 'node:fs'
import path from 'node:path'
import type { SourceTransform } from './build-hooks'

// **Every bundled command module keeps the location of its source file.** The command bundles share
// chunks, so a module's own `import.meta.url` names whichever output file it landed in. That
// breaks a module that finds a sibling `.ts` (`run-ship-handover.ts`, `run-wake-cli.ts`), climbs to
// the package root by a fixed number of `..` from a deeper directory, or decides whether to run its
// main by comparing `argv[1]` against its own URL. The build defines `import.meta.url`, `filename`
// and `dirname` as module-local variables that hold the source file's location, worked out from the
// output file at run time so the package can sit anywhere. The dispatcher sets `argv[1]` to the
// source path (`josh-in-process.ts`), so a bundled command runs exactly as its source would.
//
// esbuild substitutes a defined `import.meta.url` in code only, never inside a string, and renames
// the module-local variables apart when it joins modules into one chunk. The prelude reads the real
// output URL through an alias, which the definition does not match.
const IMPORT_META = 'import.meta'
const SHEBANG = '#!'
const NEWLINE = '\n'
const SOURCE_URL = '__josh_source_url'
const SOURCE_FILENAME = '__josh_source_filename'
const SOURCE_DIRNAME = '__josh_source_dirname'

// esbuild's `define` keys are the expressions it replaces, so they are paired rather than named.
const SOURCE_LOCATION_DEFINE: Readonly<Record<string, string>> = Object.fromEntries([
	['import.meta.url', SOURCE_URL],
	['import.meta.filename', SOURCE_FILENAME],
	['import.meta.dirname', SOURCE_DIRNAME],
])

// Node resolves the output file through symlinks, and esbuild hands each source over by its real
// path, so the relative path has to run between real paths too. The output directory need not
// exist yet: its nearest existing ancestor is resolved and the rest appended.
function real_directory(directory: string): string {
	try {
		return realpathSync(directory)
	} catch {
		const parent = path.dirname(directory)

		return parent === directory
			? directory
			: path.join(real_directory(parent), path.basename(directory))
	}
}

function relative_url(out_directory: string, file_path: string): string {
	return path.relative(out_directory, file_path).split(path.sep).join('/')
}

// One line, prepended, so a stack trace's line numbers still match the source.
function location_prelude(out_directory: string, file_path: string): string {
	const url = JSON.stringify(relative_url(out_directory, file_path))

	return [
		"import { dirname as __josh_dirname } from 'node:path';",
		"import { fileURLToPath as __josh_file_path } from 'node:url';",
		'var __josh_meta = import.meta;',
		`var ${SOURCE_URL} = new URL(${url}, __josh_meta.url).href;`,
		`var ${SOURCE_FILENAME} = __josh_file_path(${SOURCE_URL});`,
		`var ${SOURCE_DIRNAME} = __josh_dirname(${SOURCE_FILENAME});`,
	].join(' ')
}

// A command script opens with a `#!` line, which only the first line may hold.
function prelude_offset(source: string): number {
	return source.startsWith(SHEBANG) ? source.indexOf(NEWLINE) + 1 : 0
}

// Every output file sits directly in `out_directory`, chunks included, so one relative path from it
// reaches each source.
function source_location(out_directory: string): SourceTransform {
	const real_out = real_directory(out_directory)

	return function locate(source: string, file_path: string): string {
		if (!source.includes(IMPORT_META)) return source
		const offset = prelude_offset(source)

		return `${source.slice(0, offset)}${location_prelude(real_out, file_path)}${source.slice(offset)}`
	}
}

export { SOURCE_LOCATION_DEFINE, source_location }
