import type { EarlierLanes } from './run-board-earlier'
import type { GatherRead } from './run-board-gather'
import { run_board_github } from './run-board-github'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import { run_board_released } from './run-board-released'
import { run_board_render } from './run-board-render'
import { run_board_spin } from './run-board-spin'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import { run_board_status, type ItemStatus } from './run-board-status'
import { run_board_thanks } from './run-board-thanks'
import { run_board_tick_draw } from './run-board-tick-draw'

// One `run:board` redraw. The frame is redrawn once a second, on the second, so every elapsed time
// moves by one, its spinners turned between redraws by `run-board-spin.ts`. It draws the last reads
// off this machine (`run-board-gather.ts`) — a live board's taken on a worker thread, so the redraw
// itself reads nothing that could stop a spinner — laid over the GitHub reads, `run-board-github.ts`'s,
// which a live board never waits on. A run that ended stays on screen until the next one starts. With
// no run in this checkout it reads nothing from GitHub.

const { REDRAW_MS } = run_board_spin
const { FRESH_STATE } = run_board_state
const { PLAN_RETRY_MS, gather_github, open_read_of, statuses_for } = run_board_github
const { gather_thanks } = run_board_thanks
const { activity_here, bounds_of, closed_under, draw, draw_run } = run_board_tick_draw

// What the last board on this run kept (`run-board-snapshot.ts`); one written on another run is
// discarded.
function saved_for(
	ports: BoardPorts,
	started_ms: number,
): Pick<BoardState, 'known' | 'closed' | 'issue_count'> {
	const snapshot = ports.snapshot?.load()

	if (snapshot?.run_started_ms !== started_ms) return FRESH_STATE

	const { titles, labels, closed, issue_count } = snapshot

	return { known: { titles, labels }, closed, issue_count }
}

// The state of the run on screen, over the reads just taken; a different run starts its plan state
// from what the last board on it kept, or from nothing, so no row, count or baseline of the previous
// run is drawn over the new one.
function state_for(
	state: BoardState,
	read: GatherRead,
	local: LocalRead,
	ports: BoardPorts,
): BoardState {
	if (state.run_started_ms === local.started_ms) return { ...state, ...read }

	const saved = saved_for(ports, local.started_ms)

	return { ...FRESH_STATE, ...saved, ...read, run_started_ms: local.started_ms }
}

// The already-read supervisor or parent drives retries until the run stops or becomes stranded.
function is_backlog_live(local: LocalRead): boolean {
	const roots = local.roots ?? {}

	return (
		!activity_here(local).is_stopped &&
		(roots.supervisor !== undefined || roots.parent !== undefined)
	)
}

// The plan with closed titles underneath the listing and this tick's local worker snapshot.
function plan_here(plan: BoardPlan, state: BoardState, local: LocalRead): BoardPlan {
	const { titles, labels } = closed_under(
		{ titles: plan.context.titles, labels: plan.labels },
		state.closed,
	)

	return {
		...plan,
		context: { ...plan.context, titles },
		labels,
		is_backlog_live: is_backlog_live(local),
		occupied_lanes: local.occupied_lanes,
	}
}

type RoomRead = Pick<
	ReasonRead,
	'free_lanes' | 'occupied_count' | 'lane_limit' | 'usage_reset_ms' | 'is_memory_held' | 'gauges'
>

// The room a waiting row is weighed against: the lanes under the limit, the account's usage limit and
// the machine's memory.
function room_of(state: BoardState, local: LocalRead): RoomRead {
	return {
		free_lanes: local.free_lanes,
		occupied_count: local.occupied_count,
		lane_limit: local.lane_limit,
		usage_reset_ms: local.usage_reset_ms,
		is_memory_held: local.is_memory_held,
		gauges: state.gauges,
	}
}

// The run's statuses over the plan, a child read closed settled and one a person released left out.
function planned_statuses(
	state: BoardState,
	plan: BoardPlan,
	local: LocalRead,
): ReadonlyMap<number, ItemStatus> {
	const read = open_read_of(state, plan)

	return run_board_released.without_released(
		run_board_status.settle_closed(statuses_for(state, local), read),
		read,
	)
}

// The earlier run's lanes still holding a place, and the open lanes with no record.
function earlier_here(local: LocalRead): EarlierLanes {
	return {
		lanes: local.earlier_occupied ?? [],
		statuses: local.lane_states.earlier,
		unknown: local.lane_states.unknown,
	}
}

// The plan laid under its statuses, each waiting row saying why it waits.
function planned_layout(
	state: BoardState,
	input_plan: BoardPlan,
	local: LocalRead,
	now_ms: number,
): BoardLayout {
	const plan = plan_here(input_plan, state, local)
	const statuses = planned_statuses(state, plan, local)
	const reason_of = run_board_reason.reader({
		plan,
		statuses,
		events: local.events,
		...room_of(state, local),
		carry: local.carry,
		is_stopped: activity_here(local).is_stopped,
		now_ms,
	})

	return run_board_layout.layout_of(plan, statuses, reason_of, earlier_here(local))
}

// The statuses scoped to the run's plan, a running child GitHub read closed settled.
// Before the plan is read, the run's own children alone, named and settled as the snapshot left them.
function layout_for(state: BoardState, local: LocalRead, now_ms: number): BoardLayout {
	if (state.plan !== undefined) return planned_layout(state, state.plan, local, now_ms)

	const read = open_read_of(state, undefined)
	const statuses = run_board_status.settle_closed(statuses_for(state, local), read)
	const known = closed_under(state.known, state.closed)

	return run_board_layout.local_layout_of(statuses, earlier_here(local), {
		...known,
		is_backlog_live: is_backlog_live(local),
	})
}

// One redraw. No run reads nothing from GitHub and keeps the plan it had for when one starts. A live
// board redraws at the `background` pace; one plain frame waits for the GitHub reads.
async function tick(
	state: BoardState,
	ports: BoardPorts,
	pace: Pace = 'settled',
): Promise<BoardState> {
	const read = await ports.gather(pace)
	// Taken after the read, which a single frame may have waited on to confirm an idle lane.
	const now_ms = ports.now()
	const { local } = read

	if (local === undefined) {
		draw(ports, run_board_render.render_no_run(now_ms, bounds_of(ports), read))

		return { ...state, ...read, spots: [] }
	}

	const gathered = await gather_github(state_for(state, read, local, ports), {
		ports,
		local,
		now_ms,
		pace,
	})
	const thanked = await gather_thanks(gathered, ports, now_ms, pace)

	return draw_run(thanked, local, { ports, now_ms }, layout_for(thanked, local, now_ms))
}

const run_board_tick = {
	FRESH_STATE,
	PLAN_RETRY_MS,
	REDRAW_MS,
	layout_for,
	tick,
}

export { run_board_tick }
