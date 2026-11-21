import { lane_investigation_switch } from '#scripts/lane/lane-investigation-switch'
import { run_board_activity, type RunActivity } from './run-board-activity'
import type { ClosedIssue } from './run-board-closed'
import { run_board_cue_decision } from './run-board-cue-decision'
import { run_board_github } from './run-board-github'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_layout, type BoardLayout } from './run-board-layout'
import type { BoardLinks } from './run-board-link'
import { run_board_notes, type BoardNote, type Titles } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_root_layout } from './run-board-root-layout'
import { run_board_seat, type SeatRead } from './run-board-seat'
import { run_board_setup } from './run-board-setup'
import type { Known } from './run-board-snapshot'
import type { CueName } from './run-board-sound-cues'
import type { BoardState } from './run-board-state'

// What one `run:board` frame shows, assembled from the reads before anything is drawn
// (joshuafolkken/kit#8158): the header's data over the laid-out rows, the notes, and the cue the frame
// decided. It holds no port and no function, and is not fitted to a width — the pane, the fold, the
// theme, the spinner, the links and the typing are the draw's (`run-board-tick-draw.ts`).

const { known_of } = run_board_github

// The header fields read off the board's own ports, which the draw adds.
type PortField = 'form' | 'spinner' | 'is_keyed' | 'theme' | 'is_sound_on' | keyof BoardLinks

type DisplayHeader = Omit<BoardHeader, PortField> & { layout: BoardLayout }

// What a frame carries to the next: the baseline the plan's first total set and the sound it decided.
type Carried = Pick<BoardState, 'baseline_total' | 'sound_snapshot' | 'sound_pending' | 'notice'>

interface BoardDisplay
	extends Pick<BoardState, 'thanks'>, Pick<LocalRead, 'resume' | 'throughput'> {
	header: DisplayHeader
	notes: ReadonlyArray<BoardNote>
	// The cue the frame sounds where the board sounds one.
	cue: CueName | undefined
	carried: Carried
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

function header_of(
	state: BoardState,
	local: LocalRead,
	layout: BoardLayout,
	now_ms: number,
): DisplayHeader {
	return {
		now_ms,
		...local_header(local),
		seats: seats_of(state, local),
		layout,
		baseline_total: state.baseline_total,
		plan_fetched_ms: state.fetched_ms,
		plan_failed_ms: state.failed_ms,
		plan_error: state.plan_error,
		read_failed_ms: state.read_failed_ms,
		read_error: state.read_error,
		is_plan_loading: state.plan_fetch !== undefined,
		...gauges_of(state, local),
		repo: state.plan?.context.repo,
	}
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
function assemble_display(
	state: BoardState,
	local: LocalRead,
	now_ms: number,
	run_layout: BoardLayout,
): BoardDisplay {
	const read = closed_under(known_of(state), state.closed)
	const layout = run_board_root_layout.layout_of(run_layout, local, read)
	const { settled, baseline_total } = baselines_of(state, run_layout, layout)
	const laid = header_of({ ...settled, baseline_total }, local, layout, now_ms)
	const { cue, ...sound } = run_board_cue_decision.decided(state, laid, local.events, now_ms)
	const parks = run_board_layout.listed_parks(layout)

	return {
		header: { ...laid, notice: sound.notice },
		notes: run_board_notes.notes_of(local.events, titles_of(state), parks),
		resume: local.resume,
		throughput: local.throughput,
		thanks: state.thanks,
		cue,
		carried: { baseline_total: settled.baseline_total, ...sound },
	}
}

const run_board_display = { activity_here, assemble_display, closed_under }

export { run_board_display }
export type { BoardDisplay, Carried, DisplayHeader }
