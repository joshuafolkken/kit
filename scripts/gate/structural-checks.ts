import { project_checks } from '#scripts/gate/project-checks'
import type { ChangedFileScope } from '#scripts/git/changed-file-scope'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'

// The guard tests that judge source text alone, yet run only in `josh test:related` or a detached
// ship's pre-detach stop: a bare Issue citation, a source with no colocated test and a `gh` spawn
// outside `gh api` (the static half of the network guard; the calls a test *makes* are observed by
// `test-network-guard.ts`, which only a run can answer). `josh lint:related` runs them beside its
// lint, so a between-edits loop meets them in seconds rather than at the ship (joshuafolkken/kit#4643).
// The targets are the pre-detach stop's too, so the two never drift.
//
// `josh exports:unused` stays out: its whole-program type-checker pass is several times the lint's
// own wall clock.
//
// They run in kit alone: the guard tests are kit's own, and a consumer meets the pre-detach static
// checks there. A change with no `.ts` file in it moves none of their verdicts.

// A present directory need not hold a test the project's Vitest includes — a consumer's own
// `scripts/claude` of shell helpers, say — and a filter that matches nothing would stop every ship.
const GUARD_TEST_COMMAND: ReadonlyArray<string> = ['josh', 'test:unit', '--passWithNoTests']
const STRUCTURAL_GUARD_TARGETS: ReadonlyArray<string> = [
	'scripts/issue/session-cite-scan.test.ts',
	'tools/test/untested-sources.test.ts',
	'tools/gh/gh-subcommand-guard.test.ts',
]
const STRUCTURAL_LISTS: ReadonlyArray<ReadonlyArray<string>> = [
	[...GUARD_TEST_COMMAND, ...STRUCTURAL_GUARD_TARGETS],
]
const TYPESCRIPT_SUFFIX = '.ts'
const FAILURE_EXIT_CODE = 1

interface StructuralRun {
	list: ReadonlyArray<string>
	result: BufferedProcessResult
}

// The front of a failed check's heading — `josh lane:value metrics-stops` counts a ship output that
// carries the metrics totals' one.
function failure_prefix(list: ReadonlyArray<string>): string {
	return `✗ ${list.join(' ')} — `
}

// Each failure is headed by the check's own command and how it ended: a check that failed with no
// output of its own (`ELIFECYCLE Command failed` alone, or nothing) otherwise names nothing to fix.
function failure_heading(list: ReadonlyArray<string>, result: BufferedProcessResult): string {
	const ending =
		result.exit_code === undefined
			? 'no exit code (timed out or ended by a signal)'
			: `exit code ${String(result.exit_code)}`

	return `${failure_prefix(list)}${ending}`
}

function failure_section(list: ReadonlyArray<string>, result: BufferedProcessResult): string {
	const parts = [failure_heading(list, result), result.output.trim()]

	return parts.filter((part) => part !== '').join('\n')
}

// The whole-tree fallback is due as the narrowed run with a source in it is; both stay kit-only.
function is_due(scope: ChangedFileScope, root: string): boolean {
	if (!project_checks.is_kit_repository(root)) return false

	return scope.mode === 'all' || scope.files.some((file) => file.endsWith(TYPESCRIPT_SUFFIX))
}

async function run_in(root: string, list: ReadonlyArray<string>): Promise<StructuralRun> {
	return { list, result: await buffered_process.run_buffered_process(list, { cwd: root }) }
}

// All at once and buffered, every failure reported, so one run shows all there is to fix.
async function run_structural(scope: ChangedFileScope, root: string): Promise<number> {
	if (!is_due(scope, root)) return 0

	const runs = await Promise.all(STRUCTURAL_LISTS.map(async (list) => await run_in(root, list)))
	const failed = runs.filter(({ result }) => buffered_process.is_process_failed(result))

	if (failed.length === 0) return 0

	const sections = failed.map(({ list, result }) => failure_section(list, result))

	process.stdout.write(`\n${sections.join('\n\n')}\n`)

	return FAILURE_EXIT_CODE
}

const structural_checks = {
	GUARD_TEST_COMMAND,
	STRUCTURAL_GUARD_TARGETS,
	failure_prefix,
	failure_section,
	run_structural,
}

export { structural_checks }
