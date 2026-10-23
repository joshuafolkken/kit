import { existsSync } from 'node:fs'
import path from 'node:path'
import { check_reuse, type CheckRecords } from '#scripts/gate/check-reuse'
import { gate_plan } from '#scripts/gate/gate-plan'
import type { GateStepResult } from '#scripts/gate/gate-report'
import { gate_tree } from '#scripts/gate/gate-tree'
import { metrics_totals } from '#scripts/gate/metrics-totals'
import { project_checks } from '#scripts/gate/project-checks'
import { type_check_step } from '#scripts/gate/type-check-step'
import type { JoshResult } from '#scripts/josh/josh-run'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'

// The fast checks a detached `josh ship` runs in the agent's own turn, after the preflight (whatever it
// answered) and before the hand-off:a type error in a file the related-only checks never touched, an export nothing reads,
// an unknown word, or a guard test (a SKILL.md pointer, a byte budget, the command list, a source with
// no colocated test, a bare issue citation) that only the full suite runs, would otherwise first
// surface after the detach and cost a relaunched session. They answer in seconds, so the same session
// fixes what they find and ships again.
//
// **Nothing moves out of the gate, and the gate reuses what these already answered**: a check that is
// the gate's own check passed silently here is recorded with the gate's per-check record
// (`check-reuse.ts`), so the supervised gate stage reuses it while its declared inputs have not moved
// and runs it again when they have. The record, its judgment and its inputs are the gate's; only the
// type check (`check`) and `exports:unused` (`exports`) carry a gate label. The rest stay unrecorded:
// `cspell:dot` declares no inputs and runs every gate (`verification-inputs.ts`), the guard tests are a
// slice of the unit suite and do not answer for the gate's `test:unit`, and the metrics totals leave
// out the durations the gate's `metrics` holds.
//
// joshuafolkken/kit#3924: nine of ten ship gate stops were `exports:unused`, `cspell:dot` or a
// repository-wide guard test failing on the child's own code — none a check `test:related` selects,
// since a guard test imports no changed file.
//
// The test targets are where such failures land. A consumer has none of them, so only the ones
// present run, and a consumer meets the static checks alone.
//
// In kit the metrics ratchet's totals join them: a feature grows a total almost every time, and here
// the session that grew the total writes the reason itself rather than a relaunched one —
// `josh lint:related` has already reported the growth in the loop (`metrics-totals.ts`), so this is
// the stop for a growth that notice did not settle. The
// durations are left out: they read the gate ledger, stale before the detach, so they stay with the
// supervised gate.

interface PreDetachCheck {
	list: ReadonlyArray<string>
	// The gate check this one answers for, absent where it answers for none.
	label?: string | undefined
}

interface PreDetachRun {
	check: PreDetachCheck
	result: BufferedProcessResult
	elapsed_ms: number
}

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const SECTION_SEPARATOR = '\n\n'
const PASSED = 'pre-detach checks passed'
const { METRICS_TOTALS_COMMAND } = metrics_totals
const STATIC_CHECKS: ReadonlyArray<PreDetachCheck> = [
	{ list: ['josh', 'exports:unused'], label: gate_plan.EXPORTS_LABEL },
	{ list: ['josh', 'cspell:dot'] },
]
const GUARD_TEST_TARGETS: ReadonlyArray<string> = [
	'scripts/document',
	'scripts/claude',
	'scripts/rules',
	'scripts/josh/josh-command-map.test.ts',
	'scripts/issue/session-cite-scan.test.ts',
	'tools/test/untested-sources.test.ts',
	'tools/test/pure-files.test.ts',
]
// A present directory need not hold a test the project's Vitest includes — a consumer's own
// `scripts/claude` of shell helpers, say — and a filter that matches nothing would stop every ship.
const GUARD_TEST_COMMAND: ReadonlyArray<string> = ['josh', 'test:unit', '--passWithNoTests']

function present_targets(directory: string): ReadonlyArray<string> {
	return GUARD_TEST_TARGETS.filter((target) => existsSync(path.join(directory, target)))
}

function guard_tests(directory: string): Array<PreDetachCheck> {
	const targets = present_targets(directory)

	return targets.length === 0 ? [] : [{ list: [...GUARD_TEST_COMMAND, ...targets] }]
}

// The same kit-only rule as the gate's `is_kit_only` step: a consumer's kit has no `josh metrics`.
function kit_only(directory: string): Array<PreDetachCheck> {
	return project_checks.is_kit_repository(directory) ? [{ list: METRICS_TOTALS_COMMAND }] : []
}

async function command_lists(directory: string): Promise<Array<PreDetachCheck>> {
	const type_check = await type_check_step.resolve_type_check_args(directory)

	return [
		{ list: type_check, label: gate_plan.TYPE_CHECK_LABEL },
		...STATIC_CHECKS,
		...guard_tests(directory),
		...kit_only(directory),
	]
}

async function run_in(directory: string, check: PreDetachCheck): Promise<PreDetachRun> {
	const started = performance.now()
	const result = await buffered_process.run_buffered_process(check.list, { cwd: directory })

	return { check, result, elapsed_ms: performance.now() - started }
}

interface GateRun extends PreDetachRun {
	check: { list: ReadonlyArray<string>; label: string }
}

function is_gate_run(run: PreDetachRun): run is GateRun {
	return run.check.label !== undefined
}

function gate_results(runs: ReadonlyArray<PreDetachRun>): Array<GateStepResult> {
	return runs
		.filter((run) => is_gate_run(run))
		.map(({ check, result, elapsed_ms }) => {
			return { ...result, label: check.label, command: check.list.join(' '), elapsed_ms }
		})
}

// Each failure is headed by the check's own command and how it ended: a check that failed with no
// output of its own (`ELIFECYCLE Command failed` alone, or nothing) otherwise names nothing to fix.
function failure_heading({ check, result }: PreDetachRun): string {
	const ending =
		result.exit_code === undefined
			? 'no exit code (timed out or ended by a signal)'
			: `exit code ${String(result.exit_code)}`

	return `✗ ${check.list.join(' ')} — ${ending}`
}

function failure_section(run: PreDetachRun): string {
	return [failure_heading(run), run.result.output.trim()].filter((part) => part !== '').join('\n')
}

function verdict(runs: ReadonlyArray<PreDetachRun>): JoshResult {
	const failed = runs.filter(({ result }) => buffered_process.is_process_failed(result))

	if (failed.length === 0) return { code: SUCCESS_EXIT_CODE, out: PASSED }

	return {
		code: FAILURE_EXIT_CODE,
		out: failed.map((run) => failure_section(run)).join(SECTION_SEPARATOR),
	}
}

// All run at once, buffered, and every failure is reported, so one ship shows all there is to fix.
// The tree is read before they start, so a record is written only for the tree they read.
async function checks(
	directory: string = process.cwd(),
	records: CheckRecords = check_reuse.DEFAULT_RECORDS,
): Promise<JoshResult> {
	const [lists, tree] = await Promise.all([command_lists(directory), gate_tree.read_gate_tree()])
	const runs = await Promise.all(lists.map(async (check) => await run_in(directory, check)))

	await check_reuse.record_green_checks(gate_results(runs), tree, records)

	return verdict(runs)
}

const run_ship_pre_detach = {
	GUARD_TEST_TARGETS,
	METRICS_TOTALS_COMMAND,
	PASSED,
	STATIC_CHECKS,
	checks,
}

export type { PreDetachCheck }
export { run_ship_pre_detach }
