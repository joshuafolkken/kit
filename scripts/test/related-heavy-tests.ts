import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { RelatedScope } from './test-related-scope'
import { unit_durations, type Durations } from './unit-durations'
import { vitest_cli_excludes } from './vitest-cli-excludes'

// **A scoped run leaves out the heavy test files a change reaches only indirectly**
// (joshuafolkken/kit#5105). A hub module's change reaches the integration tests importing it through
// the shared harnesses, and a scoped run's wall clock is bounded below by its longest file — 18 to 49
// seconds each — whatever else it narrows. A heavy file still runs when this change moved it or a file
// it imports directly, so the test written for a module is never left out with it.
//
// "Heavy" is read off the CI shards' duration record (`unit-durations.json`), never a named list, so
// a file that slows down or speeds up moves in or out on the record's next refresh. The whole-suite
// fallback and every CI shard carry no exclusion, so a heavy file left out here still runs before the
// merge.

const HEAVY_TEST_MS = 10_000
const { EXCLUDE_FLAG } = vitest_cli_excludes
const PACKAGE_FILE = 'package.json'
const WILDCARD = '*'
const CURRENT_DIRECTORY_PREFIX = './'

// The module specifiers a source names in a static or dynamic import, an export-from or a `vi.mock`.
const SPECIFIER_PATTERN = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bmock\(\s*)["']([^"']+)["']/gu

type ImportMap = Readonly<Record<string, string>>

interface HeavyReader {
	durations: Durations
	imports: ImportMap
	read_source: (file: string) => string | undefined
}

// Repository-relative, `/`-separated and without its extension — the one key a specifier and a changed
// file are compared by, since an import names `./thing`, `./thing.ts` or `./thing.js` alike.
function module_key(file: string): string {
	const posix = file.split(path.sep).join(path.posix.sep)

	return posix.slice(0, posix.length - path.posix.extname(posix).length)
}

function heavy_tests(durations: Durations): Array<string> {
	return Object.keys(durations).filter((file) => (durations[file] ?? 0) > HEAVY_TEST_MS)
}

function specifiers_of(source: string): Array<string> {
	return [...source.matchAll(SPECIFIER_PATTERN)].flatMap((match) => match.slice(1))
}

function alias_target(specifier: string, imports: ImportMap): string | undefined {
	const exact = imports[specifier]

	if (exact !== undefined) return exact

	const key = Object.keys(imports).find(
		(pattern) => pattern.endsWith(WILDCARD) && specifier.startsWith(pattern.slice(0, -1)),
	)

	if (key === undefined) return undefined

	return imports[key]?.split(WILDCARD).join(specifier.slice(key.length - 1))
}

function relative_target(specifier: string, from: string): string {
	return path.posix.join(path.posix.dirname(from), specifier)
}

// The repository-relative module key a specifier names, or `undefined` for a package import.
function resolve_specifier(
	specifier: string,
	from: string,
	imports: ImportMap,
): string | undefined {
	if (specifier.startsWith('.')) return module_key(relative_target(specifier, from))

	const target = alias_target(specifier, imports)

	if (target === undefined) return undefined

	return module_key(path.posix.normalize(target.replace(CURRENT_DIRECTORY_PREFIX, '')))
}

function imports_directly(file: string, scoped: ReadonlySet<string>, reader: HeavyReader): boolean {
	const source = reader.read_source(file)

	if (source === undefined) return true

	return specifiers_of(source).some((specifier) => {
		const resolved = resolve_specifier(specifier, file, reader.imports)

		return resolved !== undefined && scoped.has(resolved)
	})
}

// The heavy files to leave out of a scoped run: every one this scope neither holds nor imports from.
function excluded_tests(scoped_files: ReadonlyArray<string>, reader: HeavyReader): Array<string> {
	const scoped = new Set(scoped_files.map((file) => module_key(file)))

	return heavy_tests(reader.durations).filter(
		(file) => !scoped.has(module_key(file)) && !imports_directly(file, scoped, reader),
	)
}

function read_imports(root: string): ImportMap {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(root, PACKAGE_FILE), 'utf8'))
		const imports: unknown = Reflect.get(new Object(parsed), 'imports')

		return typeof imports === 'object' && imports !== null
			? Object.fromEntries(Object.entries(imports))
			: {}
	} catch {
		return {}
	}
}

function read_source_at(root: string, file: string): string | undefined {
	try {
		return readFileSync(path.join(root, file), 'utf8')
	} catch {
		return undefined
	}
}

function file_reader(root: string): HeavyReader {
	return {
		durations: unit_durations.read(root),
		imports: read_imports(root),
		read_source: (file) => read_source_at(root, file),
	}
}

// The `--exclude` flags a scope's vitest run carries: none unless it narrowed to related files.
function exclude_flags(
	scope: RelatedScope,
	root: string,
	reader: HeavyReader = file_reader(root),
): Array<string> {
	if (scope.mode !== 'related') return []

	const scoped = scope.files.map((file) => path.relative(root, file))

	return excluded_tests(scoped, reader).flatMap((file) => [EXCLUDE_FLAG, file])
}

const related_heavy_tests = {
	EXCLUDE_FLAG,
	HEAVY_TEST_MS,
	exclude_flags,
	heavy_tests,
	resolve_specifier,
	specifiers_of,
}

export type { HeavyReader, ImportMap }
export { related_heavy_tests }
