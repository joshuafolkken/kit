import { styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { backlog_idle, type IdleWindow } from '#scripts/backlog/backlog-idle'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_machine, type MachineGauges } from './run-board-machine'
import type { RunActivity } from './run-board-status'
import type { LaneUsages } from './run-board-usage'

// The top of `run:board`: whether the run is moving, how long it has run, how long it has left, how
// fresh its last event is, and how far through the plan it is — and, while it waits on an empty
// backlog, until when it waits and what ends the wait. Every time comes from a record (the carry's
// start, the stream's events, the `idle` window); nothing here guesses one. Lines of symbols rather
// than sentences: the `⏱` that moves every second is the proof the board is live, so no `updated`
// line is drawn. Beside the time, the machine the run is on, so a slow run reads apart from a stuck
// one. **Always two lines**: the run's state with its progress, then the time with the machine. A
// value not read yet is drawn `-`, never `0`, so a header still loading reads as unknown rather than
// as an empty run.

const { HEADER_ICONS, STATE_ICONS, WORDS, bar_of, clock_of, elapsed_of, left_of, minute_of } =
	run_board_labels
const UNKNOWN = '-'
const { GAP } = run_board_machine
// A running run whose newest event is older than this is drawn as stale, so a hang stands out; past
// twice that it is drawn as alarming.
const STALE_MINUTES = 15
const STALE_MS = STALE_MINUTES * backlog_budget.MS_PER_MINUTE
const ALARM_FACTOR = 2
const ALARM_MS = STALE_MS * ALARM_FACTOR
const INDENT = '  '
const RUN_NAME = 'backlogrun'

// Who reads the frame: a person on a screen, or a chat a session answers a progress question in, which
// draws what the screen does but for the machine, its memory alone — a CPU or swap figure read once
// means nothing.
type BoardForm = 'screen' | 'chat'

interface BoardHeader {
	now_ms: number
	started_ms: number
	// Set once the run has ended: the title then says when, and how long it took.
	ended_ms: number | undefined
	activity: RunActivity
	layout: BoardLayout | undefined
	// The total the board first saw, so arrivals since then read as `(+N)`.
	baseline_total: number | undefined
	plan_fetched_ms: number | undefined
	plan_failed_ms: number | undefined
	// Whether a plan read is in flight.
	is_plan_loading: boolean
	// The machine's gauges, `undefined` before the first sample.
	machine: MachineGauges | undefined
	// Each running lane's CPU and memory, `undefined` where none could be read.
	usages?: LaneUsages | undefined
	// The spinner's frame a running run and a running row turn, `undefined` where the output is not a
	// terminal and they draw their still icons.
	spinner: string | undefined
	form: BoardForm
	// An issue reference as the board draws it — `3450` or `owner/repo#12` — made a link where the
	// terminal opens one.
	link: (reference: string) => string
}

interface BoardCounts {
	total: number
	settled: number
	parked: number
	running: number
	remaining: number
}

type RunMark = 'running' | 'idle' | 'human' | 'stopped'

type TextColor = Parameters<typeof styleText>[0]

// The run's state as a colored glyph before its name.
const RUN_MARKS: Readonly<Record<RunMark, { glyph: string; color: TextColor }>> = {
	running: { glyph: '▶', color: 'green' },
	idle: { glyph: '⏸', color: 'yellow' },
	human: { glyph: '✋', color: 'magenta' },
	stopped: { glyph: '■', color: 'gray' },
}

function count_state(rows: ReadonlyArray<BoardRow>, state: BoardRow['state']): number {
	return rows.filter((row) => row.state === state).length
}

function counts_of(layout: BoardLayout): BoardCounts {
	const total = run_board_layout.rows_of(layout).length
	const parked = count_state(layout.active, 'parked')
	const settled = count_state(layout.active, 'merged') + parked + count_state(layout.active, 'done')
	const running = count_state(layout.active, 'running')

	return { total, settled, parked, running, remaining: total - settled - running }
}

// Nothing running: the run is waiting on a person when all the plan has left is what
// `needs-decision` holds, and otherwise idle.
function quiet_mark(layout: BoardLayout | undefined): RunMark {
	return layout?.waves.length === 0 && layout.people.length > 0 ? 'human' : 'idle'
}

// The run's state, each state overriding the ones below it.
function mark_of(header: BoardHeader, running: number): RunMark {
	if (header.activity.is_stopped) return 'stopped'
	if (running > 0) return 'running'

	return header.activity.idle === undefined ? quiet_mark(header.layout) : 'idle'
}

// A running run turns the spinner in place of ▶, both one column wide; every other mark stands still.
function run_part(mark: RunMark, spinner: string | undefined): string {
	const { glyph, color } = RUN_MARKS[mark]
	const shown = mark === 'running' ? (spinner ?? glyph) : glyph

	return styleText(color, `${shown} ${RUN_NAME}`)
}

function aged(part: string, age_ms: number): string {
	if (age_ms > ALARM_MS) return styleText('red', part)

	return age_ms > STALE_MS ? styleText('yellow', part) : part
}

// How long ago the stream last moved; only a running run can be stale, so only it is colored. An ended
// run has no heartbeat to keep: one counting on would read as a hang.
function heartbeat_part(header: BoardHeader, mark: RunMark): string | undefined {
	const last = header.activity.last_event_ms

	if (last === undefined || header.ended_ms !== undefined) return undefined

	const age = header.now_ms - last
	const part = `💓 ${elapsed_of(age)}`

	return mark === 'running' ? aged(part, age) : part
}

// A plan fetch is said only when it failed — the board otherwise keeps quiet about a routine read.
function plan_warning(header: BoardHeader): string | undefined {
	const failed = header.plan_failed_ms

	if (failed === undefined) return undefined

	return styleText('yellow', `⚠ ${WORDS.plan} ${minute_of(failed)}`)
}

// A plan read in flight turns the spinner after ⏳ and says nothing more; a
// frame that is not a terminal's has no spinner, and draws nothing for it.
function loading_part(header: BoardHeader): string | undefined {
	const { is_plan_loading, spinner } = header

	return is_plan_loading && spinner !== undefined ? `${HEADER_ICONS.loading} ${spinner}` : undefined
}

// A running run's age and time left before the cut-off, or an ended run's frozen duration and the
// minute it ended — an ended run has no cut-off left.
function time_parts(header: BoardHeader): Array<string> {
	const { now_ms, started_ms, ended_ms } = header

	if (ended_ms !== undefined) {
		return [
			`⏱ ${elapsed_of(ended_ms - started_ms)}`,
			`${HEADER_ICONS.ended} ${minute_of(ended_ms)}`,
		]
	}

	const cutoff = started_ms + backlog_budget.WHOLE_RUN_BUDGET_MS

	return [`⏱ ${elapsed_of(now_ms - started_ms)}`, `⌛ ${left_of(cutoff - now_ms)}`]
}

function layout_of(header: BoardHeader): BoardLayout {
	return header.layout ?? run_board_layout.EMPTY_LAYOUT
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

// Icon, figure, then bar, as the machine gauges: the settled count is right-aligned to the total's
// width, so the bar starts in one column as the count grows. Arrivals since the board first looked
// follow the bar, where they cannot move it.
function tally_part(counts: BoardCounts, is_read: boolean): string {
	const { settled } = counts
	const total = is_read ? String(counts.total) : UNKNOWN
	const tally = `${String(settled)}/${total}`.padStart(`${total}/${total}`.length)
	const bar = is_read ? bar_of(settled, counts.total) : bar_of(0, 0)

	return `${STATE_ICONS.merged} ${tally} ${bar}`
}

function progress_parts(counts: BoardCounts, header: BoardHeader): Array<string> {
	const is_read = is_plan_read(header)

	return [
		`${tally_part(counts, is_read)}${is_read ? plus_of(counts, header) : ''}`,
		`${STATE_ICONS.running} ${String(counts.running)}`,
		`${STATE_ICONS.waiting} ${is_read ? String(counts.remaining) : UNKNOWN}`,
		`${STATE_ICONS.parked} ${String(counts.parked)}`,
	]
}

// The run's mark and its progress, then how fresh its stream is and what its plan read is doing.
function state_line(counts: BoardCounts, header: BoardHeader): string {
	const mark = mark_of(header, counts.running)
	const parts = [
		run_part(mark, header.spinner),
		...progress_parts(counts, header),
		heartbeat_part(header, mark),
		loading_part(header),
		plan_warning(header),
	]

	return parts.filter((part) => part !== undefined).join(GAP)
}

function idle_line(idle: IdleWindow, now_ms: number): string {
	const ending = idle.bound === 'idle' ? WORDS.idle_end_idle : WORDS.idle_end_run
	const left = `${elapsed_of(idle.until_ms - now_ms)} ${WORDS.idle_left}`
	const until = `${WORDS.idle_until} ${clock_of(idle.until_ms)} (${left}) → ${ending}`
	const next_check = `${WORDS.next_check} ${clock_of(backlog_idle.next_check_ms(idle))}`

	return `${INDENT}${RUN_MARKS.idle.glyph} ${until} · ${next_check}`
}

// The wait, under the header's blank line, drawn only while it is what the run is doing: no child
// running and the run not ended. The children running are the run's own, read
// locally, so a board still waiting on GitHub never draws a running run as waiting.
function idle_lines(header: BoardHeader): Array<string> {
	const { idle, is_stopped } = header.activity

	if (is_stopped || idle === undefined || counts_of(layout_of(header)).running > 0) return []

	return ['', idle_line(idle, header.now_ms)]
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

// The time, then the machine the run is on.
function clock_line(header: BoardHeader): string {
	const machine = run_board_machine.line_of(machine_of(header)) ?? MACHINE_UNKNOWN

	return [...time_parts(header), machine].join(GAP)
}

// The run's state with its progress, then the time with the machine, in every state the board can be in.
function header_lines(header: BoardHeader): Array<string> {
	return [state_line(counts_of(layout_of(header)), header), clock_line(header)]
}

const run_board_header = { counts_of, header_lines, idle_lines, is_plan_read }

export { run_board_header }
export type { BoardCounts, BoardForm, BoardHeader }
