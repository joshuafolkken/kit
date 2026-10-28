import { readFileSync } from 'node:fs'
import path from 'node:path'
import { git_spawn } from '#scripts/git/git-spawn'
import { test_declared_logic } from './test-declared-logic'
import { whole_suite_files } from './whole-suite-files'

// **The test files that import a module directly, read off their text** (joshuafolkken/kit#5122). A
// file every test imports (`whole_suite_files.EVERY_TEST_IMPORTS`) sends `vitest related` to the whole
// suite, so `josh test:related` and the `josh test:pinned` probe hand vitest the test files importing it
// directly instead. The whole suite still runs once, in the gate's `test:unit` and in every CI shard.
//
// The same reading decides which heavy test files a scoped run keeps (`related-heavy-tests.ts`).

const PACKAGE_FILE = 'package.json'
const WILDCARD = '*'
const CURRENT_DIRECTORY_PREFIX = './'
const NUL = '\0'

// The module specifiers a source names in a static or dynamic import, an export-from or a `vi.mock`.
const SPECIFIER_PATTERN = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bmock\(\s*)["']([^"']+)["']/gu

type ImportMap = Readonly<Record<string, string>>

interface SourceReader {
	imports: ImportMap
	read_source: (file: string) => string | undefined
}

// Repository-relative, `/`-separated and without its extension — the one key a specifier and a changed
// file are compared by, since an import names `./thing`, `./thing.ts` or `./thing.js` alike.
function module_key(file: string): string {
	const posix = file.split(path.sep).join(path.posix.sep)

	return posix.slice(0, posix.length - path.posix.extname(posix).length)
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

// Whether `source`, the text of `from`, imports one of the `scoped` module keys directly.
function names_any(
	source: string,
	from: string,
	scoped: ReadonlySet<string>,
	imports: ImportMap,
): boolean {
	return specifiers_of(source).some((specifier) => {
		const resolved = resolve_specifier(specifier, from, imports)

		return resolved !== undefined && scoped.has(resolved)
	})
}

function read_imports(root: string): ImportMap {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path.join(root, PACKAGE_FILE), 'utf8'))
		const imports: unknown = Reflect.get(new Object(parsed), 'imports')

		if (typeof imports !== 'object' || imports === null) return {}

		// A conditional entry (`{ "node": … }`) names no single file, so it resolves nothing.
		return Object.fromEntries(
			Object.entries(imports).filter(
				(entry): entry is [string, string] => typeof entry[1] === 'string',
			),
		)
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

function source_reader(root: string): SourceReader {
	return { imports: read_imports(root), read_source: (file) => read_source_at(root, file) }
}

// The test files the work tree at `root` holds, tracked or not but not ignored, repository-relative.
async function test_files(root: string): Promise<Array<string>> {
	const listed = await git_spawn.read(['-C', root, 'ls-files', '-coz', '--exclude-standard'])

	return listed.split(NUL).filter((file) => test_declared_logic.is_test_file(file))
}

// The test files of `tests` importing `file` directly; an unreadable one imports nothing.
function importers_among(
	file: string,
	tests: ReadonlyArray<string>,
	reader: SourceReader,
): Array<string> {
	const scoped = new Set([module_key(file)])

	return tests.filter((test) => {
		const source = reader.read_source(test)

		return source !== undefined && names_any(source, test, scoped, reader.imports)
	})
}

function every_test_imports_of(files: ReadonlyArray<string>): Array<string> {
	return files.filter((file) => whole_suite_files.EVERY_TEST_IMPORTS.has(path.normalize(file)))
}

// Whether a command argument, relative to the working directory or absolute, is a file every test imports.
function is_every_test_import(root: string, argument: string): boolean {
	return whole_suite_files.EVERY_TEST_IMPORTS.has(path.relative(root, path.resolve(argument)))
}

// For each of `files`, the test files in the work tree at `root` importing it directly; a file no test
// imports directly maps to none.
async function importers_of(
	root: string,
	files: ReadonlyArray<string>,
): Promise<Map<string, Array<string>>> {
	if (files.length === 0) return new Map()

	const tests = await test_files(root)
	const reader = source_reader(root)

	return new Map(files.map((file) => [file, importers_among(file, tests, reader)]))
}

// `importers_of` for the `files` every test imports; any other file is left out, for vitest to walk
// its graph.
async function every_test_importers(
	root: string,
	files: ReadonlyArray<string>,
): Promise<Map<string, Array<string>>> {
	return await importers_of(root, every_test_imports_of(files))
}

const direct_importers = {
	every_test_importers,
	every_test_imports_of,
	importers_of,
	is_every_test_import,
	module_key,
	names_any,
	resolve_specifier,
	source_reader,
	specifiers_of,
}

export type { ImportMap, SourceReader }
export { direct_importers }
