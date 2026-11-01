// **A change to the josh command registry always runs the registry's own tests** (joshuafolkken/kit#5642):
// a command-table file reaches hundreds of tests, so the cap (`test-related-cap.ts`) and the touched scope
// (`test-related-touched.ts`) both drop `josh-logic.test.ts`'s ALIASES and the command-map checks, and a
// command added without an alias first failed in CI. The pin adds them back, and followup's unrelated-failure
// verdict (`followup-failed-tests.ts`) counts a pinned test's failure as the change's own.

const REGISTRY_TESTS: ReadonlyArray<string> = [
	'scripts/josh/josh-logic.test.ts',
	'scripts/josh/josh-command-map.test.ts',
]
const REGISTRY_SOURCE =
	/^scripts\/josh\/(?:josh-commands-[\w-]+|josh-aliases|josh-command-map)\.ts$/u

// `file` is repository-root-relative, as the change was read.
function is_registry_source(file: string): boolean {
	return REGISTRY_SOURCE.test(file)
}

// The tests a change pins into its related set: the registry tests when it touches the registry.
function pinned_tests(changed: Iterable<string>): Array<string> {
	return [...changed].some((file) => is_registry_source(file)) ? [...REGISTRY_TESTS] : []
}

function with_pins(file: string, tests: ReadonlyArray<string>): Array<string> {
	return [...new Set([...tests, ...pinned_tests([file])])]
}

const test_related_pins = { REGISTRY_TESTS, is_registry_source, pinned_tests, with_pins }

export { test_related_pins }
