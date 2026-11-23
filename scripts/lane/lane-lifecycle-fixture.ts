import { stamp_file } from '#scripts/josh/stamp-file'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import {
	lane_state,
	type LaneState,
	type OwnerMove,
	type RecordOutcome,
} from '#scripts/lane/lane-state'
import { lane_transition_guards, type GuardReaders } from '#scripts/lane/lane-transition-guards'
import type { LaneTransitionEvent } from '#scripts/lane/lane-transition-table'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { HoldRead } from '#scripts/run/hold/run-hold'
import { temporary_directory } from '#tools/test/temporary-directory'

// The world the lane lifecycle property test (joshuafolkken/kit#4274) drives: each operation writes
// what the real command writes — the lane state record through `lane_state.record_change`, the carry
// through `run_carry`, a line on the event stream — and moves a model of what it should leave beside
// it. The child processes are a table and the clock a counter, so nothing real is spawned or waited on.

const KIND = run_event_stream.EVENT_KIND
const ISSUES = ['9101', '9102'] as const
const START_MS = Date.parse('2026-10-22T00:00:00.000Z')
const TICK_MS = 60_000
const INVOCATION = 'backlogrun'
const make_directory = temporary_directory()

interface LaneModel {
	// The record state the commands so far should have left.
	state: LaneState | undefined
	// Whether the lane's child process is there — suspended counts, as pgrep still finds it.
	is_alive: boolean
	// Whether `lane:list` holds the lane, i.e. it is open and not yet closed.
	is_listed: boolean
	// The run that last launched or adopted its child through resume.
	launch_run: number | undefined
	// Whether the lane's branch and work tree are still there (joshuafolkken/kit#7657).
	has_work_tree: boolean
}

// Who holds the primary checkout a merge's `main:sync` switches and pulls (joshuafolkken/kit#7716),
// and the most holders it has had at once.
interface CheckoutModel {
	holders: Array<string>
	peak: number
}

interface RunModel {
	id: number
	started_ms: number
	// A session is driving the run; a stopped run keeps its carry until a session resumes it.
	is_active: boolean
	has_carry: boolean
}

interface World {
	directory: string
	clock_ms: number
	events: Array<RunEvent>
	lanes: Map<string, LaneModel>
	run: RunModel
	checkout: CheckoutModel
}

function new_lane(): LaneModel {
	return {
		state: undefined,
		is_alive: false,
		is_listed: false,
		launch_run: undefined,
		has_work_tree: true,
	}
}

function create_world(): World {
	const lanes = new Map(ISSUES.map((issue) => [issue, new_lane()]))
	const run = { id: 0, started_ms: START_MS, is_active: false, has_carry: false }

	return {
		directory: make_directory('lane-lifecycle-'),
		clock_ms: START_MS,
		events: [],
		lanes,
		run,
		checkout: { holders: [], peak: 0 },
	}
}

function dispose_world(world: World): void {
	stamp_file.remove_stamp(run_carry.carry_path(world.directory))

	for (const issue of ISSUES) stamp_file.remove_stamp(lane_state.state_path(world.directory, issue))
}

function tick(world: World): Date {
	world.clock_ms += TICK_MS

	return new Date(world.clock_ms)
}

function lane_of(world: World, issue: string): LaneModel {
	const lane = world.lanes.get(issue)

	if (lane === undefined) throw new Error(`no lane ${issue} in the world`)

	return lane
}

function emit(world: World, kind: string, text: string): void {
	const at = tick(world).toISOString()

	world.events.push({ pos: world.events.length, at, kind, text })
}

interface Write {
	issue: string
	state: LaneState
	command: string
	is_launch?: boolean
}

function options_of(world: World): { directory: string; now: Date } {
	return { directory: world.directory, now: tick(world) }
}

async function recorded(world: World, change: Write): Promise<RecordOutcome> {
	const outcome = await lane_state.record_change(change, options_of(world))

	if (outcome.kind === 'written') lane_of(world, change.issue).state = change.state

	return outcome
}

// The record the command writes; a write the lifecycle refuses means the model and the record parted.
async function write(world: World, change: Write): Promise<void> {
	const outcome = await recorded(world, change)

	if (outcome.kind !== 'written') {
		throw new Error(`${change.command} #${change.issue}: ${outcome.reason}`)
	}
}

/** Writes the record as the command does; whether the lifecycle took it, as a refusal leaves it. */
async function try_write(world: World, change: Write): Promise<boolean> {
	const outcome = await recorded(world, change)

	return outcome.kind === 'written'
}

/** An adopt or a hand-over as `lane_state.record_owner` writes it; whether it was written. */
async function try_owner(world: World, issue: string, move: OwnerMove): Promise<boolean> {
	const outcome = await lane_state.record_owner(issue, move, options_of(world))

	if (outcome.kind === 'written') lane_of(world, issue).state = outcome.record.state

	return outcome.kind === 'written'
}

function lane_info(issue: string, lane: LaneModel): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded: !lane.has_work_tree,
	}
}

function hold_read(world: World): HoldRead {
	const [holder] = world.checkout.holders

	if (holder === undefined) return { kind: 'free' }

	return {
		kind: 'held',
		hold: { issue: holder, taken_at: new Date(START_MS).toISOString(), pid: 1 },
	}
}

/** The guard readers over the world: its lane list, the lanes' work trees and the checkout's hold. */
function guard_readers(world: World): GuardReaders {
	return {
		find_lane: async (issue) => {
			const lane = lane_of(world, issue)

			return lane.is_listed ? lane_info(issue, lane) : undefined
		},
		branch_exists: async () => true,
		read_tree_hold: async () => hold_read(world),
	}
}

/** Whether a guard of `event` the table names refuses `issue`'s lane in the world, as its writer asks. */
async function is_refused(
	world: World,
	event: LaneTransitionEvent,
	issue: string,
): Promise<boolean> {
	const reason = await lane_transition_guards.rejection(event, issue, guard_readers(world))

	return reason !== undefined
}

// One lane operation: offered only where the real command acts, and leaving what that command leaves.
// `lifts_pause`: a person's own lift of a pause — a resume, a withdraw, a close. `skips_tree_guard`: a
// writer that does not ask the work-tree guard yet — `lane:resume` and review-resume (joshuafolkken/kit#8829).
interface LaneOperation {
	name: string
	can: (world: World, lane: LaneModel) => boolean
	apply: (world: World, issue: string) => Promise<void> | void
	lifts_pause?: boolean
	skips_tree_guard?: boolean
}

interface RunOperation {
	name: string
	can: (world: World) => boolean
	apply: (world: World) => void
}

const lane_lifecycle_fixture = {
	INVOCATION,
	ISSUES,
	KIND,
	create_world,
	dispose_world,
	emit,
	is_refused,
	lane_of,
	tick,
	try_owner,
	try_write,
	write,
}

export { lane_lifecycle_fixture }
export type { LaneModel, LaneOperation, RunOperation, World }
