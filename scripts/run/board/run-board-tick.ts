import { lane_await } from '#scripts/lane/lane-await'
import { lane_process_table, type TableRead } from '#scripts/lane/lane-process-table'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { ClosedIssue } from './run-board-closed'
import type { FrameBounds } from './run-board-fold'
import { run_board_github } from './run-board-github'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_idle } from './run-board-idle'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_machine } from './run-board-machine'
import { run_board_notes, type Titles } from './run-board-notes'
import { run_board_paused } from './run-board-paused'
import type { LocalRead } from './run-board-read'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import { run_board_released } from './run-board-released'
import { run_board_render } from './run-board-render'
import { run_board_spin, type Spun } from './run-board-spin'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import { run_board_status, type ItemStatus, type RunActivity } from './run-board-status'
import { run_board_thanks } from './run-board-thanks'
import { run_board_usage_board } from './run-board-usage-board'

// One `run:board` redraw. **Three speeds**: the frame is redrawn once a second, on the second, so
// every elapsed time moves by one, its spinners turned between redraws by `run-board-spin.ts`; the
// run's own stream and lanes are re-read no more often than `LOCAL_READ_MS`, because each read parses
// the whole stream and asks git twice, and a board left open all night would otherwise grow heavier
// as the run grew longer; the GitHub reads they are laid over are `run-board-github.ts`'s, which a
// live board never waits on. Between reads the last one is kept and drawn against the current time.
// A run that ended stays on screen until the next one starts. With no run in this checkout it reads
// nothing from GitHub. The machine is sampled once a second: one `sysctl` takes a few milliseconds,
// and its gauges are the differences between consecutive samples.

const { REDRAW_MS, SPOT } = run_board_spin
const MACHINE_SAMPLE_MS = MS_PER_SECOND
const LOCAL_READ_SECONDS = 5
const LOCAL_READ_MS = LOCAL_READ_SECONDS * MS_PER_SECOND
const { FRESH_STATE, is_due } = run_board_state
const { PLAN_RETRY_MS, gather_github, statuses_for } = run_board_github
const { gather_thanks } = run_board_thanks

// The redraw's process snapshot and the pace it is drawn at, shared by its reads.
interface TickRead {
	pace: Pace
	table: TableRead
}

interface TickAt extends TickRead {
	now_ms: number
}

async function read_at(state: BoardState, ports: BoardPorts, at: TickAt): Promise<BoardState> {
	const local = await ports.read_local(at.table)
	const idle_since = run_board_idle.since_of(state.idle_since, local?.idle_lanes ?? [], at.now_ms)

	return { ...state, local, read_ms: at.now_ms, idle_since }
}

// A single frame has no earlier read to confirm an idle lane against (`run-board-idle.ts`).
function is_unconfirmed(before: BoardState, read: BoardState, pace: Pace): boolean {
	return pace === 'settled' && before.read_ms === undefined && read.idle_since.size > 0
}

// The redraw's reads over a snapshot taken now.
function fresh_read(ports: BoardPorts, pace: Pace): TickRead {
	return { pace, table: lane_process_table.shared(ports.read_table) }
}

// The lane read and the reads after it share one snapshot; a confirmation taken after the wait reads
// a snapshot of its own and hands it on, so no lane is counted from the state before the wait.
async function reread(
	state: BoardState,
	ports: BoardPorts,
	tick_read: TickRead,
): Promise<{ read: BoardState; reads: TickRead }> {
	const now_ms = ports.now()

	if (!is_due(state.read_ms, LOCAL_READ_MS, now_ms)) return { read: state, reads: tick_read }

	const read = await read_at(state, ports, { now_ms, ...tick_read })

	if (!is_unconfirmed(state, read, tick_read.pace)) return { read, reads: tick_read }

	await ports.sleep(lane_await.RECONFIRM_MS)

	const reads = fresh_read(ports, tick_read.pace)

	return { read: await read_at(read, ports, { now_ms: ports.now(), ...reads }), reads }
}

// The sample is timed when it is taken, not when the tick began: a plan read between the two would put
// its seconds on the wrong side of the rate's interval. It is due by the tick's clock, so a sample
// taken a few milliseconds into its tick does not slip to the redraw after the second.
async function resample(state: BoardState, ports: BoardPorts, at: TickAt): Promise<BoardState> {
	if (!is_due(state.sampled_ms, MACHINE_SAMPLE_MS, at.now_ms)) return state

	const at_ms = ports.now()
	const machine = { sample: await ports.read_machine(), at_ms }
	const gauges = run_board_machine.gauges_of(state.machine, machine)
	const budget_waits = ports.read_waits?.() ?? []
	const usages = await run_board_usage_board.read_usages(state, ports, at.table)

	return { ...state, ...usages, machine, gauges, budget_waits, sampled_ms: at.now_ms }
}

// The state of the run on screen; a different run starts its plan state from nothing, so no row, count
// or baseline of the previous run is drawn over the new one.
function state_for(state: BoardState, local: LocalRead): BoardState {
	if (state.run_started_ms === local.started_ms) return state

	const { local: kept, read_ms, idle_since } = state

	return { ...FRESH_STATE, local: kept, read_ms, idle_since, run_started_ms: local.started_ms }
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
		run_board_status.settle_closed(statuses_for(state, plan, local), read),
		read,
	)
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
		local.earlier_occupied,
	)
}

// The statuses scoped to the run's plan, a running child the plan's listing no longer holds settled.
// Before the plan is read, the run's own children alone.
function layout_for(state: BoardState, local: LocalRead): BoardLayout {
	if (state.plan !== undefined) return planned_layout(state, state.plan, local)

	const stopped = run_board_idle.stopped_of(state.idle_since, state.read_ms)
	const statuses = run_board_status.statuses_of(local.events, local.lanes, new Set(), stopped)

	return run_board_layout.local_layout_of(
		run_board_paused.paused_over(statuses, state.usage?.paused),
		local.earlier_occupied,
	)
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
// board redraws at the `background` pace; one plain frame waits for the GitHub reads. The process
// snapshot is read once, by whichever of the lane read and the sample asks first.
async function tick(
	state: BoardState,
	ports: BoardPorts,
	pace: Pace = 'settled',
): Promise<BoardState> {
	const { read, reads } = await reread(state, ports, fresh_read(ports, pace))
	// Taken after the read, which a single frame may have waited on to confirm an idle lane.
	const now_ms = ports.now()
	const { local } = read

	if (local === undefined) {
		draw(ports, run_board_render.render_no_run(now_ms, bounds_of(ports)))

		return { ...read, spots: [] }
	}

	const gathered = await gather_github(state_for(read, local), { ports, local, now_ms, pace })
	const thanked = await gather_thanks(gathered, ports, now_ms, pace)

	return draw_run(await resample(thanked, ports, { now_ms, ...reads }), local, { ports, now_ms })
}

const run_board_tick = {
	FRESH_STATE,
	LOCAL_READ_MS,
	MACHINE_SAMPLE_MS,
	PLAN_RETRY_MS,
	REDRAW_MS,
	tick,
}

export { run_board_tick }
