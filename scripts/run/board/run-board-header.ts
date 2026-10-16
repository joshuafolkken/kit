import { styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { run_board_fit } from './run-board-fit'
import { run_board_fresh } from './run-board-fresh'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_machine, type MachineGauges } from './run-board-machine'
import { run_board_now, type NowLine } from './run-board-now'
import type { SessionOperations } from './run-board-operation-read'
import { run_board_render_slot } from './run-board-render-slot'
import type { RunActivity } from './run-board-status'
import type { LaneUsages } from './run-board-usage'
import type { UsualTimes } from './run-board-usual'

// The top of `run:board`: whether the run is moving, how long it has run, how fresh its last event is,
// and how far through the plan it is. Every time comes from a record (the carry's start, the stream's
// events); nothing here guesses one. Two lines of symbols rather than sentences: the `⏰` that moves
// every second is the proof the board is live, so no `updated` line is drawn. **Always three lines,
// the first two in three columns**: the run's mark and name over its repository's, the run's age over
// the `💓`, then the progress over the machine the run is on — so the first line reads as how far the
// run is and the second as what it runs on, a slow run apart from a stuck one. The third says what the
// run is doing now (`run-board-now.ts`): the spinner, its time and its kind's icon under the second and
// third columns' icons and digits, so the mark itself never turns. All three are written the
// same while the run works and while it waits, so a wait is read off the mark, the `💓` and the third
// line's words rather than off a line that changes shape. A value not read yet is drawn `-`, never
// `0`, so a header still loading reads as unknown rather than as an empty run.

const { HEADER_ICONS, STATE_ICONS, WORDS, bar_of, minute_of, span_of } = run_board_labels
const { cell_of } = run_board_render_slot
const { padded } = run_board_fresh
const aged_fresh = run_board_fresh.aged
const UNKNOWN = '-'
const BLANK = ' '
const REPO_SEPARATOR = '/'
const { GAP, PERCENT_WIDTH } = run_board_machine
// A running run whose newest event is older than this is drawn as stale, so a hang stands out; past
// twice that it is drawn as alarming.
const STALE_MINUTES = 15
const STALE_MS = STALE_MINUTES * backlog_budget.MS_PER_MINUTE
const ALARM_FACTOR = 2
const ALARM_MS = STALE_MS * ALARM_FACTOR
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
	// The newest operation of each session of the run, `undefined` where none was read.
	operations?: SessionOperations | undefined
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
	// How long each phase usually takes; a running row's phase time is colored against it.
	usual?: UsualTimes | undefined
	// The spinner's frame a running run and a running row turn, `undefined` where the output is not a
	// terminal and they draw their still icons.
	spinner: string | undefined
	form: BoardForm
	// The repository the plan was read for, as `owner/repo`; `undefined` before a plan is read.
	repo: string | undefined
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

// `setup` is a run with no child running that is itself at work on a stage (`run-board-setup.ts`).
type RunMark = 'running' | 'setup' | 'idle' | 'human' | 'stopped'

type TextColor = Parameters<typeof styleText>[0]

// The run's state as a colored glyph before its name.
const RUN_MARKS: Readonly<Record<RunMark, { glyph: string; color: TextColor }>> = {
	running: { glyph: '▶', color: 'green' },
	setup: { glyph: '▶', color: 'green' },
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
	const settled = layout.active.filter((row) => run_board_layout.is_settled(row.state)).length
	const running = count_state(layout.active, 'running')

	return { total, settled, parked, running, remaining: total - settled - running }
}

// The marks of a run that is working: they turn the spinner, and only they can go stale.
const WORKING_MARKS: ReadonlySet<RunMark> = new Set<RunMark>(['running', 'setup'])

// Nothing running: the run is at work on a stage of its own; else it is waiting on a person when all
// the plan has left is what `needs-decision` holds, or idle.
function quiet_mark(header: BoardHeader): RunMark {
	const { layout } = header

	if (header.activity.setup !== undefined) return 'setup'

	return layout?.waves.length === 0 && layout.people.length > 0 ? 'human' : 'idle'
}

// The run's state, each state overriding the ones below it.
function mark_of(header: BoardHeader, running: number): RunMark {
	if (header.activity.is_stopped) return 'stopped'

	return running > 0 ? 'running' : quiet_mark(header)
}

// The mark stands still in every state: the spinner turns on the third line.
function run_part(mark: RunMark): string {
	const { glyph, color } = RUN_MARKS[mark]

	return styleText(color, `${glyph} ${RUN_NAME}`)
}

// The repository's own name — `kit` of `owner/kit` — under the run's, past the mark's columns, so a
// board open beside another repository's is told apart. Blank before a plan names one.
function repo_part(header: BoardHeader, mark: RunMark): string {
	const name = header.repo?.split(REPO_SEPARATOR).at(-1) ?? ''
	const indent = run_board_fit.width_of(RUN_MARKS[mark].glyph) + BLANK.length

	return `${BLANK.repeat(indent)}${name}`
}

// A part aged as the `💓` is: yellow once stale, red once alarming — a row's newest activity too
// (`run-board-render-tail.ts`).
function aged(part: string, age_ms: number): string {
	if (age_ms > ALARM_MS) return styleText('red', part)

	return age_ms > STALE_MS ? styleText('yellow', part) : part
}

// How long ago the stream last moved. An ended run has no heartbeat to keep: one counting on would
// read as a hang.
function age_of(header: BoardHeader): number | undefined {
	const last = header.activity.last_event_ms

	if (last === undefined || header.ended_ms !== undefined) return undefined

	return header.now_ms - last
}

// The minute an ended run ended, standing where its heartbeat did. Blank while the run has none to draw.
function ended_part(header: BoardHeader): string {
	const { ended_ms } = header

	return ended_ms === undefined ? '' : `${HEADER_ICONS.ended} ${minute_of(ended_ms)}`
}

// The `💓` under the run's age, in the `⏰`'s own format with its digits right-aligned to `width` —
// only a working run can be stale, so only it is colored. Only an ended run draws anything else there:
// the minute it ended. Its digits are emphasized for a few seconds after a new event resets them
// (`run-board-fresh.ts`).
function beat_part(header: BoardHeader, mark: RunMark, width: number): string {
	const age = age_of(header)

	if (age === undefined) return ended_part(header)

	const span = span_of(age)
	const part = `${HEADER_ICONS.heartbeat} ${padded(span, width, aged_fresh(span, age, header))}`

	return WORKING_MARKS.has(mark) ? aged(part, age) : part
}

// How long ago what the third line says happened, blank where no event gave it a time.
function now_age(now: NowLine | undefined): string {
	const age = now?.age_ms

	return age === undefined ? '' : span_of(age)
}

// How long ago what the third line says happened, counted to now: an ended run's age stops at its end,
// so its last words would otherwise stay fresh on every frame after it.
function fresh_age(now: NowLine | undefined, header: BoardHeader): number | undefined {
	const age = now?.age_ms

	return age === undefined ? undefined : age + header.now_ms - (header.ended_ms ?? header.now_ms)
}

// The `💓`'s digits, blank where it draws none.
function beat_span(header: BoardHeader): string {
	const age = age_of(header)

	return age === undefined ? '' : span_of(age)
}

// The third line's time: the spinner in the `⏰`'s and `💓`'s column — turning only while the run
// works, so a watch or an end stands blank — then its age, digits under theirs, emphasized while what
// the line says is fresh.
function now_time(
	header: BoardHeader,
	mark: RunMark,
	now: NowLine | undefined,
	width: number,
): string {
	const spinner = WORKING_MARKS.has(mark) ? header.spinner : undefined
	const icon = cell_of(spinner, run_board_fit.width_of(HEADER_ICONS.heartbeat))
	const age = now_age(now)

	return `${icon} ${padded(age, width, aged_fresh(age, fresh_age(now, header), header))}`
}

// What the third line says, emphasized while it is fresh.
function now_text(now: NowLine, header: BoardHeader): string {
	return `${now.icon} ${aged_fresh(now.text, fresh_age(now, header), header)}`
}

// A run's age over the `💓` — or over the minute an ended run ended — over the third line's age: the
// shorter lengths are right-aligned to the longest, so the digits stand in one column when only one has
// passed ten hours.
function time_parts(header: BoardHeader, mark: RunMark, now: NowLine | undefined): Array<string> {
	const elapsed = span_of((header.ended_ms ?? header.now_ms) - header.started_ms)
	const age = now_age(now)
	const width = Math.max(...[elapsed, beat_span(header), age].map((span) => span.length))

	return [
		`${HEADER_ICONS.elapsed} ${elapsed.padStart(width)}`,
		beat_part(header, mark, width),
		now_time(header, mark, now, width),
	]
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

function progress_parts(counts: BoardCounts, header: BoardHeader): Array<string> {
	const is_read = is_plan_read(header)

	return [
		`${tally_part(counts, header)}${is_read ? plus_of(counts, header) : ''}`,
		`${STATE_ICONS.running} ${String(counts.running)}`,
		`${STATE_ICONS.waiting} ${is_read ? String(counts.remaining) : UNKNOWN}`,
		`${STATE_ICONS.parked} ${String(counts.parked)}`,
	]
}

// The run's progress, then what its plan read is doing.
function progress_part(counts: BoardCounts, header: BoardHeader): string {
	const parts = [...progress_parts(counts, header), loading_part(header), plan_warning(header)]

	return parts.filter((part) => part !== undefined).join(GAP)
}

// The children drawn as running: only their operations are the run's newest.
function running_issues(layout: BoardLayout): ReadonlySet<number> {
	const running = layout.active.filter((row) => row.state === 'running')

	return new Set(running.map((row) => row.number))
}

// What the run is doing now (`run-board-now.ts`).
function now_line(counts: BoardCounts, header: BoardHeader): NowLine | undefined {
	return run_board_now.line_of({
		now_ms: header.now_ms,
		ended_ms: header.ended_ms,
		activity: header.activity,
		operations: header.operations,
		children: running_issues(layout_of(header)),
		running: counts.running,
		waiting: is_plan_read(header) ? counts.remaining : undefined,
		people: layout_of(header).people.length,
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

// The machine the run is on, its first figure as wide as the tally over it.
function machine_part(counts: BoardCounts, header: BoardHeader): string {
	const width = figure_width(total_of(counts, header))

	return run_board_machine.line_of(machine_of(header), width) ?? MACHINE_UNKNOWN
}

// The lines' cells of one column, the narrower padded to the wider as the terminal counts them.
function column_of(cells: ReadonlyArray<string>): Array<string> {
	const width = Math.max(...cells.map((cell) => run_board_fit.width_of(cell)))

	return cells.map((cell) => cell_of(cell, width))
}

// The run's name, age and progress, then its repository, heartbeat and machine under them, then what
// it is doing now — its time under theirs, its kind's icon under the `⚡`, the name's column left blank
// and no label — in every state the board can be in. A stream with no event yet leaves it blank.
function header_lines(header: BoardHeader): Array<string> {
	const counts = counts_of(layout_of(header))
	const mark = mark_of(header, counts.running)
	const now = now_line(counts, header)
	const names = column_of([run_part(mark), repo_part(header, mark), ''])
	const times = column_of(time_parts(header, mark, now))
	const lasts = [progress_part(counts, header), machine_part(counts, header)]
	const third =
		now === undefined ? '' : [names.at(-1), times.at(-1), now_text(now, header)].join(GAP)

	return [...lasts.map((last, line) => [names[line], times[line], last].join(GAP)), third]
}

// The third line's kind as the legend names it, `undefined` where the line's own words name it.
function now_legend(header: BoardHeader): string | undefined {
	const now = now_line(counts_of(layout_of(header)), header)

	return now?.legend === undefined ? undefined : `${now.icon} ${now.legend}`
}

const run_board_header = { aged, counts_of, header_lines, is_plan_read, now_legend }

export { run_board_header }
export type { BoardCounts, BoardForm, BoardHeader }
