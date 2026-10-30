import { styleText } from 'node:util'
import { figure_format } from '#scripts/lib/figure-format'
import { run_board_fit, type DetailPart } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_machine } from './run-board-machine'
import type { QuotaProvider, QuotaReading, Quotas, QuotaWindow } from './run-board-quota-read'
import { run_board_render_section } from './run-board-render-section'

// The `⛽ usage` section (joshuafolkken/kit#5395): Claude's and Codex's usage-limit windows, one row
// each, under fixed `5h` and `7d` columns. A window of another length stands in the nearer column and
// its length ends the row. Each bar carries ┊, how far through its window the clock is, so a bar past
// it is spending faster than the window refills; ↻ is when the window resets.

const { GAUGE_SHADES, bar_of } = run_board_labels
const { minute_of, two_digits } = figure_format
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440
const DAYS_PER_WEEK = 7
const WEEK_MS = DAYS_PER_WEEK * MINUTES_PER_DAY * MS_PER_MINUTE
const STALE_MINUTES = 10
const BAR_WIDTH = 10
const PERCENT = 100
const YELLOW_PERCENT = 50
const RED_PERCENT = 90
const INDENT = '  '
const NAME_WIDTH = 13
const CELL_WIDTH = 29
const FIRST_COLUMN = INDENT.length + NAME_WIDTH
const NONE = '—'
// `—` under a percent's last digit.
const NONE_CELL = `  ${NONE}`
const PACE_MARK = '┊'
const RESET_MARK = '↻'
const LABEL = '⛽ usage'
const LIMIT_MARK = '🛑'
const SEPARATOR = ' · '
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LEVELS = ['normal', 'yellow', 'red'] as const
const COLUMNS = [
	{ label: '5h', minutes: 300 },
	{ label: '7d', minutes: 10_080 },
]
const PROVIDERS: ReadonlyArray<QuotaProvider> = ['claude', 'codex']
const SCHEDULER_MARK = '🤖'
const LEGEND = [LABEL, `${SCHEDULER_MARK} scheduler`, `${PACE_MARK} pace`, `${RESET_MARK} reset`]

// The reset a usage limit holds the run's launches until, and how many children it stopped.
interface QuotaHold {
	reset_ms: number
	parked: number
}

type Shade = (typeof GAUGE_SHADES)[(typeof LEVELS)[number]]

interface QuotaView {
	quotas?: Quotas | undefined
	scheduler_provider?: QuotaProvider | undefined
	now_ms: number
	hold?: QuotaHold | undefined
}

// The column nearer `minutes` by ratio: 30 days stands under `7d`, an hour under `5h`.
function column_of(minutes: number): number {
	const distances = COLUMNS.map((column) => Math.abs(Math.log(minutes / column.minutes)))

	return distances.indexOf(Math.min(...distances))
}

function length_text(minutes: number): string {
	if (minutes % MINUTES_PER_DAY === 0) return `${String(minutes / MINUTES_PER_DAY)}d`

	return minutes % MINUTES_PER_HOUR === 0
		? `${String(minutes / MINUTES_PER_HOUR)}h`
		: `${String(minutes)}m`
}

// A window whose reset has passed is drawn empty, its reset rolled on by whole windows — no file is
// read again for it.
function current(window: QuotaWindow, now_ms: number): QuotaWindow {
	if (window.resets_ms > now_ms) return window

	const span = window.minutes * MS_PER_MINUTE
	const spans = Math.floor((now_ms - window.resets_ms) / span) + 1

	return { ...window, used_percent: 0, resets_ms: window.resets_ms + spans * span }
}

// How far through its window the clock is, 0 to 1.
function pace_of(window: QuotaWindow, now_ms: number): number {
	const left = (window.resets_ms - now_ms) / (window.minutes * MS_PER_MINUTE)

	return Math.min(1, Math.max(0, 1 - left))
}

// Yellow from half, red from nine tenths, a step up again once the bar is past ┊.
function level_of(used: number, pace: number): (typeof LEVELS)[number] {
	const base = Number(used >= YELLOW_PERCENT) + Number(used >= RED_PERCENT)
	const step = Number(used > pace * PERCENT)

	return LEVELS[Math.min(LEVELS.length - 1, base + step)] ?? 'red'
}

function bar_text(used: number, pace: number, shade: Shade): string {
	const filled = Math.round((Math.min(PERCENT, Math.max(0, used)) / PERCENT) * BAR_WIDTH)
	const mark = Math.min(BAR_WIDTH - 1, Math.floor(pace * BAR_WIDTH))
	const rest = BAR_WIDTH - mark - 1
	const before = bar_of(Math.min(filled, mark), mark, mark, shade)

	return `${before}${PACE_MARK}${bar_of(Math.max(0, filled - mark - 1), rest, rest, shade)}`
}

// `14:00` today, `Fri 10:00` within the week, else `11/02`.
function reset_text(reset_ms: number, now_ms: number): string {
	const date = new Date(reset_ms)

	if (date.toDateString() === new Date(now_ms).toDateString()) return minute_of(reset_ms)
	if (reset_ms - now_ms < WEEK_MS) return `${WEEKDAYS[date.getDay()] ?? ''} ${minute_of(reset_ms)}`

	return `${two_digits(date.getMonth() + 1)}/${two_digits(date.getDate())}`
}

function padded(text: string): string {
	return `${text}${' '.repeat(Math.max(0, CELL_WIDTH - run_board_fit.width_of(text)))}`
}

function cell_of(window: QuotaWindow, now_ms: number): string {
	const shown = current(window, now_ms)
	const pace = pace_of(shown, now_ms)
	const level = level_of(shown.used_percent, pace)
	const shade = GAUGE_SHADES[level]
	const percent = run_board_machine.percent_text(shown.used_percent)
	const reset = `${RESET_MARK} ${reset_text(shown.resets_ms, now_ms)}`

	return padded(`${percent} ${bar_text(shown.used_percent, pace, shade)}  ${reset}`)
}

// Each column's window, `undefined` where the provider reported none that stands in it.
function placed(windows: ReadonlyArray<QuotaWindow>): Array<QuotaWindow | undefined> {
	return COLUMNS.map((_, index) => windows.find((window) => column_of(window.minutes) === index))
}

// The lengths of the windows not as long as the column they stand in, `30d`.
function lengths_of(windows: ReadonlyArray<QuotaWindow>): Array<string> {
	return windows
		.filter((window) => COLUMNS[column_of(window.minutes)]?.minutes !== window.minutes)
		.map((window) => length_text(window.minutes))
}

function stale_text(reading: QuotaReading, now_ms: number): string | undefined {
	const minutes = Math.floor((now_ms - reading.taken_ms) / MS_PER_MINUTE)

	return minutes > STALE_MINUTES ? `(${String(minutes)}′ ago)` : undefined
}

function cells_text(reading: QuotaReading | undefined, now_ms: number): string {
	const windows = placed(reading?.windows ?? [])
	const cells = windows.map((window) =>
		window === undefined ? padded(NONE_CELL) : cell_of(window, now_ms),
	)

	return [...cells, ...lengths_of(reading?.windows ?? [])].join('').trimEnd()
}

// A reading older than `STALE_MINUTES` is dimmed and says how old it is.
function reading_text(reading: QuotaReading | undefined, now_ms: number): string {
	const cells = cells_text(reading, now_ms)
	const stale = reading === undefined ? undefined : stale_text(reading, now_ms)

	return stale === undefined ? cells : styleText('dim', `${cells} ${stale}`)
}

function hold_text(hold: QuotaHold, now_ms: number): string {
	const resumes = `resumes ${RESET_MARK} ${reset_text(hold.reset_ms, now_ms)}`
	const parked = hold.parked > 0 ? [`${String(hold.parked)} parked`] : []

	return [`${LIMIT_MARK} limit`, resumes, ...parked].join(SEPARATOR)
}

function providers_of(view: QuotaView): ReadonlyArray<QuotaProvider> {
	const first = view.scheduler_provider

	return first === undefined
		? PROVIDERS
		: [first, ...PROVIDERS.filter((provider) => provider !== first)]
}

function name_of(provider: QuotaProvider, view: QuotaView): string {
	if (view.scheduler_provider === undefined) return provider

	const mark = provider === view.scheduler_provider ? SCHEDULER_MARK : '  '

	return `${mark} ${provider}`
}

function name_cell(provider: QuotaProvider, view: QuotaView): string {
	const name = name_of(provider, view)

	return `${name}${' '.repeat(NAME_WIDTH - run_board_fit.width_of(name))}`
}

// Claude's row reads its hold while a usage limit stops the run's launches.
function row_of(provider: QuotaProvider, view: QuotaView): string {
	const { hold, now_ms } = view
	const body =
		provider === 'claude' && hold !== undefined
			? hold_text(hold, now_ms)
			: reading_text(view.quotas?.[provider], now_ms)

	return `${INDENT}${name_cell(provider, view)}${body}`
}

// `claude 42/68`: each column's percent, `—` where none stands.
function summary_of(view: QuotaView): string {
	const parts = providers_of(view).map((provider) => {
		const windows = placed(view.quotas?.[provider]?.windows ?? [])
		const percents = windows.map((window) =>
			window === undefined ? NONE : String(Math.round(current(window, view.now_ms).used_percent)),
		)

		return `${name_of(provider, view).trimStart()} ${percents.join('/')}`
	})

	return parts.join(SEPARATOR)
}

function rule_columns(): Array<{ label: string; start: number }> {
	return COLUMNS.map((column, index) => ({
		label: column.label,
		start: FIRST_COLUMN + index * CELL_WIDTH,
	}))
}

// None where no reader is open — a frame drawn with no usage read.
function usage_part(view: QuotaView): DetailPart | undefined {
	if (view.quotas === undefined) return undefined

	const lines = providers_of(view).map((provider) => ({
		text: row_of(provider, view),
		is_detail: false,
	}))
	const rule = run_board_render_section.columns_rule(LABEL, rule_columns())

	return { head: ['', rule], lines, label: LABEL, summary: summary_of(view) }
}

const run_board_render_quota = { LEGEND, usage_part }

export { run_board_render_quota }
export type { QuotaHold, QuotaView }
