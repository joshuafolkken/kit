import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_ship } from './run-ship'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_lap } from './run-ship-lap'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_review_steps } from './run-ship-review-steps'
import { run_ship_scoped } from './run-ship-scoped'
import { run_ship_stage, type ShipState, type Stage } from './run-ship-stage'
import { run_ship_sync, type StepResult, type WaitMark } from './run-ship-sync'

// The stages `josh ship` runs, in the order a change ships, kept apart from the chaining
// CLI so the order is read in one place.

const should_forward_stderr = true
const SUCCESS_EXIT_CODE = 0

interface ShipArguments {
	title: string
	number: string
	notify: ReadonlyArray<string>
	body: ReadonlyArray<string>
	body_path: string | undefined
	cites: ReadonlyArray<string>
	is_review: boolean
	is_detach: boolean
	// `--unpinned-ok "<reason>"` as given, forwarded to round 1's `run:review` alone; empty when absent.
	unpinned_ok: ReadonlyArray<string>
}

interface Step {
	stage: Stage
	header: string
	run: (args: ShipArguments, state: ShipState) => Promise<StepResult>
}

const { STAGE } = run_ship_stage

async function josh(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, should_forward_stderr)
}

// The pull request's preconditions and the scoped pair are asked first, so a stop they would cause
// lands before the review and the gate rather than after them.
const PREFLIGHT_STEP: Step = {
	stage: STAGE.PREFLIGHT,
	header: run_ship.PREFLIGHT_HEADER,
	run: async (args) =>
		await run_ship_preflight.stage({ title: args.title, body_path: args.body_path }),
}

// The gate stage. **A gate that only reused the tree's green record is not timed**: after `--review`
// launched the gate itself, this stage ends in seconds without running a check, and those seconds
// would pull the `gate` row `lane:stats` reads for `JOSH_LANE_LIMIT` toward zero. The record is asked
// for before the stage runs — afterwards every green gate has one.
async function gate_stage(): Promise<StepResult> {
	const is_skipped = await run_ship_scoped.is_gate_green()
	const result = await run_ship_scoped.scoped_gate()

	return { ...result, is_skipped }
}

// The default branch is merged before the gate, so the pull request opens on a branch that is current;
// a clean merge goes on without waking anyone. A merge after the gate would move the merge base the
// gate's record pins, so the pre-push hook could not reuse that record. **With `--review` it runs before
// round 1 too**: the gate round 1 launches then reads the base the commit carries, so a clean round
// leaves the gate stage a reuse rather than a whole second gate over a moved base (joshuafolkken/kit#4442).
const SYNC_STEP: Step = {
	stage: STAGE.SYNC,
	header: run_ship.SYNC_HEADER,
	run: async (args, state) =>
		await run_ship_sync.sync_stage(args.number, args.title, state.is_dirty === true),
}

// A default branch that moved since the sync stage is merged and gated again before the push
// (`run_ship_sync.catch_up`, joshuafolkken/kit#4825). A resumed ship with nothing left to push leaves
// that to the followup, which pushes what it merges; a pushed branch with new work still catches up.
async function commit_stage(args: ShipArguments, state: ShipState): Promise<StepResult> {
	const stop = run_ship_stage.is_shipped(state) ? undefined : await run_ship_sync.catch_up()

	if (stop !== undefined) return stop

	const argv = ['git', '-y', ...run_ship_stage.commit_flags(state), ...args.body, args.title]

	return await run_ship_lap.timed(run_ship_lap.STEP.COMMIT, async () => await josh(argv))
}

// The gate before the commit, the commit/push/PR before the merge. The gate meets the scoped pair
// first: a round-1 reviewer may have edited the tree since the preflight, and `josh gate` refuses a tree
// with no green record. The commit step carries the `--skip-*` flags a resumed ship needs, so an
// existing commit or push is never made twice.
const COMMIT_STEPS: ReadonlyArray<Step> = [
	{
		stage: STAGE.GATE,
		header: run_ship.GATE_HEADER,
		run: async () => await gate_stage(),
	},
	{
		stage: STAGE.COMMIT,
		header: run_ship.COMMIT_HEADER,
		run: async (args, state) => await commit_stage(args, state),
	},
]

// The followup's merge wait on the stage record, written best-effort as the stages are
// (`run-ship-cli.ts`): a lost mark only keeps the lane counted (joshuafolkken/kit#4466).
function wait_mark(target: string | undefined): WaitMark {
	return function mark(is_merge_waiting: boolean): void {
		if (target === undefined) return

		try {
			run_ship_stage.mark_merge_waiting(target, is_merge_waiting)
		} catch {
			// Best-effort: an unmarked wait holds the lane's place, the safe direction.
		}
	}
}

// The merge, then the ship body draft goes with it (`run-ship-body-draft.ts`).
async function followup_stage(args: ShipArguments): Promise<StepResult> {
	const mark = wait_mark(await run_ship_probe.record_target(args.number))
	const result = await run_ship_sync.followup_stage(args.title, args.notify, mark)

	if (result.code === SUCCESS_EXIT_CODE) await run_ship_body_draft.remove(args.number)

	return result
}

// The merge before the report bookkeeping.
const MERGE_STEPS: ReadonlyArray<Step> = [
	{
		stage: STAGE.FOLLOWUP,
		header: run_ship.FOLLOWUP_HEADER,
		run: async (args) => await followup_stage(args),
	},
	{
		stage: STAGE.REPORT,
		header: run_ship.REPORT_HEADER,
		run: async (args) => await josh(['run:tail', args.number, ...args.cites]),
	},
]

// `--review` puts the supervised round-1 review in front of the gate: it launches the gate itself, so
// the gate stage that follows reuses that tree's green record unless the round changed the tree. It
// also puts the round-2 pass between the commit
// and the followup, so the PR opens between the rounds and round 2 runs beside CI — a no-op when
// round 1 left no fix delta.
const REVIEW_STEP: Step = {
	stage: STAGE.REVIEW,
	header: run_ship.REVIEW_HEADER,
	run: async (args, state) =>
		await run_ship_review_steps.review_stage(
			args.number,
			state.is_review_stale === true,
			args.unpinned_ok,
		),
}
const ROUND_TWO_STEP: Step = {
	stage: STAGE.ROUND_TWO,
	header: run_ship.ROUND_TWO_HEADER,
	run: async (args) => await run_ship_review_steps.round_two_stage(args.number),
}

function steps(args: ShipArguments): ReadonlyArray<Step> {
	if (!args.is_review) return [PREFLIGHT_STEP, SYNC_STEP, ...COMMIT_STEPS, ...MERGE_STEPS]

	return [PREFLIGHT_STEP, SYNC_STEP, REVIEW_STEP, ...COMMIT_STEPS, ROUND_TWO_STEP, ...MERGE_STEPS]
}

const run_ship_steps = { PREFLIGHT_STEP, steps }

export type { ShipArguments, Step }
export { run_ship_steps }
