import { run_board_data, type DataStep } from './run-board-data'
import { run_board_display, type BoardDisplay } from './run-board-display'
import type { EarlierLanes } from './run-board-earlier'
import { run_board_github } from './run-board-github'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import { run_board_released } from './run-board-released'
import { run_board_render } from './run-board-render'
import { run_board_spin } from './run-board-spin'
import {
	run_board_state,
	type BoardData,
	type BoardGather,
	type BoardPorts,
	type BoardState,
	type Pace,
} from './run-board-state'
import { run_board_status, type ItemStatus } from './run-board-status'
import { run_board_tick_draw } from './run-board-tick-draw'
import { run_board_timing } from './run-board-timing'

// One `run:board` redraw. The frame is redrawn once a second, on the second, so every elapsed time
// moves by one, its spinners turned between redraws by `run-board-spin.ts`. It draws the last reads
// off this machine (`run-board-gather.ts`) laid over the GitHub reads, `run-board-github.ts`'s, which a
// live board never waits on. **A live board's redraw reads nothing**: its worker thread takes both and
// posts them (`run-board-data.ts`), so nothing the redraw does could stop a spinner; one plain frame
// takes them here. A run that ended stays on screen until the next one starts. With no run in this
// checkout it reads nothing from GitHub.

const { REDRAW_MS } = run_board_spin
const { FRESH_STATE } = run_board_state
const { PLAN_RETRY_MS, open_read_of, statuses_for } = run_board_github
const { activity_here, assemble_display, closed_under } = run_board_display
const { bounds_of, draw, draw_display } = run_board_tick_draw
const { drawn } = run_board_timing

// The data the redraw draws: what a live board's worker posted beside the reads, or a step taken here.
async function data_of(state: BoardState, gathered: BoardGather, at: DataStep): Promise<BoardData> {
	const { data, ...read } = gathered

	if (data !== undefined) return run_board_data.received(data, read)

	return await run_board_data.step(state, read, at)
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
	| 'free_lanes'
	| 'occupied_count'
	| 'lane_capacity'
	| 'lane_limit'
	| 'usage_reset_ms'
	| 'usage_cause'
	| 'is_memory_held'
	| 'gauges'
>

// The room a waiting row is weighed against: the lanes under the limit, the account's usage limit and
// the machine's memory.
function room_of(state: BoardState, local: LocalRead): RoomRead {
	return {
		free_lanes: local.free_lanes,
		occupied_count: local.occupied_count,
		lane_capacity: local.lane_capacity,
		lane_limit: local.lane_limit,
		usage_reset_ms: local.usage_reset_ms,
		usage_cause: local.usage_cause,
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

	return run_board_layout.layout_of({ ...plan, now_ms }, statuses, reason_of, earlier_here(local))
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

// The frame with no run, which keeps no spinner.
function draw_no_run(state: BoardState, ports: BoardPorts, now_ms: number): BoardState {
	draw(ports, run_board_render.render_no_run(now_ms, bounds_of(ports), state))

	return { ...state, spots: [], sweep: undefined }
}

// The frame over the display a live board's worker assembled (joshuafolkken/kit#8160), so this thread
// draws without the run's read; with none, the frame assembled here over the read, or no run.
function draw_over(
	state: BoardState,
	display: BoardDisplay | undefined,
	ports: BoardPorts,
	now_ms: number,
): BoardState {
	const { local } = state

	if (display !== undefined) return draw_display(state, display, { ports, now_ms })
	if (local === undefined) return draw_no_run(state, ports, now_ms)

	const assembled = assemble_display(state, local, now_ms, layout_for(state, local, now_ms))

	return draw_display(state, assembled, { ports, now_ms })
}

// One redraw. No run reads nothing from GitHub and keeps the plan it had for when one starts. A live
// board redraws at the `background` pace; one plain frame waits for the GitHub reads.
async function tick(
	state: BoardState,
	ports: BoardPorts,
	pace: Pace = 'settled',
): Promise<BoardState> {
	const { display, ...gathered } = await ports.gather(pace)
	// Taken after the read, which a single frame may have waited on to confirm an idle lane.
	const now_ms = ports.now()
	const data = await data_of(state, gathered, { ports, now_ms, pace })
	const next: BoardState = { ...run_board_data.view_for(state, data), ...data }

	// joshuafolkken/kit#8126: `--timing` times the draw from the layout to the write.
	return drawn(ports, 'tick', () => draw_over(next, display, ports, now_ms))
}

const run_board_tick = {
	FRESH_STATE,
	PLAN_RETRY_MS,
	REDRAW_MS,
	layout_for,
	tick,
}

export { run_board_tick }
