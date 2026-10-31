import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { metrics_totals } from '#scripts/gate/metrics-totals'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_ship_lap, type LapNote } from './run-ship-lap'
import { run_ship_narrowed } from './run-ship-narrowed'
import { run_ship_pair_runs } from './run-ship-pair-runs'
import { run_ship_synced_scope, type SyncReading } from './run-ship-synced-scope'

// The scoped pair `josh ship` meets itself rather than stops on, shared by every stage that needs a
// green record for this tree: the preflight stage at the start, the review rounds, and the gate
// stage — a reviewer may have edited the tree after round 1's pair ran, and `josh gate` refuses a
// tree with no green record.

const SUCCESS_EXIT_CODE = 0
const should_forward_stderr = true
const MOVED_SINCE_GREEN = 'moved since this ship last met the pair green on this base'
const MERGE_MEETS_BRANCH = "where the merge with the default branch meets this branch's change"

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

function printed(line: string): JoshResult {
	process.stdout.write(`${line}\n`)

	return { code: SUCCESS_EXIT_CODE, out: line }
}

// Each check bare; every output is kept, so the lap reads each one's fallback reason.
async function bare_pair(scripts: ReadonlyArray<string>): Promise<JoshResult> {
	const outs: Array<string> = []
	const result = await run_phases(
		scripts.map((script) => async () => {
			const ran = await josh_command.josh_run([script], should_forward_stderr)

			outs.push(ran.out)

			return ran
		}),
	)

	return { ...result, out: outs.filter((out) => out !== '').join('\n') }
}

// The files the pair can be named over, with why, or `undefined`.
async function named_files(
	tree: GateTree,
	scripts: ReadonlyArray<string>,
	sync: SyncReading | undefined,
): Promise<{ files: ReadonlyArray<string>; why: string } | undefined> {
	const checks = run_ship_synced_scope.checks_of(scripts)
	const files =
		sync === undefined
			? await run_ship_narrowed.moved_since_green(checks, tree)
			: await run_ship_narrowed.nameable(checks, sync.overlap)
	const why = sync === undefined ? MOVED_SINCE_GREEN : MERGE_MEETS_BRANCH

	return files === undefined ? undefined : { files, why }
}

// A tree that moved while the checks ran — a reviewer's edit beside the gate — was not the one they
// read, so it is neither recorded nor remembered green (`scoped_green.record_if_green` does the same).
async function is_still(tree: GateTree): Promise<boolean> {
	return scoped_green.is_unmoved(tree, await gate_tree.read_gate_tree())
}

async function narrowed_or_bare(
	tree: GateTree,
	scripts: ReadonlyArray<string>,
	sync: SyncReading | undefined,
): Promise<JoshResult> {
	const named = await named_files(tree, scripts, sync)

	if (named === undefined) return await bare_pair(scripts)

	printed(run_ship_narrowed.describe(named.files, named.why))

	const checks = run_ship_synced_scope.checks_of(scripts)
	const result = await run_phases(run_ship_narrowed.named_phases(checks, named.files))

	if (result.code === SUCCESS_EXIT_CODE && (await is_still(tree))) {
		run_ship_narrowed.record(checks, tree)
	}

	return result
}

async function stale_pair(tree: GateTree, scripts: ReadonlyArray<string>): Promise<JoshResult> {
	const sync = await run_ship_synced_scope.read_sync(tree, scripts)
	const settled = sync === undefined ? undefined : run_ship_synced_scope.settle(sync, tree)

	if (settled !== undefined) return printed(settled)

	const rerun = run_ship_pair_runs.begin(tree)

	if (rerun !== undefined) printed(rerun)

	return await narrowed_or_bare(tree, scripts, sync)
}

// Only the checks with no green record for this tree run — the same question `review:brief` and the
// local gate refuse on — so a fresh record costs nothing and a stale or absent one costs a scoped run
// instead of a stop and a relaunched session. A check that genuinely fails still stops the ship, its
// output forwarded to the ship log. A pair stale only because a merge with the default branch moved the
// base runs nothing when the merge shares nothing with the branch (`run-ship-synced-scope.ts`), and
// only where the two meet when they do; a pair stale since this ship last met it green on this base
// runs over what moved since (`run-ship-narrowed.ts`).
async function settled_pair(): Promise<JoshResult> {
	const tree = await rerecorded_tree()
	const scripts = scoped_green.missing_scripts(tree.files, tree.base)

	// Nothing stale ran nothing, so the records already vouch for the tree read.
	if (scripts.length === 0) {
		run_ship_narrowed.remember(tree)
		run_ship_pair_runs.met(tree, SUCCESS_EXIT_CODE)

		return { code: SUCCESS_EXIT_CODE, out: '' }
	}

	const result = await stale_pair(tree, scripts)

	run_ship_pair_runs.met(tree, result.code)
	if (result.code === SUCCESS_EXIT_CODE && (await is_still(tree))) run_ship_narrowed.remember(tree)

	return result
}

function pair_note(result: JoshResult): LapNote {
	const reasons = since_green.fallbacks_of(result.out)
	const run = run_ship_pair_runs.current()

	return reasons.length === 0 ? run : { ...run, fallback: reasons.join(', ') }
}

// Timed as one lap in whichever ship stage asked for it (`run-ship-lap.ts`), with why a check read the
// whole branch change, when one did, and which run of this ship's pair it was. One pair at a time
// (`run-ship-pair-runs.ts`): round 2 beside the gate waits for the gate's pair rather than racing it.
async function scoped_pair(): Promise<JoshResult> {
	return await run_ship_pair_runs.one_at_a_time(
		async () =>
			await run_ship_lap.timed(run_ship_lap.STEP.SCOPED_PAIR, settled_pair, {
				note_of: pair_note,
			}),
	)
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
