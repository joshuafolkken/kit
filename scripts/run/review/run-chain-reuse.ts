import { check_related_reuse } from '#scripts/gate/check-related-reuse'
import { check_reuse, type CheckRecords } from '#scripts/gate/check-reuse'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import type { JoshResult } from '#scripts/josh/josh-run'
import { run_ship_pre_detach } from '#scripts/run/ship/run-ship-pre-detach'

// **`run:chain`'s `exports:unused` and guard-test stages answer from their green record while none of
// their inputs moved** (joshuafolkken/kit#9139): a rerun after a fix, or a `--from` resume, ran both
// again over inputs the fix never touched. The record is the gate's per-check one (`check-reuse.ts`)
// under each stage's own label, its inputs declared in `verification-inputs.ts` — the sources for
// `exports`, every file for `guard-tests` — never a hash of the whole tree, which a fix always moves.
// Ship's pre-detach writes the same records, so a green from either end serves the other. A red or
// noisy run writes none, so it runs again.

type Runner = (argv: ReadonlyArray<string>) => Promise<JoshResult>
type TreeReader = () => Promise<GateTree>

const SUCCESS_EXIT_CODE = 0

// The record label a stage's argv answers to; `undefined` for a stage that is not reused.
function stage_label(argv: ReadonlyArray<string>, directory: string): string | undefined {
	const command = argv.join(' ')

	if (command === run_ship_pre_detach.exports_argv().join(' ')) return gate_labels.EXPORTS_LABEL
	const guard = run_ship_pre_detach.guard_test_argv(directory)

	return guard.length > 0 && command === guard.join(' ') ? gate_labels.GUARD_TESTS_LABEL : undefined
}

// Names the record label, never the guard tests' path list.
function reused_report(label: string, at: string): JoshResult {
	return {
		code: SUCCESS_EXIT_CODE,
		out: `${label}: reused — green at ${at} and none of its inputs moved since`,
	}
}

// Runs the stage, recording a quiet green against `tree`, the tree read before it started.
async function run_recorded(
	argv: ReadonlyArray<string>,
	label: string,
	tree: GateTree,
	context: { run: Runner; records: CheckRecords },
): Promise<JoshResult> {
	const started = performance.now()
	const result = await context.run(argv)
	const elapsed_ms = performance.now() - started
	const step = { label, command: argv.join(' '), exit_code: result.code, output: result.out }

	await check_reuse.record_green_checks([{ ...step, elapsed_ms }], tree, context.records)

	return result
}

// `run` wrapped so the reused stages answer from their record and record a green they ran to.
function reusing(
	run: Runner,
	records: CheckRecords = check_reuse.DEFAULT_RECORDS,
	read_tree: TreeReader = check_related_reuse.read_tree,
): Runner {
	return async (argv) => {
		const label = stage_label(argv, process.cwd())

		if (label === undefined) return await run(argv)
		const tree = await read_tree()
		const reusable = await check_reuse.reusable_checks([label], tree, records)
		const at = reusable.get(label)

		if (at !== undefined) return reused_report(label, at)

		return await run_recorded(argv, label, tree, { run, records })
	}
}

const run_chain_reuse = { reusing }

export { run_chain_reuse }
