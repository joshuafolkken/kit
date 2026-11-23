// **The one table of tests a change reaches without importing them** (joshuafolkken/kit#5642,
// joshuafolkken/kit#8861): the touched scope (`test-related-touched.ts`) reads no import graph, and the cap
// (`test-related-cap.ts`) cuts a hub's reach, so a test that reads a derived artifact, a command table's
// scripts off `COMMAND_MAP`, or a whole source tree first failed at `check:related` or in CI. Each row names
// the changed-path shapes that reach its tests, read off the inputs the tests read. The touched scope, the
// full selection (`test-related-select.ts`) and followup's unrelated-failure verdict
// (`followup-failed-tests.ts`) all read this table, so a pinned test's failure counts as the change's own.
//
// A row's shapes approximate its tests' inputs from the path alone: `build-hooks.test.ts` bundles its entry
// points' transitive imports, and only the hook sources themselves are pinned to it — the full
// `check:related` still runs it through the import graph.

interface PinRow {
	readonly sources: ReadonlyArray<RegExp>
	readonly tests: ReadonlyArray<string>
}

// A source file, never a test or `.d.ts`: `[\w-]+` stops at the first dot.
const SCRIPTS_SOURCE = /^scripts\/(?:[\w-]+\/)*[\w-]+\.ts$/u
const TREE_SOURCE = /^(?:scripts|tools)\/(?:[\w-]+\/)*[\w-]+\.ts$/u
const REGISTRY_SOURCE =
	/^scripts\/josh\/(?:josh-commands-[\w-]+|josh-aliases|josh-command-map)\.ts$/u

// The registry tests: `josh-logic.test.ts`'s ALIASES, the command-map checks, and the in-process main-guard
// test, which reads every table's scripts off `COMMAND_MAP` (joshuafolkken/kit#7314).
const REGISTRY_TESTS: ReadonlyArray<string> = [
	'scripts/josh/josh-logic.test.ts',
	'scripts/josh/josh-command-map.test.ts',
	'scripts/josh/josh-in-process.test.ts',
]

const PIN_ROWS: ReadonlyArray<PinRow> = [
	{ sources: [REGISTRY_SOURCE], tests: REGISTRY_TESTS },
	// The catalog, usage blocks and lint prose `command:derive` writes, so a stale page fails here.
	{
		sources: [
			REGISTRY_SOURCE,
			/^tools\/document\/[\w-]+\.ts$/u,
			/^eslint\/rules\/(?:code-quality|english-only-prose|sonarjs)\.js$/u,
			/^(?:CLAUDE|prompts\/coding-standards|prompts\/refactoring|docs\/josh-command[\w-]*)\.md$/u,
		],
		tests: ['tools/document/command-derive.test.ts'],
	},
	// Every script `COMMAND_MAP` names, and the pages that list the commands loading `.env` themselves.
	{
		sources: [
			SCRIPTS_SOURCE,
			/^(?:docs\/environment-variables|docs\/cli|prompts\/testing-guide)\.md$/u,
			/^\.claude\/skills\/(?:workflow-commands\/[\w-]+|epic-commands\/SKILL)\.md$/u,
		],
		tests: ['scripts/document/environment-file-reference.test.ts'],
	},
	// The import graph of all of `scripts/`, walked from each command's script to the Telegram notifier.
	{ sources: [SCRIPTS_SOURCE], tests: ['scripts/josh/josh-command-telegram-environment.test.ts'] },
	// The scan of `scripts/` and `tools/` for a source with no colocated test.
	{ sources: [TREE_SOURCE], tests: ['tools/test/untested-sources.test.ts'] },
	// The hook bundles (`HOOK_BUNDLES` in `build-hooks.ts`): a real esbuild, so only the hook sources reach it.
	{
		sources: [
			/^(?:scripts|tools)\/hooks\/[\w-]+\.ts$/u,
			/^scripts\/build\/build-hooks\.ts$/u,
			/^scripts\/(?:josh\/session-language-main|security\/security-audit-provision-main)\.ts$/u,
		],
		tests: ['scripts/build/build-hooks.test.ts'],
	},
]

// `file` is repository-root-relative, as the change was read. The command registry alone, which lists every
// command's name (`split-direction.ts`).
function is_registry_source(file: string): boolean {
	return REGISTRY_SOURCE.test(file)
}

function reaches(row: PinRow, files: ReadonlyArray<string>): boolean {
	return files.some((file) => row.sources.some((source) => source.test(file)))
}

// The tests a change pins into its related set, in table order, each once.
function pinned_tests(changed: Iterable<string>): Array<string> {
	const files = [...changed]

	return [...new Set(PIN_ROWS.filter((row) => reaches(row, files)).flatMap((row) => row.tests))]
}

function with_pins(file: string, tests: ReadonlyArray<string>): Array<string> {
	return [...new Set([...tests, ...pinned_tests([file])])]
}

const test_related_pins = { PIN_ROWS, REGISTRY_TESTS, is_registry_source, pinned_tests, with_pins }

export type { PinRow }
export { test_related_pins }
