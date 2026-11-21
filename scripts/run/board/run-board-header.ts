import { styleText } from 'node:util'
import type { BudgetWait } from '#scripts/gate/core-wait'
import type { LaneAnswer } from '#scripts/lane/lane-capacity'
import type { RunActivity } from './run-board-activity'
import { run_board_estimate } from './run-board-estimate'
import { run_board_faint } from './run-board-faint'
import { run_board_fit } from './run-board-fit'
import type { FoundOf } from './run-board-found'
import { run_board_header_defcon } from './run-board-header-defcon'
import { run_board_header_names, type RunMark } from './run-board-header-names'
import { run_board_header_notice, type Notice } from './run-board-header-notice'
import { run_board_header_parts } from './run-board-header-parts'
import { run_board_header_time } from './run-board-header-time'
import { run_board_issue_count, type IssueCount } from './run-board-issue-count'
import { run_board_labels } from './run-board-labels'
import type { LaneTotals } from './run-board-lane-totals'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_length } from './run-board-length'
import type { BoardLinks } from './run-board-link'
import { run_board_machine, type MachineGauges } from './run-board-machine'
import { run_board_now, type NowLine } from './run-board-now'
import type { SessionOperations } from './run-board-operation-read'
import { run_board_priority } from './run-board-priority'
import type { ProcessGroups } from './run-board-process-groups'
import type { QuotaHold, QuotaView } from './run-board-render-quota'
import { run_board_render_slot } from './run-board-render-slot'
import { run_board_render_title } from './run-board-render-title'
import { run_board_row_key } from './run-board-row-key'
import type { SeatRead } from './run-board-seat'
import { run_board_setup } from './run-board-setup'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import type { LaneUsages, UsageScale } from './run-board-usage'
import type { UsualTimes } from './run-board-usual'

// The top of `run:board`: whether the run is moving, how long it has run, how fresh its last event is,
// and how far through the plan it is. Every time comes from a record (the carry's start, the stream's
// events); nothing here guesses one, but the estimated finish after the progress bar, which is drawn `~`
// as the estimate it is (`run-board-estimate.ts`). Two lines of symbols rather than sentences: the `⏰`
// that moves every second is the proof the board is live, so no `updated` line is drawn. **Always three
// lines, the first two in three columns**: the run's mark and the board's name over the kit version over
// the repository (`run-board-header-names.ts`), the run's age, then the progress over the machine the
// run is on and the notice slot (`run-board-header-notice.ts`) — so the first line reads as how far the
// run is and the second as what it runs on and what holds, a slow run apart from a stuck one. The third
// says what the run is doing now (`run-board-now.ts`): the spinner, its time and its kind's icon under
// the second and third columns' icons and digits, so the mark itself never turns. All three are written
// the same while the run works and while it waits, so a wait is read off the mark, the notice slot and the
// third line's words rather than off a line that changes shape. A value not read yet is drawn `-`, never
// `0`, so a header still loading reads as unknown rather than as an empty run.

const { HEADER_ICONS, STATE_ICONS, bar_of, minute_of } = run_board_labels
const { cell_of } = run_board_render_slot
const { title_of } = run_board_render_title
const { now_text, time_parts } = run_board_header_time
// The columns a failed read's reason is cut to, so the header keeps its line.
const REASON_LIMIT = 40
const UNKNOWN = '-'
// The age of a saved plan (joshuafolkken/kit#8219); a theme draws it as its glyph table says.
const SAVED_ICON = '🕘'
const { GAP, PERCENT_WIDTH } = run_board_machine

// Who reads the frame: a person on a screen, or a chat a session answers a progress question in, which
// draws what the screen does but for the machine, its memory alone — a CPU or swap figure read once
// means nothing.
type BoardForm = 'screen' | 'chat'

// What the lane cells and the processes section are drawn from, and the machine a gauge's width
// stands for.
interface BoardUsage {
	lanes: LaneUsages
	processes: ProcessGroups
	scale: UsageScale
}

// Claude's and Codex's usage-limit windows and GitHub's core rate limit are the usage row's
// (`run-board-render-quota.ts`). Its links are made where the terminal opens one (`run-board-link.ts`).
interface BoardHeader
	extends Pick<QuotaView, 'quotas' | 'scheduler_provider' | 'rate_limit'>, BoardLinks {
	now_ms: number
	// A single run's name (`run-board-single.ts`); `undefined` draws the board's
	// (`run-board-header-names.ts`).
	run_name?: string | undefined
	// The kit version the run's supervisor recorded; `undefined` draws `-`.
	kit_version?: string | undefined
	// The live board's sound switch and its last notice, drawn at the second line's end
	// (`run-board-header-notice.ts`); `undefined` where no key is read.
	is_sound_on?: boolean | undefined
	notice?: Notice | undefined
	started_ms: number
	// Set once the run has ended: the title then says when, and how long it took.
	ended_ms: number | undefined
	activity: RunActivity
	// The newest operation of each session of the run, `undefined` where none was read.
	operations?: SessionOperations | undefined
	layout: BoardLayout | undefined
	// The total the board first saw, so arrivals since then read as `(+N)`.
	baseline_total: number | undefined
	plan_fetched_ms: number | undefined
	// When the plan drawn was read, while it is the one a live board saved before it opened
	// (`run-board-tick-draw.ts`); none once a fresh plan lands (joshuafolkken/kit#8219).
	plan_saved_ms?: number | undefined
	plan_failed_ms: number | undefined
	// Why the plan read failed, said as a finding (`run-board-standing.ts`).
	plan_error?: string | undefined
	// When the reads off this machine last failed (`run-board-gather-thread.ts`); none once they answer.
	read_failed_ms?: number | undefined
	// Why they failed, drawn beside the failure.
	read_error?: string | undefined
	// Whether a plan read is in flight.
	is_plan_loading: boolean
	// The machine's gauges, `undefined` before the first sample.
	machine: MachineGauges | undefined
	// Each running lane's and each process group's usage, `undefined` where none could be read.
	usages?: BoardUsage | undefined
	// The claims waiting in the machine-wide core budget (`run-board-render-waits.ts`).
	budget_waits?: ReadonlyArray<BudgetWait> | undefined
	// The usage limit or authentication failure holding the run's launches; `undefined` where none holds.
	quota_hold?: QuotaHold | undefined
	// How long each phase usually takes; a running row's phase time is colored against it.
	usual?: UsualTimes | undefined
	// How long lanes took from dispatch to merge, which the estimated finish is drawn from.
	lane_totals?: LaneTotals | undefined
	// How many lanes the run may hold at once, which the estimated finish stacks the waiting children on.
	lane_limit?: number | undefined
	// The slots occupied according to the same capacity read that supplies the limit.
	occupied_count?: number | undefined
	lane_capacity?: LaneAnswer | undefined
	// What explains the seats no lane holds (`run-board-seat.ts`).
	seats?: SeatRead | undefined
	// What each done row says after its time (`run-board-found.ts`); none where nothing was read.
	found?: FoundOf | undefined
	// Whether `JOSH_LANE_INVESTIGATION` is on; off, a merged row hides its minutes and investigation
	// (joshuafolkken/kit#5132, joshuafolkken/kit#5194).
	is_investigation_on: boolean
	// The spinner's frame a running run and a running row turn, `undefined` where the output is not a
	// terminal and they draw their still icons.
	spinner: string | undefined
	// Whether each issue row leads its text with its key (`run-board-row-key.ts`) — only where the board
	// types the rows that appear, so every other frame is drawn as it was.
	is_keyed?: boolean | undefined
	// The theme the frame is drawn in, whose alert display ends the first line (`run-board-theme-defs.ts`).
	theme?: Theme | undefined
	form: BoardForm
	// The repository the plan was read for, as `owner/repo`; `undefined` before a plan is read.
	repo: string | undefined
	// The repository's open and closed issues, `undefined` where none was read.
	issue_count?: IssueCount | undefined
}

// What the run's mark is read off: no port, so a frame's data decides it before it is drawn.
type MarkHeader = Pick<BoardHeader, 'activity' | 'layout'>

interface BoardCounts {
	total: number
	settled: number
	parked: number
	running: number
	remaining: number
}

function count_state(rows: ReadonlyArray<BoardRow>, state: BoardRow['state']): number {
	return rows.filter((row) => row.state === state).length
}

function counts_of(layout: BoardLayout): BoardCounts {
	const total = run_board_layout.rows_of(layout).length
	const parked = count_state(layout.active, 'parked')
	const settled = layout.active.filter((row) => run_board_layout.is_settled(row.state)).length
	const running = count_state(layout.active, 'running')

	return { total, settled, parked, running, remaining: total - settled - running }
}

// Nothing running: the run is at work on a stage of its own; else it is waiting on a person when all
// the plan has left is what `needs-decision` holds, or idle.
function quiet_mark(header: MarkHeader): RunMark {
	const { activity, layout } = header
	if (run_board_setup.is_working(activity.setup, activity.is_setup_working)) return 'setup'

	return layout?.queued.length === 0 && run_board_layout.people_of(layout).length > 0
		? 'human'
		: 'idle'
}

// The run's state, each state overriding the ones below it.
function mark_of(header: MarkHeader, running: number): RunMark {
	if (header.activity.is_stopped) return 'stopped'

	return running > 0 ? 'running' : quiet_mark(header)
}

// A read is said only when it failed — the board otherwise keeps quiet about a routine read — and why,
// where that is known, cut so it never pushes the line past its pane.
function warning_of(word: string, failed: number | undefined, reason?: string): string | undefined {
	if (failed === undefined) return undefined
	const why = reason === undefined || reason === '' ? '' : ` ${title_of(reason, REASON_LIMIT)}`

	return styleText('yellow', `${HEADER_ICONS.warning} ${word} ${minute_of(failed)}${why}`)
}

// A plan read in flight turns the spinner after ⏳ and says nothing more; a
// frame that is not a terminal's has no spinner, and draws nothing for it.
function loading_part(header: BoardHeader): string | undefined {
	const { is_plan_loading, spinner } = header

	return is_plan_loading && spinner !== undefined ? `${HEADER_ICONS.loading} ${spinner}` : undefined
}

function layout_of(header: MarkHeader): BoardLayout {
	return header.layout ?? run_board_layout.EMPTY_LAYOUT
}

// The run's state as the header's first line draws it, for a reader outside the frame.
function run_mark_of(header: MarkHeader): RunMark {
	return mark_of(header, counts_of(layout_of(header)).running)
}

// Whether the plan has been read: until it has, the board draws the run's own children alone, and the
// counts only the plan knows — the total and what waits — are unknown.
function is_plan_read(header: BoardHeader): boolean {
	return header.plan_fetched_ms !== undefined
}

// Arrivals since the board first looked, as `(+N)`.
function plus_of(counts: BoardCounts, header: BoardHeader): string {
	const added = counts.total - (header.baseline_total ?? counts.total)

	return added > 0 ? ` (+${String(added)})` : ''
}

// The plan's total as the tally draws it, unknown until the plan is read.
function total_of(counts: BoardCounts, header: BoardHeader): string {
	return is_plan_read(header) ? String(counts.total) : UNKNOWN
}

// The width the tally and the machine's first figure are both right-aligned to — the wider of a full
// tally and a full percent — so the progress bar and the gauge under it start in one column, and
// neither moves as a count or a percent gains a digit.
function figure_width(total: string): number {
	return Math.max(PERCENT_WIDTH, `${total}/${total}`.length)
}

// Icon, figure, then bar, as the machine gauges. Arrivals since the board first looked follow the
// bar, where they cannot move it.
function tally_part(counts: BoardCounts, header: BoardHeader): string {
	const { settled } = counts
	const total = total_of(counts, header)
	const tally = `${String(settled)}/${total}`.padStart(figure_width(total))
	const bar = is_plan_read(header) ? bar_of(settled, counts.total) : bar_of(0, 0)

	return `${STATE_ICONS.merged} ${tally} ${bar}`
}

// The estimated finish after the bar (`run-board-estimate.ts`), once the plan says what is left to run.
// A stopped run advances nothing, so an estimate would count down to a finish that never comes.
function estimate_part(header: BoardHeader): string | undefined {
	const is_moving = is_plan_read(header) && !header.activity.is_stopped

	return is_moving ? run_board_estimate.part_of(header) : undefined
}

// The ⏳ count with the priorities among it (joshuafolkken/kit#4383).
function waiting_of(counts: BoardCounts, header: BoardHeader): string {
	return `${String(counts.remaining)}${run_board_priority.tally_of(layout_of(header))}`
}

// A figure only the plan knows, drawn faint while the plan is a saved one.
function planned(header: BoardHeader, part: string | undefined): string | undefined {
	if (part === undefined || header.plan_saved_ms === undefined) return part

	return run_board_faint.faint(part)
}

function progress_parts(counts: BoardCounts, header: BoardHeader): Array<string | undefined> {
	const is_read = is_plan_read(header)

	return [
		planned(header, `${tally_part(counts, header)}${is_read ? plus_of(counts, header) : ''}`),
		planned(header, estimate_part(header)),
		`${STATE_ICONS.running} ${String(counts.running)}`,
		planned(header, `${STATE_ICONS.waiting} ${is_read ? waiting_of(counts, header) : UNKNOWN}`),
		`${STATE_ICONS.parked} ${String(counts.parked)}`,
	]
}

// How long ago the saved plan drawn was read, last on the line, so nothing moves as it goes.
function saved_part(header: BoardHeader): string | undefined {
	const { plan_saved_ms } = header

	return plan_saved_ms === undefined
		? undefined
		: `${SAVED_ICON} ${run_board_length.span_of(header.now_ms - plan_saved_ms)}`
}

// The alert level a themed screen ends the progress line on, drawn as the theme's row says.
function alert_part(header: BoardHeader): string | undefined {
	if (header.theme === undefined || header.form !== 'screen') return undefined

	return run_board_theme_defs.THEME_DEFS[header.theme].alert(
		run_board_header_defcon.level_of(header),
	)
}

// The run's progress, then a plan read in flight, then the alert level; a failing read is said in the
// notice slot (`run-board-standing.ts`).
function progress_part(counts: BoardCounts, header: BoardHeader): string {
	const parts = [
		...progress_parts(counts, header),
		loading_part(header),
		run_board_issue_count.part_of(header.repo, header.issue_count, header.repo_link),
		alert_part(header),
		saved_part(header),
	]

	return run_board_header_parts.keyed_progress(
		header,
		parts.filter((part) => part !== undefined).join(GAP),
	)
}

// The children drawn as running, with the root checkout's single run beside them (joshuafolkken/kit#8482):
// only their operations are the run's newest.
function running_issues(layout: BoardLayout): ReadonlySet<number> {
	const rows = layout.root === undefined ? layout.active : [...layout.active, layout.root.row]
	const running = rows.filter((row) => row.state === 'running')

	return new Set(running.map((row) => row.number))
}

// What the run is doing now (`run-board-now.ts`).
function now_line(counts: BoardCounts, header: BoardHeader): NowLine | undefined {
	return run_board_now.line_of({
		now_ms: header.now_ms,
		ended_ms: header.ended_ms,
		activity: header.activity,
		lane_capacity: header.lane_capacity,
		operations: header.operations,
		children: running_issues(layout_of(header)),
		running: counts.running,
		waiting: is_plan_read(header) ? counts.remaining : undefined,
		people: run_board_layout.people_of(layout_of(header)).length,
	})
}

// The gauges the machine line draws: every one on a screen, the memory alone in a chat.
function machine_of(header: BoardHeader): MachineGauges | undefined {
	const { machine } = header

	if (machine === undefined || header.form === 'screen') return machine

	return { ...machine, cpu_percent: undefined, swap_mb_per_s: undefined }
}

// The machine before a gauge could be read: each gauge's icon, its figure unknown, apart as the gauges.
const MACHINE_UNKNOWN = [HEADER_ICONS.cpu, HEADER_ICONS.memory, HEADER_ICONS.swap]
	.map((icon) => `${icon} ${UNKNOWN}`)
	.join(GAP)

// The machine the run is on, its first figure as wide as the tally over it, then the notice slot.
function machine_part(counts: BoardCounts, header: BoardHeader): string {
	const width = figure_width(total_of(counts, header))
	const machine = run_board_machine.line_of(machine_of(header), width) ?? MACHINE_UNKNOWN

	return [machine, run_board_header_notice.part_of(header)].join(GAP)
}

// The lines' cells of one column, the narrower padded to the wider as the terminal counts them.
function column_of(cells: ReadonlyArray<string>): Array<string> {
	const width = Math.max(...cells.map((cell) => run_board_fit.width_of(cell)))

	return cells.map((cell) => cell_of(cell, width))
}

// The board's name, the run's age and progress, then the kit version, an ended run's end and machine under
// them, then the repository and what the run is doing now — its time under theirs, its kind's icon
// under the `💪`, no label — in every state the board can be in. A stream with no event yet leaves the
// repository alone on the third line.
function header_lines(header: BoardHeader): Array<string> {
	const counts = counts_of(layout_of(header))
	const mark = mark_of(header, counts.running)
	const now = now_line(counts, header)
	const name_cells = run_board_header_names.names_of(mark, header)
	const names = column_of(name_cells)
	const times = column_of(time_parts(header, mark, now))
	const lasts = [progress_part(counts, header), machine_part(counts, header)]
	const third =
		now === undefined
			? (name_cells.at(-1) ?? '')
			: [names.at(-1), times.at(-1), now_text(now, header)].join(GAP)

	return [...lasts.map((last, line) => [names[line], times[line], last].join(GAP)), third]
}

// The third line's kind as the legend names it, `undefined` where the line's own words name it.
function now_legend(header: BoardHeader): string | undefined {
	const now = now_line(counts_of(layout_of(header)), header)

	return now?.legend === undefined ? undefined : `${now.icon} ${now.legend}`
}

// The estimated finish as the legend names it, on a frame that draws it alone.
function estimate_legend(header: BoardHeader): string | undefined {
	return estimate_part(header) === undefined ? undefined : run_board_estimate.LEGEND
}

// The key the third line's words carry where the board types rows (`run-board-header-time.ts`), so a
// frame knows them typed; none while the line names no words.
function now_key(header: BoardHeader): string | undefined {
	const now = now_line(counts_of(layout_of(header)), header)

	return now === undefined ? undefined : run_board_row_key.key_of('now', now.text)
}

// The third line's icon, so the legend names the phase it draws.
function now_icon(header: BoardHeader): string | undefined {
	return now_line(counts_of(layout_of(header)), header)?.icon
}

const run_board_header = {
	counts_of,
	estimate_legend,
	header_lines,
	is_plan_read,
	now_icon,
	now_key,
	now_legend,
	run_mark_of,
	warning_of,
}

export { run_board_header }
export type { BoardCounts, BoardForm, BoardHeader, BoardUsage, MarkHeader }
