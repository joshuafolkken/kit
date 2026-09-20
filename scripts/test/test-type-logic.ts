// The test type a changed path calls for — `Unit` or `E2E` — decided from the path alone
// (joshuafolkken/kit#2181).
//
// **This mechanizes `prompts/testing-guide.md` §1's two-row table**, whose last line used to be "When
// ambiguous, ask the user" — a Tier B stop on a question the path already answers. The table routes
// `src/routes/` pages and interactive UI to E2E and everything else (utilities, `src/lib/server/`,
// display-only components) to Unit. The mechanically certain half of that is location: a change under
// `src/routes/` is a page whose behavior is observed through the browser, so it takes E2E; every other
// runtime path is exercised by a colocated unit test. A component with interaction is reached through
// the route that renders it, and that route is under `src/routes/` — so the location rule covers it
// without reading the file.

type TestType = 'Unit' | 'E2E'

const UNIT: TestType = 'Unit'
const E2E: TestType = 'E2E'

// The paths whose changes are observed through the browser, so their test is an E2E spec. Everything
// else is a utility, a server module or a display-only component — all Unit.
const E2E_PREFIXES: ReadonlyArray<string> = ['src/routes/']

function test_type_for(path: string): TestType {
	const normalized = path.trim()

	return E2E_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ? E2E : UNIT
}

const test_type_logic = { E2E, E2E_PREFIXES, UNIT, test_type_for }

export type { TestType }
export { test_type_logic }
