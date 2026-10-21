import type { ClosedIssue } from './run-board-closed'
import type { EarlierLanes } from './run-board-earlier'
import type { FrameBounds } from './run-board-fold'
import type { GatherRead } from './run-board-gather'
import { run_board_github } from './run-board-github'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_idle } from './run-board-idle'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_notes, type Titles } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import { run_board_released } from './run-board-released'
import { run_board_render } from './run-board-render'
import { run_board_spin, type Spun } from './run-board-spin'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import { run_board_status, type ItemStatus, type RunActivity } from './run-board-status'
import { run_board_thanks } from './run-board-thanks'

// One `run:board` redraw. The frame is redrawn once a second, on the second, so every elapsed time
// moves by one, its spinners turned between redraws by `run-board-spin.ts`. It draws the last reads
// off this machine (`run-board-gather.ts`) — a live board's taken on a worker thread, so the redraw
// itself reads nothing that could stop a spinner — laid over the GitHub reads, `run-board-github.ts`'s,
// which a live board never waits on. A run that ended stays on screen until the next one starts. With
// no run in this checkout it reads nothing from GitHub.

const { REDRAW_MS, SPOT } = run_board_spin
const { FRESH_STATE } = run_board_state
const { PLAN_RETRY_MS, gather_github, statuses_for } = run_board_github
const { gather_thanks } = run_board_thanks

// The state of the run on screen, over the reads just taken; a different run starts its plan state
// from nothing, so no row, count or baseline of the previous run is drawn over the new one.
function state_for(state: BoardState, read: GatherRead, local: LocalRead): BoardState {
	if (state.run_started_ms === local.started_ms) return { ...state, ...read }

	return { ...FRESH_STATE, ...read, run_started_ms: local.started_ms }
}

// The plan with a closed child's title and labels under the listing's own.
function with_closed(plan: BoardPlan, closed: ReadonlyMap<number, ClosedIssue>): BoardPlan {
	const closed_titles = [...closed].map(([issue, { title }]) => [issue, title] as const)
	const closed_labels = [...closed].map(([issue, { labels }]) => [issue, labels] as const)
	const titles = new Map([...closed_titles, ...plan.context.titles])
	const labels = new Map([...closed_labels, ...plan.labels])

	return { ...plan, context: { ...plan.context, titles }, labels }
}

// The titles the findings name a parked issue by — the rows' own; none before the plan is read.
function titles_of(state: BoardState): Titles {
	if (state.plan === undefined) return new Map()

	return with_closed(state.plan, state.closed).context.titles
}

// A run `run:carry --end` closed and one nobody drives any more are both drawn as stopped.
function activity_here(local: LocalRead): RunActivity {
	return run_board_status.activity_of(
		local.events,
		local.ended_ms !== undefined || local.is_stranded,
	)
}

type RoomRead = Pick<
	ReasonRead,
	'free_lanes' | 'occupied_count' | 'lane_limit' | 'is_memory_held' | 'gauges'
>

// The room a waiting row is weighed against: the lanes under the limit, and the machine's memory.
function room_of(state: BoardState, local: LocalRead): RoomRead {
	return {
		free_lanes: local.free_lanes,
		occupied_count: local.occupied_count,
		lane_limit: local.lane_limit,
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
	const read = {
		open_numbers: plan.context.open_numbers,
		read_ms: state.fetched_ms,
		closed: state.closed,
		labels: plan.labels,
	}

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
function planned_layout(state: BoardState, plan: BoardPlan, local: LocalRead): BoardLayout {
	const statuses = planned_statuses(state, plan, local)
	const reason_of = run_board_reason.reader({
		plan,
		statuses,
		events: local.events,
		...room_of(state, local),
		carry: local.carry,
		is_stopped: activity_here(local).is_stopped,
	})

	return run_board_layout.layout_of(
		with_closed(plan, state.closed),
		statuses,
		reason_of,
		earlier_here(local),
	)
}

// The statuses scoped to the run's plan, a running child the plan's listing no longer holds settled.
// Before the plan is read, the run's own children alone.
function layout_for(state: BoardState, local: LocalRead): BoardLayout {
	if (state.plan !== undefined) return planned_layout(state, state.plan, local)

	const stopped = run_board_idle.stopped_of(state.idle_since, state.read_ms)
	const statuses = run_board_status.statuses_of(local.events, local.lane_states, stopped)

	return run_board_layout.local_layout_of(statuses, earlier_here(local))
}

// What one redraw draws with.
interface Redraw {
	ports: BoardPorts
	now_ms: number
}

// What the header reads off the local read.
type LocalHeader = Pick<
	BoardHeader,
	'started_ms' | 'ended_ms' | 'activity' | 'operations' | 'usual' | 'lane_limit'
>

function local_header(local: LocalRead): LocalHeader {
	return {
		started_ms: local.started_ms,
		ended_ms: local.ended_ms,
		activity: activity_here(local),
		operations: local.operations,
		usual: local.usual,
		lane_limit: local.lane_limit,
	}
}

function header_of(
	state: BoardState,
	local: LocalRead,
	layout: BoardLayout,
	redraw: Redraw,
): BoardHeader {
	return {
		now_ms: redraw.now_ms,
		...local_header(local),
		layout,
		baseline_total: state.baseline_total,
		plan_fetched_ms: state.fetched_ms,
		plan_failed_ms: state.failed_ms,
		read_failed_ms: state.read_failed_ms,
		is_plan_loading: state.plan_fetch !== undefined,
		machine: state.gauges,
		usages: state.usages,
		budget_waits: state.budget_waits,
		form: redraw.ports.form,
		repo: state.plan?.context.repo,
		spinner: redraw.ports.is_tty ? SPOT : undefined,
		link: run_board_link.linker(state.plan?.context.repo, redraw.ports.link),
	}
}

// The pane a live frame is kept within and the footer it ends on, read at every redraw.
function bounds_of(ports: BoardPorts): FrameBounds {
	return { size: ports.size?.(), footer: ports.footer, folded: ports.folded?.() }
}

// The frame with its spinners drawn at this moment's frame, and where they are on screen.
function frame_of(state: BoardState, local: LocalRead, layout: BoardLayout, redraw: Redraw): Spun {
	const bounds = bounds_of(redraw.ports)
	const lines = run_board_render.render({
		header: header_of(state, local, layout, redraw),
		notes: run_board_notes.notes_of(
			local.events,
			titles_of(state),
			run_board_layout.listed_parks(layout),
		),
		resume: local.resume,
		thanks: state.thanks,
		link: redraw.ports.link,
		...bounds,
	})

	return run_board_spin.spun(lines, run_board_labels.spinner_of(redraw.now_ms), bounds.size)
}

function draw(ports: BoardPorts, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The first total the plan gives is the baseline every later arrival is counted against; the run's own
// children before it are no total.
function draw_run(state: BoardState, local: LocalRead, redraw: Redraw): BoardState {
	const layout = layout_for(state, local)
	const first_total =
		state.plan === undefined ? undefined : run_board_header.counts_of(layout).total
	const settled = { ...state, baseline_total: state.baseline_total ?? first_total }
	const { lines, spots } = frame_of(settled, local, layout, redraw)

	draw(redraw.ports, lines)

	return { ...settled, spots }
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
		draw(ports, run_board_render.render_no_run(now_ms, bounds_of(ports), read.read_failed_ms))

		return { ...state, ...read, spots: [] }
	}

	const gathered = await gather_github(state_for(state, read, local), {
		ports,
		local,
		now_ms,
		pace,
	})
	const thanked = await gather_thanks(gathered, ports, now_ms, pace)

	return draw_run(thanked, local, { ports, now_ms })
}

const run_board_tick = {
	FRESH_STATE,
	PLAN_RETRY_MS,
	REDRAW_MS,
	tick,
}

export { run_board_tick }
