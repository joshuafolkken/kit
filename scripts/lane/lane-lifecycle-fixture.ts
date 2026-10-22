import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_state, type LaneState } from '#scripts/lane/lane-state'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// The world the lane lifecycle property test (joshuafolkken/kit#4274) drives: each operation writes
// what the real command writes — the lane state record through `lane_state.record_change`, the carry
// through `run_carry`, a line on the event stream — and moves a model of what it should leave beside
// it. The child processes are a table and the clock a counter, so nothing real is spawned or waited on.

const KIND = run_event_stream.EVENT_KIND
const ISSUES = ['9101', '9102'] as const
const START_MS = Date.parse('2026-10-22T00:00:00.000Z')
const TICK_MS = 60_000
const INVOCATION = 'backlogrun'

interface LaneModel {
	// The record state the commands so far should have left.
	state: LaneState | undefined
	// Whether the lane's child process is there — suspended counts, as pgrep still finds it.
	is_alive: boolean
	// Whether `lane:list` holds the lane, i.e. it is open and not yet closed.
	is_listed: boolean
	// The run that last launched a child in it.
	launch_run: number | undefined
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
}

function create_world(): World {
	const lanes = new Map(
		ISSUES.map((issue) => [
			issue,
			{ state: undefined, is_alive: false, is_listed: false, launch_run: undefined },
		]),
	)
	const run = { id: 0, started_ms: START_MS, is_active: false, has_carry: false }

	return {
		directory: mkdtempSync(path.join(tmpdir(), 'lane-lifecycle-')),
		clock_ms: START_MS,
		events: [],
		lanes,
		run,
	}
}

function dispose_world(world: World): void {
	stamp_file.remove_stamp(run_carry.carry_path(world.directory))

	for (const issue of ISSUES) stamp_file.remove_stamp(lane_state.state_path(world.directory, issue))

	rmSync(world.directory, { recursive: true, force: true })
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

// The record the command writes; a write the lifecycle refuses means the model and the record parted.
async function write(world: World, change: Write): Promise<void> {
	const outcome = await lane_state.record_change(change, {
		directory: world.directory,
		now: tick(world),
	})

	if (outcome.kind === 'skipped') {
		throw new Error(`${change.command} #${change.issue}: ${outcome.reason}`)
	}

	lane_of(world, change.issue).state = change.state
}

const lane_lifecycle_fixture = {
	INVOCATION,
	ISSUES,
	KIND,
	create_world,
	dispose_world,
	emit,
	lane_of,
	tick,
	write,
}

export { lane_lifecycle_fixture }
export type { LaneModel, World }
