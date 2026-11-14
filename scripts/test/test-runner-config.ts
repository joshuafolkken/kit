import path from 'node:path'

// The test runner's configuration files (joshuafolkken/kit#7521): which tests a run collects is theirs
// to decide (`include`, projects), so a change to one can make a test run that never ran before. A
// leaf module, so `verification-inputs.ts` and `josh test:pinned`'s verdict cache share the names.

// A file name starting with one of these configures vitest.
const PREFIXES: ReadonlyArray<string> = ['vitest.config.', 'vite.config.']

// A configuration vitest reads from the repository root; one nested deeper is a fixture or a package's own.
function is_config(relative: string): boolean {
	if (path.dirname(relative) !== '.') return false

	return PREFIXES.some((prefix) => relative.startsWith(prefix))
}

const test_runner_config = { is_config, PREFIXES }

export { test_runner_config }
