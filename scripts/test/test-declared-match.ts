import { test_type_logic, type TestType } from './test-type-logic'

// The Step 0 declaration lines checked against the tests actually in the working-tree change set
// (joshuafolkken/kit#2181). `CLAUDE.md` Step 0 fixes the shape of each line —
// `<what changes> — Test: <Unit|E2E> — <path> — <what it verifies>` — and `testing-guide.md` §0 asks
// that the count of declared tests match the count added, yet nothing read the correspondence. This
// reads it: for every declaration, whether the declared type matches the path, whether the path was
// really changed, and whether a colocated test of that type is in the diff.

// The em-dash separator the declaration line is written with — space, em-dash, space.
const FIELD_SEPARATOR = ' — '
const TEST_MARKER = 'Test:'
const TYPES: ReadonlyArray<TestType> = [test_type_logic.UNIT, test_type_logic.E2E]

type MatchStatus = 'match' | 'type-mismatch' | 'path-missing' | 'test-not-created'

interface Declaration {
	declared_type: TestType
	path: string
}

interface MatchResult extends Declaration {
	status: MatchStatus
}

// The directory a path lives in, kept with its trailing slash so a same-directory test compares equal.
// A path with no slash lives at the root, whose directory is the empty string.
function directory_of(path: string): string {
	const slash = path.lastIndexOf('/')

	return slash === -1 ? '' : path.slice(0, slash + 1)
}

// The declared type named after `Test:` in a field, or undefined when the field is not a `Test:` field
// or names neither type.
function type_in_field(field: string): TestType | undefined {
	const trimmed = field.trim()
	if (!trimmed.startsWith(TEST_MARKER)) return undefined

	const value = trimmed.slice(TEST_MARKER.length).trim()

	return TYPES.find((type) => type === value)
}

// One declaration parsed from a summary line, or undefined when the line carries no `Test:` field with
// a recognized type and a path after it.
function parse_line(line: string): Declaration | undefined {
	const fields = line.split(FIELD_SEPARATOR)
	const marker = fields.findIndex((field) => type_in_field(field) !== undefined)
	const marker_field = fields[marker]
	const path_field = fields[marker + 1]
	if (marker_field === undefined || path_field === undefined) return undefined

	const declared_type = type_in_field(marker_field)
	if (declared_type === undefined) return undefined

	return { declared_type, path: path_field.trim() }
}

function parse_declarations(summary: string): ReadonlyArray<Declaration> {
	return summary
		.split('\n')
		.map((line) => parse_line(line))
		.filter((declaration): declaration is Declaration => declaration !== undefined)
}

const SUFFIX_FOR: Record<TestType, string> = {
	Unit: '.test.ts',
	E2E: '.e2e.ts',
}

// A changed test file of the declared type sits in the same directory as the declared path — an equal
// directory, so a test one level down does not count as beside it.
function has_colocated_test(declaration: Declaration, changed: ReadonlyArray<string>): boolean {
	const directory = directory_of(declaration.path)
	const suffix = SUFFIX_FOR[declaration.declared_type]

	return changed.some((path) => directory_of(path) === directory && path.endsWith(suffix))
}

function status_for(declaration: Declaration, changed: ReadonlyArray<string>): MatchStatus {
	if (!changed.includes(declaration.path)) return 'path-missing'

	if (test_type_logic.test_type_for(declaration.path) !== declaration.declared_type) {
		return 'type-mismatch'
	}

	if (!has_colocated_test(declaration, changed)) return 'test-not-created'

	return 'match'
}

// The status of every declaration in the summary against the change set, so the caller can print each
// mismatch. The whole change set is passed through — the declared path is matched against it directly,
// and `has_colocated_test` reads the test files in it.
function match_report(summary: string, changed: ReadonlyArray<string>): ReadonlyArray<MatchResult> {
	return parse_declarations(summary).map((declaration) => ({
		...declaration,
		status: status_for(declaration, changed),
	}))
}

const test_declared_match = { directory_of, match_report, parse_declarations }

export type { Declaration, MatchResult, MatchStatus }
export { test_declared_match }
