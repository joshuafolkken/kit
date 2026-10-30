import { lane_investigation_switch } from '#scripts/lane/lane-investigation-switch'
import type { ClosedIssue } from './run-board-closed'
import type { EarlierLanes } from './run-board-earlier'
import type { FrameBounds } from './run-board-fold'
import type { GatherRead } from './run-board-gather'
import { run_board_github } from './run-board-github'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_link, type Link } from './run-board-link'
import { run_board_notes, type Titles } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import { run_board_released } from './run-board-released'
import { run_board_render } from './run-board-render'
import type { Known } from './run-board-snapshot'
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
const { PLAN_RETRY_MS, gather_github, known_of, open_read_of, statuses_for } = run_board_github
const { gather_thanks } = run_board_thanks

// What the last board on this run kept (`run-board-snapshot.ts`); one written on another run is
// discarded.
function saved_for(ports: BoardPorts, started_ms: number): Pick<BoardState, 'known' | 'closed'> {
	const snapshot = ports.snapshot?.load()

	if (snapshot?.run_started_ms !== started_ms) return FRESH_STATE

	return { known: { titles: snapshot.titles, labels: snapshot.labels }, closed: snapshot.closed }
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

// The titles and labels with a closed child's under the listing's own.
function closed_under(known: Known, closed: ReadonlyMap<number, ClosedIssue>): Known {
	const closed_titles = [...closed].map(([issue, { title }]) => [issue, title] as const)
	const closed_labels = [...closed].map(([issue, { labels }]) => [issue, labels] as const)

	return {
		titles: new Map([...closed_titles, ...known.titles]),
		labels: new Map([...closed_labels, ...known.labels]),
	}
}

// The plan with a closed child's title and labels under the listing's own.
function with_closed(plan: BoardPlan, closed: ReadonlyMap<number, ClosedIssue>): BoardPlan {
	const { titles, labels } = closed_under(
		{ titles: plan.context.titles, labels: plan.labels },
		closed,
	)

	return { ...plan, context: { ...plan.context, titles }, labels }
}

// The titles the findings name a parked issue by — the rows' own; the snapshot's before the plan is
// read.
function titles_of(state: BoardState): Titles {
	return closed_under(known_of(state), state.closed).titles
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
	plan: BoardPlan,
	local: LocalRead,
	now_ms: number,
): BoardLayout {
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

	return run_board_layout.layout_of(
		with_closed(plan, state.closed),
		statuses,
		reason_of,
		earlier_here(local),
	)
}

// The statuses scoped to the run's plan, a running child GitHub read closed settled.
// Before the plan is read, the run's own children alone, named and settled as the snapshot left them.
function layout_for(state: BoardState, local: LocalRead, now_ms: number): BoardLayout {
	if (state.plan !== undefined) return planned_layout(state, state.plan, local, now_ms)

	const read = open_read_of(state, undefined)
	const statuses = run_board_status.settle_closed(statuses_for(state, local), read)
	const known = closed_under(state.known, state.closed)

	return run_board_layout.local_layout_of(statuses, earlier_here(local), known)
}

// What one redraw draws with.
interface Redraw {
	ports: BoardPorts
	now_ms: number
}

// What the header reads off the local read, and the investigation switch off this machine's
// environment, `.env` loaded as for `run:merge`.
type LocalHeader = Pick<
	BoardHeader,
	| 'started_ms'
	| 'ended_ms'
	| 'activity'
	| 'operations'
	| 'usual'
	| 'lane_limit'
	| 'occupied_count'
	| 'found'
	| 'scheduler_provider'
	| 'is_investigation_on'
>

function local_header(local: LocalRead): LocalHeader {
	return {
		started_ms: local.started_ms,
		ended_ms: local.ended_ms,
		activity: activity_here(local),
		operations: local.operations,
		usual: local.usual,
		lane_limit: local.lane_limit,
		occupied_count: local.occupied_count,
		found: local.found,
		scheduler_provider: local.scheduler_provider,
		is_investigation_on: lane_investigation_switch.is_on(),
	}
}

// The issue references and pull request numbers linked into `repo`, plain before a plan is read.
type Links = Pick<BoardHeader, 'link' | 'pull_link'>

function links_of(repo: string | undefined, link: Link): Links {
	return {
		link: run_board_link.linker(repo, link),
		pull_link: run_board_link.pull_linker(repo, link),
	}
}

type Gauges = Pick<BoardHeader, 'machine' | 'usages' | 'budget_waits' | 'quotas' | 'quota_hold'>

// The machine's gauges and the usage-limit windows, with the limit that holds the run's launches.
function gauges_of(state: BoardState, local: LocalRead): Gauges {
	const reset_ms = local.usage_reset_ms
	const quota_hold =
		reset_ms === undefined ? undefined : { reset_ms, parked: local.usage_parked ?? 0 }

	return {
		machine: state.gauges,
		usages: state.usages,
		budget_waits: state.budget_waits,
		quotas: state.quotas,
		quota_hold,
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
		read_error: state.read_error,
		is_plan_loading: state.plan_fetch !== undefined,
		...gauges_of(state, local),
		form: redraw.ports.form,
		repo: state.plan?.context.repo,
		spinner: redraw.ports.is_tty ? SPOT : undefined,
		...links_of(state.plan?.context.repo, redraw.ports.link),
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
	const layout = layout_for(state, local, redraw.now_ms)
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

	return draw_run(thanked, local, { ports, now_ms })
}

const run_board_tick = {
	FRESH_STATE,
	PLAN_RETRY_MS,
	REDRAW_MS,
	tick,
}

export { run_board_tick }
