import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_ship } from './run-ship'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_review_steps } from './run-ship-review-steps'
import { run_ship_scoped } from './run-ship-scoped'
import { run_ship_stage, type ShipState, type Stage } from './run-ship-stage'
import { run_ship_sync, type StepResult } from './run-ship-sync'

// The stages `josh ship` runs, in the order a change ships, kept apart from the chaining
// CLI so the order is read in one place.

const should_forward_stderr = true

interface ShipArguments {
	title: string
	number: string
	notify: ReadonlyArray<string>
	body: ReadonlyArray<string>
	body_path: string | undefined
	cites: ReadonlyArray<string>
	is_review: boolean
	is_detach: boolean
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

// The gate before the commit, the commit/push/PR before the merge. The gate meets the scoped pair
// first: a round-1 reviewer may have edited the tree since the preflight, and `josh gate` refuses a tree
// with no green record. The commit step carries the `--skip-*` flags a resumed ship needs, so an
// existing commit or push is never made twice.
const COMMIT_STEPS: ReadonlyArray<Step> = [
	// The default branch is merged again before the commit, so the pull request opens on a branch that
	// is current; a clean merge goes on without waking anyone. It runs before the gate: a merge after it
	// would move the merge base the gate's record pins, so the pre-push hook could not reuse that record.
	{
		stage: STAGE.SYNC,
		header: run_ship.SYNC_HEADER,
		run: async () => await run_ship_sync.sync_stage(),
	},
	{
		stage: STAGE.GATE,
		header: run_ship.GATE_HEADER,
		run: async () => await run_ship_scoped.scoped_gate(),
	},
	{
		stage: STAGE.COMMIT,
		header: run_ship.COMMIT_HEADER,
		run: async (args, state) =>
			await josh(['git', '-y', ...run_ship_stage.commit_flags(state), ...args.body, args.title]),
	},
]

// The merge before the report bookkeeping.
const MERGE_STEPS: ReadonlyArray<Step> = [
	{
		stage: STAGE.FOLLOWUP,
		header: run_ship.FOLLOWUP_HEADER,
		run: async (args) => await run_ship_sync.followup_stage(args.title, args.notify),
	},
	{
		stage: STAGE.REPORT,
		header: run_ship.REPORT_HEADER,
		run: async (args) => await josh(['run:tail', args.number, ...args.cites]),
	},
]

// `--review` puts the supervised round-1 review in front of the gate: it launches the gate itself, so
// the gate stage that follows reuses that tree's green record unless the sync stage between them
// merged the default branch and changed the tree. It also puts the round-2 pass between the commit
// and the followup, so the PR opens between the rounds and round 2 runs beside CI — a no-op when
// round 1 left no fix delta.
const REVIEW_STEP: Step = {
	stage: STAGE.REVIEW,
	header: run_ship.REVIEW_HEADER,
	run: async (args) => await run_ship_review_steps.review_stage(args.number),
}
const ROUND_TWO_STEP: Step = {
	stage: STAGE.ROUND_TWO,
	header: run_ship.ROUND_TWO_HEADER,
	run: async (args) => await run_ship_review_steps.round_two_stage(args.number),
}

function steps(args: ShipArguments): ReadonlyArray<Step> {
	if (!args.is_review) return [PREFLIGHT_STEP, ...COMMIT_STEPS, ...MERGE_STEPS]

	return [PREFLIGHT_STEP, REVIEW_STEP, ...COMMIT_STEPS, ROUND_TWO_STEP, ...MERGE_STEPS]
}

const run_ship_steps = { PREFLIGHT_STEP, steps }

export type { ShipArguments, Step }
export { run_ship_steps }
