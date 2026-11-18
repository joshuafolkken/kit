import path from 'node:path'
import { direct_importers, type SourceReader } from './direct-importers'
import { test_declared_logic } from './test-declared-logic'
import { test_read_map } from './test-read-map'

// **The test files that name a changed document's path, read off their text** (joshuafolkken/kit#7978).
// The test-read map answers only for the reads its last whole-suite run saw, so a test added since, or
// one whose reading changed, is missing from it. A test that writes the document's path — itself, or in
// a module it imports directly, such as a `*-fixture.ts` helper — is found here without the map; a test
// reading documents through a listing or an assembled path still needs the map, so the run takes the
// readers of both (`test-related-scope.ts`). A comment naming a document reads nothing, so comment
// lines are left out of the search.

const CODE_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'])
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/u

interface SearchContext {
	reader: SourceReader
	// Each code file of the work tree under its module key, so an import names the file it reads.
	modules: ReadonlyMap<string, string>
	// The test files the read map recorded reading anything — the map answers for those exactly.
	recorded: ReadonlySet<string>
}

// A test's code text, and that of the work-tree modules it imports directly.
interface TestText {
	test: string
	own: string
	helpers: string
}

function module_index(files: ReadonlyArray<string>): Map<string, string> {
	const code = files.filter((file) => CODE_EXTENSIONS.has(path.posix.extname(file)))

	return new Map(code.map((file) => [direct_importers.module_key(file), file]))
}

function code_of(source = ''): string {
	return source
		.split('\n')
		.filter((line) => !COMMENT_LINE.test(line))
		.join('\n')
}

function text_of(test: string, context: SearchContext): TestText {
	const { reader, modules } = context
	const source = reader.read_source(test)
	const helpers = direct_importers
		.specifiers_of(source ?? '')
		.map((specifier) => direct_importers.resolve_specifier(specifier, test, reader.imports))
		.map((key = '') => modules.get(key))
		.filter((file) => file !== undefined)
	const helper_code = helpers.map((file) => code_of(reader.read_source(file)))

	return { test, own: code_of(source), helpers: helper_code.join('\n') }
}

// **A helper's naming counts only for a test the map has not recorded** — the map answers exactly for
// one it has, and a fixture shared by many tests would otherwise select every test importing it.
function is_reader(text: TestText, document: string, recorded: ReadonlySet<string>): boolean {
	if (text.own.includes(document)) return true

	return !recorded.has(text.test) && text.helpers.includes(document)
}

function posix_of(file: string): string {
	return file.split(path.sep).join(path.posix.sep)
}

function recorded_tests(root: string): Set<string> {
	const map = test_read_map.read_map(root)
	const tests = map === undefined ? [] : Object.values(map.readers).flat()

	return new Set(tests.map((file) => posix_of(file)))
}

function readers_among(
	texts: ReadonlyArray<TestText>,
	document: string,
	recorded: ReadonlySet<string>,
): Array<string> {
	return texts.filter((text) => is_reader(text, document, recorded)).map((text) => text.test)
}

// For each of `documents` (repository-relative), the test files of the work tree at `root` naming it;
// a document no test names maps to none.
async function readers_of(
	root: string,
	documents: ReadonlyArray<string>,
): Promise<Map<string, Array<string>>> {
	if (documents.length === 0) return new Map()

	const files = await direct_importers.work_tree_files(root)
	const reader = direct_importers.source_reader(root)
	const context = { reader, modules: module_index(files), recorded: recorded_tests(root) }
	const tests = files.filter((file) => test_declared_logic.is_test_file(file))
	const texts = tests.map((test) => text_of(test, context))

	return new Map(
		documents.map((document) => [
			document,
			readers_among(texts, posix_of(document), context.recorded),
		]),
	)
}

const test_document_readers = { readers_of }

export { test_document_readers }
