import { josh_command } from '#scripts/josh/josh-run'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_stage, type StageCommand } from '#scripts/run/run-stage'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { run_entry } from './run-entry'

// The josh children `run:entry` spawns, and the laps its steps are timed under (joshuafolkken/kit#5831):
// the entry runs its whole sequence inside one `run:entry` scope (`within`), so `lane:breakdown`
// splits the entry's minutes under the start to plan by the child that took them — a contended lane's
// hold or prep wait, not one `run:entry` row. The in-process steps between the children — the
// overlap probe and the printed report — are laps too, so the children explain the
// `run:entry` call group rather than leaving a third of it unnamed (joshuafolkken/kit#5860).

const ENTRY_SCOPE = 'run:entry'
const STEP = {
	RESUME: 'run:cut --resume',
	STAGE: 'stage read',
	HOLD: 'run:hold',
	COST: 'cost --cut',
	SYNC: 'sync',
	LABEL: 'label',
	PREP: 'run:prep',
	PROBE: 'lane:plan probe',
	LANE_PLAN: 'lane:plan',
	BASELINE: 'issue baseline',
	REPORT: 'report',
} as const
const ADOPT_FLAG = '--adopt'
const NEWLINE = '\n'
const should_forward_stderr = true

interface EntryRequest {
	issue_number: string
	command: StageCommand
	// A `new` run's entry once its Issue is filed: the bare hold is re-keyed, not claimed afresh.
	is_adopt: boolean
}

interface Resume {
	token: string
	code: number
	// The `pre-gate-cut.md` section `run:cut --resume` prints after a non-trivial token, empty on `fresh`.
	section: string
}

async function within<T>(issue_number: string, run: () => Promise<T>): Promise<T> {
	return await run_ship_lap.within(issue_number, ENTRY_SCOPE, run, ENTRY_SCOPE)
}

async function timed<T>(step: string, run: () => Promise<T>): Promise<T> {
	return await run_ship_lap.timed(step, run)
}

function first_line(out: string): string {
	return out.split(NEWLINE)[0] ?? ''
}

async function josh_line(step: string, argv: ReadonlyArray<string>): Promise<string> {
	const result = await timed(
		step,
		async () =>
			await josh_command.josh_run(
				argv,
				should_forward_stderr,
				undefined,
				run_ship_lap.environment(`${ENTRY_SCOPE} › ${step}`),
			),
	)

	return result.code === 0 ? first_line(result.out) : 'unknown'
}

// `run:hold <N>` prints one token — `hold`, `busy` or `unknown` — and forwards its explanation to
// stderr, so the composite branches on the token and the reader still sees why. `--fullrun` marks the
// hold as a run whose implementation cut resumes as `fullrun #N` — a
// `fullrun`'s, and a `prrun`'s, which runs `fullrun`'s steps; a `halfrun`'s hold is never marked.
// `--adopt` re-keys a `new` run's bare hold instead (`run:hold --adopt`), answering `none` or `busy`
// when there is none to hand over — either stops the entry as a held tree does.
function hold_argv({ issue_number, command, is_adopt }: EntryRequest): Array<string> {
	if (is_adopt) return ['run:hold', ADOPT_FLAG, issue_number]

	const mark = command === run_stage.HALFRUN ? [] : ['--fullrun']

	return ['run:hold', issue_number, ...mark]
}

async function claim_hold(request: EntryRequest): Promise<string> {
	return await josh_line(STEP.HOLD, hold_argv(request))
}

// A dispatched lane child never asks the session boundary — the parent owns it once per session
// (`backlogrun-progress.md` → "The hand-off") — so this records `skipped` rather than reading a budget
// nothing in the lane acts on, the same shape `run:prep` skips `latest` in a lane.
async function check_cost(): Promise<string> {
	if (lane_child_marker.is_child_of(process.cwd())) return run_entry.COST_SKIPPED

	return await josh_line(STEP.COST, ['cost', '--cut'])
}

// **A resume is asked before the hold is claimed.** An implementation cut outside a lane keeps its
// hold, so the fresh session's `fullrun #N` would otherwise be refused `busy` by its own run's hold
// before it ever reached `run:cut --resume` — the hand-off the cut promised could not land.
async function ask_resume(issue_number: string): Promise<Resume> {
	const asked = await timed(
		STEP.RESUME,
		async () =>
			await josh_command.josh_run(['run:cut', '--resume', issue_number], should_forward_stderr),
	)

	const [token = '', ...section] = asked.out.split(NEWLINE)

	return { token, code: asked.code, section: section.join(NEWLINE).trim() }
}

const run_entry_children = {
	ADOPT_FLAG,
	STEP,
	ask_resume,
	check_cost,
	claim_hold,
	timed,
	within,
}

export { run_entry_children }
export type { EntryRequest, Resume }
