import { backlog_occupied } from '#scripts/backlog/backlog-occupied'
import type { LaneInfo } from '#scripts/lane/lane-registry'
import { lane_state, type LaneRecords } from '#scripts/lane/lane-state'
import { run_board_lane_state, type BoardLanes } from '#scripts/run/board/run-board-lane-state'
import { run_board_status, type ItemState } from '#scripts/run/board/run-board-status'
import {
	PROCESS_ALIVE,
	PROCESS_NONE,
	run_liveness,
	type LivenessVerdict,
	type Traces,
} from '#scripts/run/run-liveness'
import type { LaneModel, World } from './lane-lifecycle-fixture'

// What each reader answers of one lane (joshuafolkken/kit#4274), read through the real readers, and
// what the model says each should answer. The property is that the two are equal at every step.

type Whose = 'own' | 'earlier' | 'absent'

interface LaneView {
	// `run:board`: whose row it is drawn as, and in what state.
	whose: Whose
	board: ItemState | 'absent'
	// The backlog's count: whether the lane holds a place under the limit.
	is_counted: boolean
	// `run:liveness`'s verdict.
	verdict: LivenessVerdict
}

interface Read {
	records: LaneRecords
	sorted: BoardLanes
	occupied: ReadonlySet<string>
	// The earlier run's lanes the board draws (`run-board-read.ts`'s `earlier_occupied`).
	earlier: ReadonlySet<string>
	statuses: ReadonlyMap<number, { state: ItemState }>
}

function lane_info(issue: string): LaneInfo {
	return {
		issue,
		branch: `${issue}-lane`,
		directory: `/lanes/${issue}`,
		seat: 1,
		development_port: undefined,
		preview_port: undefined,
		output: `/tmp/${issue}.log`,
		is_stranded: false,
	}
}

function listed_of(world: World): Array<string> {
	return [...world.lanes].filter(([, lane]) => lane.is_listed).map(([issue]) => issue)
}

function idle_of(world: World, lanes: ReadonlyArray<LaneInfo>): Array<string> {
	return lanes.map((one) => one.issue).filter((issue) => world.lanes.get(issue)?.is_alive !== true)
}

function places_of(
	occupied: ReadonlyArray<LaneInfo>,
	sorted: BoardLanes,
): Pick<Read, 'occupied' | 'earlier'> {
	const issues = occupied.map((one) => one.issue)

	return {
		occupied: new Set(issues),
		earlier: new Set(run_board_lane_state.earlier_occupied(issues, sorted)),
	}
}

async function read_world(world: World): Promise<Read> {
	const listed = listed_of(world)
	const records = await lane_state.read_states([...world.lanes.keys()], world.directory)
	const infos = listed.map((issue) => lane_info(issue))
	const idle = idle_of.bind(undefined, world)
	const occupied = backlog_occupied.occupied_lanes(infos, idle, records)
	const read = { events: world.events, lanes: listed, records, started_ms: world.run.started_ms }
	const sorted = run_board_lane_state.lanes_of(read)
	const statuses = run_board_status.statuses_of(world.events, sorted, idle(infos))

	return { records, sorted, ...places_of(occupied, sorted), statuses }
}

function board_of(read: Read, issue: string): Pick<LaneView, 'whose' | 'board'> {
	const number = Number(issue)
	const own = read.sorted.own.has(number) ? read.statuses.get(number) : undefined

	if (own !== undefined) return { whose: 'own', board: own.state }

	const earlier = read.earlier.has(issue) ? read.sorted.earlier.get(number) : undefined

	return earlier === undefined
		? { whose: 'absent', board: 'absent' }
		: { whose: 'earlier', board: earlier.state }
}

function verdict_of(world: World, read: Read, issue: string): LivenessVerdict {
	const is_alive = world.lanes.get(issue)?.is_alive === true
	const traces: Traces = {
		lane_state: read.records.get(issue)?.state,
		process_trace: is_alive ? PROCESS_ALIVE : PROCESS_NONE,
		is_child_settled: false,
		is_output_frozen: !is_alive,
		is_tree_dirty: false,
	}

	return run_liveness.decide(traces).verdict
}

/** What the three readers answer of `issue` in `world` now. */
function actual_view(world: World, read: Read, issue: string): LaneView {
	return {
		...board_of(read, issue),
		is_counted: read.occupied.has(issue),
		verdict: verdict_of(world, read, issue),
	}
}

function is_counted(lane: LaneModel): boolean {
	return lane.is_listed && lane.is_alive && lane.state !== 'paused'
}

function expected_verdict(lane: LaneModel): LivenessVerdict {
	if (lane.state === 'ended') return 'settled'
	if (lane.state === 'paused') return 'paused'

	return lane.is_alive ? 'alive' : 'stopped'
}

function own_board(lane: LaneModel): ItemState {
	if (lane.state === 'paused') return 'paused'

	return lane.is_alive ? 'running' : 'stopped'
}

const HELD_STATES: ReadonlySet<LaneModel['state']> = new Set(['running', 'paused'])

function earlier_board(lane: LaneModel): Pick<LaneView, 'whose' | 'board'> {
	return is_counted(lane)
		? { whose: 'earlier', board: 'running' }
		: { whose: 'absent', board: 'absent' }
}

function expected_board(world: World, lane: LaneModel): Pick<LaneView, 'whose' | 'board'> {
	if (!lane.is_listed || !HELD_STATES.has(lane.state)) return { whose: 'absent', board: 'absent' }

	return lane.launch_run === world.run.id
		? { whose: 'own', board: own_board(lane) }
		: earlier_board(lane)
}

/** What the model says the three readers should answer of `lane`. */
function expected_view(world: World, lane: LaneModel): LaneView {
	return {
		...expected_board(world, lane),
		is_counted: is_counted(lane),
		verdict: expected_verdict(lane),
	}
}

const lane_lifecycle_view = { actual_view, expected_view, read_world }

export { lane_lifecycle_view }
export type { LaneView }
