import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { metrics_totals } from '#scripts/gate/metrics-totals'
import { scoped_green } from '#scripts/gate/scoped-green'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_ship_lap } from './run-ship-lap'
import { run_ship_synced_scope } from './run-ship-synced-scope'

// The scoped pair `josh ship` meets itself rather than stops on, shared by every stage that needs a
// green record for this tree: the preflight stage at the start, the review rounds, and the gate
// stage — a reviewer may have edited the tree after round 1's pair ran, and `josh gate` refuses a
// tree with no green record.

const SUCCESS_EXIT_CODE = 0
const should_forward_stderr = true

type Phase = () => Promise<JoshResult>

async function run_phases(phases: ReadonlyArray<Phase>): Promise<JoshResult> {
	let last: JoshResult = { code: SUCCESS_EXIT_CODE, out: '' }

	for (const phase of phases) {
		// eslint-disable-next-line no-await-in-loop -- phases run in order and the first failure stops the rest
		last = await phase()
		if (last.code !== SUCCESS_EXIT_CODE) return last
	}

	return last
}

// The tree after the branch's metrics approval is re-recorded (`metrics-totals.ts`): every review fix
// and the gate stage meet the pair here, so a rewrite lands before any record is written for the tree.
async function rerecorded_tree(): Promise<GateTree> {
	const tree = await gate_tree.read_gate_tree()
	const is_rerecorded = await metrics_totals.rerecord(process.cwd(), tree.files)

	return is_rerecorded ? await gate_tree.read_gate_tree() : tree
}

// Only the checks with no green record for this tree run — the same question `review:brief` and the
// local gate refuse on — so a fresh record costs nothing and a stale or absent one costs a scoped run
// instead of a stop and a relaunched session. A check that genuinely fails still stops the ship, its
// output forwarded to the ship log. A pair stale only because a merge with the default branch moved the
// base runs nothing when the merge shares nothing with the branch (`run-ship-synced-scope.ts`).
async function settled_pair(): Promise<JoshResult> {
	const tree = await rerecorded_tree()
	const scripts = scoped_green.missing_scripts(tree.files, tree.base)
	const settled = await run_ship_synced_scope.settle(tree, scripts)

	if (settled !== undefined) {
		process.stdout.write(`${settled}\n`)

		return { code: SUCCESS_EXIT_CODE, out: settled }
	}

	return await run_phases(
		scripts.map(
			(script) => async () => await josh_command.josh_run([script], should_forward_stderr),
		),
	)
}

// Timed as one lap in whichever ship stage asked for it (`run-ship-lap.ts`).
async function scoped_pair(): Promise<JoshResult> {
	return await run_ship_lap.timed(run_ship_lap.STEP.SCOPED_PAIR, settled_pair)
}

async function gate(): Promise<JoshResult> {
	return await run_ship_lap.timed(
		run_ship_lap.STEP.GATE,
		async () => await josh_command.josh_run(['gate'], should_forward_stderr),
	)
}

// The scoped pair and then `josh gate` — the gate stage, and the commit stage's and the followup's gate
// over a merged tree before their push, so each leaves the record the pre-push hook reuses.
async function scoped_gate(): Promise<JoshResult> {
	return await run_phases([scoped_pair, gate])
}

// Whether `josh gate` would only reuse this tree's green record: the gate's own reuse test rather than
// a second copy of it, so the ship calls a gate stage a reuse on exactly the trees the gate skips.
async function is_gate_green(): Promise<boolean> {
	const tree = await gate_tree.read_gate_tree()

	return gate_skip.reusable_green_gate(tree.files, tree.base) !== undefined
}

const run_ship_scoped = { is_gate_green, run_phases, scoped_gate, scoped_pair }

export type { Phase }
export { run_ship_scoped }
