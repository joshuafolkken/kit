import { direct_importers, type SourceReader } from './direct-importers'

// **The tests a new import can break without importing the changed file directly are the ones that
// mock a module** (joshuafolkken/kit#7924, #7453): a partial `vi.mock` factory throws once a newly
// loaded module asks it for an export it never returned. A test that mocks nothing loads the new module
// as its own tests do. A test counts as mocking when its text calls `vi.mock` / `vi.doMock`, or when a
// module it imports directly does (a fixture registering its mocks). The setup files' mocks spread the
// original module, so they leave no export missing.

const MOCK_PATTERN = /\bvi\s*\.\s*(?:mock|doMock)\s*\(/u
const SOURCE_EXTENSION = '.ts'

function is_mocking_source(source: string | undefined): boolean {
	return source !== undefined && MOCK_PATTERN.test(source)
}

// The module keys `source`, the text of the test `from`, imports directly — none for a package.
function imported_keys(source: string, from: string, reader: SourceReader): Array<string> {
	const { resolve_specifier, specifiers_of } = direct_importers

	return specifiers_of(source).flatMap(
		(specifier) => resolve_specifier(specifier, from, reader.imports) ?? [],
	)
}

function is_mocking_import(source: string, test: string, reader: SourceReader): boolean {
	return imported_keys(source, test, reader).some((key) =>
		is_mocking_source(reader.read_source(`${key}${SOURCE_EXTENSION}`)),
	)
}

// An unreadable test mocks nothing.
function is_mocking_test(test: string, reader: SourceReader): boolean {
	const source = reader.read_source(test)
	if (source === undefined) return false

	return is_mocking_source(source) || is_mocking_import(source, test, reader)
}

// The tests of `tests`, repository-relative to `root`, that mock a module.
function mocking_tests(root: string, tests: ReadonlyArray<string>): Array<string> {
	const reader = direct_importers.source_reader(root)

	return tests.filter((test) => is_mocking_test(test, reader))
}

const test_related_mocking = { mocking_tests }

export { test_related_mocking }
