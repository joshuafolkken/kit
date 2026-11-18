import { lane_investigation_switch } from '#scripts/lane/lane-investigation-switch'
import { run_board_activity, type RunActivity } from './run-board-activity'
import type { ClosedIssue } from './run-board-closed'
import type { FrameBounds } from './run-board-fold'
import { run_board_github } from './run-board-github'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_notes, type Titles } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_render } from './run-board-render'
import { run_board_root_layout } from './run-board-root-layout'
import { run_board_seat, type SeatRead } from './run-board-seat'
import { run_board_setup } from './run-board-setup'
import type { Known } from './run-board-snapshot'
import { run_board_spin, type Spun } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'

// The frame one `run:board` redraw draws (`run-board-tick.ts`): the header over the laid-out rows, the
// notes under them, written with its spinners at this moment's frame.

const { SPOT } = run_board_spin
const { known_of } = run_board_github

// The titles and labels with a closed child's under the listing's own.
function closed_under(known: Known, closed: ReadonlyMap<number, ClosedIssue>): Known {
	const closed_titles = [...closed].map(([issue, { title }]) => [issue, title] as const)
	const closed_labels = [...closed].map(([issue, { labels }]) => [issue, labels] as const)

	return {
		titles: new Map([...closed_titles, ...known.titles]),
		labels: new Map([...closed_labels, ...known.labels]),
	}
}

// The titles the findings name a parked issue by — the rows' own; the snapshot's before the plan is
// read.
function titles_of(state: BoardState): Titles {
	return closed_under(known_of(state), state.closed).titles
}

// A run `run:carry --end` closed and one nobody drives any more are both drawn as stopped.
function activity_here(local: LocalRead): RunActivity {
	const activity = run_board_activity.activity_of(
		local.events,
		local.ended_ms !== undefined || local.is_stranded,
	)

	return {
		...activity,
		is_setup_working: run_board_setup.is_working(activity.setup, local.is_session_active),
	}
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
	| 'run_name'
	| 'kit_version'
	| 'started_ms'
	| 'ended_ms'
	| 'activity'
	| 'operations'
	| 'usual'
	| 'lane_totals'
	| 'lane_limit'
	| 'occupied_count'
	| 'found'
	| 'scheduler_provider'
	| 'is_investigation_on'
>

function local_header(local: LocalRead): LocalHeader {
	return {
		run_name: local.run_name,
		kit_version: local.kit_version,
		started_ms: local.started_ms,
		ended_ms: local.ended_ms,
		activity: activity_here(local),
		operations: local.operations,
		usual: local.usual,
		lane_totals: local.lane_totals,
		lane_limit: local.lane_limit,
		occupied_count: local.occupied_count,
		found: local.found,
		scheduler_provider: local.scheduler_provider,
		is_investigation_on: lane_investigation_switch.is_on(),
	}
}

type Gauges = Pick<
	BoardHeader,
	'machine' | 'usages' | 'budget_waits' | 'quotas' | 'quota_hold' | 'rate_limit' | 'issue_count'
>

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
		rate_limit: state.rate_limit,
		issue_count: state.issue_count,
	}
}

// The empty seats' read once the plan names the rows that could take them, and while the run drives.
function seats_of(state: BoardState, local: LocalRead): SeatRead | undefined {
	if (state.plan === undefined || activity_here(local).is_stopped) return undefined

	return run_board_seat.read_of(local.events, local.launch_hold)
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
		seats: seats_of(state, local),
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
		...run_board_link.links_of(state.plan?.context.repo, redraw.ports.link),
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
		throughput: local.throughput,
		thanks: state.thanks,
		link: redraw.ports.link,
		...bounds,
	})

	return run_board_spin.spun(lines, run_board_labels.spinner_of(redraw.now_ms), bounds.size)
}

function draw(ports: BoardPorts, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The run's frame over `run_layout`, the run's own rows. The first total the plan gives is the baseline
// every later arrival is counted against; the run's own children before it are no total. The root
// checkout's single runs are laid over the run's.
function draw_run(
	state: BoardState,
	local: LocalRead,
	redraw: Redraw,
	run_layout: BoardLayout,
): BoardState {
	const read = closed_under(known_of(state), state.closed)
	const layout = run_board_root_layout.layout_of(run_layout, local, read)
	const first_total =
		state.plan === undefined ? undefined : run_board_header.counts_of(run_layout).total
	const settled = { ...state, baseline_total: state.baseline_total ?? first_total }
	const baseline_total = run_board_root_layout.baseline_of(
		settled.baseline_total,
		run_layout,
		layout,
	)
	const { lines, spots } = frame_of({ ...settled, baseline_total }, local, layout, redraw)

	draw(redraw.ports, lines)

	return { ...settled, spots }
}

const run_board_tick_draw = { activity_here, bounds_of, closed_under, draw, draw_run }

export { run_board_tick_draw }
