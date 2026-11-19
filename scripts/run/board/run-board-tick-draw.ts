import { lane_investigation_switch } from '#scripts/lane/lane-investigation-switch'
import { run_board_activity, type RunActivity } from './run-board-activity'
import type { ClosedIssue } from './run-board-closed'
import { run_board_cue_decision } from './run-board-cue-decision'
import type { FrameBounds } from './run-board-fold'
import { run_board_github } from './run-board-github'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_notes, type BoardNote, type Titles } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_render } from './run-board-render'
import { run_board_root_layout } from './run-board-root-layout'
import { run_board_row_sections } from './run-board-row-sections'
import { run_board_seat, type SeatRead } from './run-board-seat'
import { run_board_setup } from './run-board-setup'
import type { Known } from './run-board-snapshot'
import { run_board_spin, type Spun } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

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
		reset_ms === undefined
			? undefined
			: { reset_ms, parked: local.usage_parked ?? 0, cause: local.usage_cause }

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

	return run_board_seat.read_of(local.events, local.launch_hold, local.usage_cause)
}

// A run's header, always over its laid-out rows.
type LaidHeader = BoardHeader & { layout: BoardLayout }

type PortHeader = Pick<BoardHeader, 'form' | 'spinner' | 'is_keyed' | 'is_themed' | 'is_sound_on'>

// What the header reads off the board's own ports: only a live board reads the sound switch.
function port_header(ports: BoardPorts): PortHeader {
	return {
		form: ports.form,
		spinner: ports.is_tty ? SPOT : undefined,
		is_keyed: ports.types_rows,
		is_themed: ports.is_themed,
		is_sound_on: ports.sound?.(),
	}
}

function header_of(
	state: BoardState,
	local: LocalRead,
	layout: BoardLayout,
	redraw: Redraw,
): LaidHeader {
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
		repo: state.plan?.context.repo,
		...port_header(redraw.ports),
		...run_board_link.links_of(state.plan?.context.repo, redraw.ports.link),
	}
}

// The pane a live frame is kept within and the footer it ends on, read at every redraw.
function bounds_of(ports: BoardPorts): FrameBounds {
	return { size: ports.size?.(), footer: ports.footer, folded: ports.folded?.() }
}

// A drawn frame and every note it was drawn from — shown or not (joshuafolkken/kit#8117).
type Drawn = Spun & { notes: ReadonlyArray<BoardNote> }

// The frame under `header` with its spinners drawn at this moment's frame, and where they are on screen.
function frame_of(state: BoardState, local: LocalRead, header: LaidHeader, redraw: Redraw): Drawn {
	const bounds = bounds_of(redraw.ports)
	const notes = run_board_notes.notes_of(
		local.events,
		titles_of(state),
		run_board_layout.listed_parks(header.layout),
	)
	const lines = run_board_render.render({
		header,
		notes,
		resume: local.resume,
		throughput: local.throughput,
		thanks: state.thanks,
		link: redraw.ports.link,
		...bounds,
	})
	const spun = run_board_spin.spun(lines, run_board_labels.spinner_of(redraw.now_ms), bounds.size)

	return { ...spun, notes }
}

// The rows this frame types where the board types them; a frame before the plan is read is no base — the
// rows the plan brings were already there — so the frame the plan arrives on is the first base. What
// counts as known is `run_board_row_sections.known_of`'s, over the notes the frame was drawn from.
function typing_of(
	state: BoardState,
	drawn: Pick<Drawn, 'keyed' | 'notes'>,
	header: LaidHeader,
	redraw: Redraw,
): Typing {
	const is_on = redraw.ports.types_rows === true && state.plan !== undefined
	const frame = { keyed: drawn.keyed, known: run_board_row_sections.known_of(header, drawn.notes) }

	return run_board_type_rows.next(state.typing, frame, redraw.now_ms, is_on)
}

function draw(ports: BoardPorts, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

type Sounded = Pick<BoardState, 'sound_snapshot' | 'sound_pending' | 'notice'>

// The cue `run_board_cue_decision.decided` picks for this frame, sounded through `cue` where the board
// passes one.
function sounded(
	state: BoardState,
	header: BoardHeader,
	local: LocalRead,
	redraw: Redraw,
): Sounded {
	const { cue, ...sound } = run_board_cue_decision.decided(
		state,
		header,
		local.events,
		redraw.now_ms,
	)

	if (cue !== undefined) redraw.ports.cue?.(cue)

	return sound
}

// The first total the plan gives is the baseline every later arrival is counted against; the run's own
// children before it are no total. The header counts the root checkout's single runs on top of it.
function baselines_of(
	state: BoardState,
	run_layout: BoardLayout,
	layout: BoardLayout,
): { settled: BoardState; baseline_total: number | undefined } {
	const first_total =
		state.plan === undefined ? undefined : run_board_header.counts_of(run_layout).total
	const settled = { ...state, baseline_total: state.baseline_total ?? first_total }
	const baseline_total = run_board_root_layout.baseline_of(
		settled.baseline_total,
		run_layout,
		layout,
	)

	return { settled, baseline_total }
}

// The run's frame over `run_layout`, the run's own rows, the root checkout's single runs laid over them.
function draw_run(
	state: BoardState,
	local: LocalRead,
	redraw: Redraw,
	run_layout: BoardLayout,
): BoardState {
	const read = closed_under(known_of(state), state.closed)
	const layout = run_board_root_layout.layout_of(run_layout, local, read)
	const { settled, baseline_total } = baselines_of(state, run_layout, layout)
	const laid = header_of({ ...settled, baseline_total }, local, layout, redraw)
	const sound = sounded(state, laid, local, redraw)
	const header = { ...laid, notice: sound.notice }
	const drawn = frame_of(settled, local, header, redraw)
	const typing = typing_of(state, drawn, header, redraw)

	draw(redraw.ports, run_board_type_rows.typed_lines(drawn.lines, typing, redraw.now_ms))

	return { ...settled, spots: drawn.spots, typing, ...sound }
}

const run_board_tick_draw = { activity_here, bounds_of, closed_under, draw, draw_run }

export { run_board_tick_draw }
