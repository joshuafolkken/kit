import { existsSync } from 'node:fs'
import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { type_check_step } from '#scripts/gate/type-check-step'
import type { JoshResult } from '#scripts/josh/josh-run'
import { buffered_process, type BufferedProcessResult } from '#scripts/lib/buffered-process'

// The fast checks a detached `josh ship` runs in the agent's own turn, after the preflight and before
// the hand-off: a type error in a file the related-only checks never touched, or a document test (a
// SKILL.md pointer, a byte budget, the command list) that only the full suite runs, would otherwise
// first surface after the detach and cost a relaunched session. These two answer in seconds, so the
// same session fixes what they find and ships again. **Nothing moves out of the gate**: the
// supervised gate stage still runs every check, these included.
//
// The test targets are the directories such failures land in. A consumer has none of them, so only
// the ones present run, and a consumer meets the type check alone.
//
// In kit the metrics ratchet's totals join them: a feature grows a total almost every time, and here
// the session that grew the total writes the reason itself rather than a relaunched one. The
// durations are left out: they read the gate ledger, stale before the detach, so they stay with the
// supervised gate.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const SECTION_SEPARATOR = '\n\n'
const PASSED = 'pre-detach checks passed'
const METRICS_TOTALS_COMMAND: ReadonlyArray<string> = ['josh', 'metrics', '--totals-only']
const DOCUMENT_TEST_TARGETS: ReadonlyArray<string> = [
	'scripts/document',
	'scripts/claude',
	'scripts/rules',
	'scripts/josh/josh-command-map.test.ts',
]
// A present directory need not hold a test the project's Vitest includes — a consumer's own
// `scripts/claude` of shell helpers, say — and a filter that matches nothing would stop every ship.
const DOCUMENT_TEST_COMMAND: ReadonlyArray<string> = ['josh', 'test:unit', '--passWithNoTests']

function present_targets(directory: string): ReadonlyArray<string> {
	return DOCUMENT_TEST_TARGETS.filter((target) => existsSync(path.join(directory, target)))
}

function document_tests(directory: string): Array<ReadonlyArray<string>> {
	const targets = present_targets(directory)

	return targets.length === 0 ? [] : [[...DOCUMENT_TEST_COMMAND, ...targets]]
}

// The same kit-only rule as the gate's `is_kit_only` step: a consumer's kit has no `josh metrics`.
function kit_only(directory: string): Array<ReadonlyArray<string>> {
	return project_checks.is_kit_repository(directory) ? [METRICS_TOTALS_COMMAND] : []
}

async function command_lists(directory: string): Promise<Array<ReadonlyArray<string>>> {
	const type_check = await type_check_step.resolve_type_check_args(directory)

	return [type_check, ...document_tests(directory), ...kit_only(directory)]
}

async function run_in(
	directory: string,
	list: ReadonlyArray<string>,
): Promise<BufferedProcessResult> {
	return await buffered_process.run_buffered_process(list, { cwd: directory })
}

// Both run at once, buffered, and every failure is reported, so one ship shows all there is to fix.
async function checks(directory: string = process.cwd()): Promise<JoshResult> {
	const lists = await command_lists(directory)
	const results = await Promise.all(lists.map(async (list) => await run_in(directory, list)))
	const failed = results.filter((result) => buffered_process.is_process_failed(result))

	if (failed.length === 0) return { code: SUCCESS_EXIT_CODE, out: PASSED }

	return {
		code: FAILURE_EXIT_CODE,
		out: failed.map((result) => result.output.trim()).join(SECTION_SEPARATOR),
	}
}

const run_ship_pre_detach = { DOCUMENT_TEST_TARGETS, METRICS_TOTALS_COMMAND, PASSED, checks }

export { run_ship_pre_detach }
