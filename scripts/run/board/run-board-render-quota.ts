import { styleText } from 'node:util'
import { figure_format } from '#scripts/lib/figure-format'
import { run_board_fit, type DetailPart } from './run-board-fit'
import type { QuotaProvider, QuotaReading, Quotas, QuotaWindow } from './run-board-quota-read'
import { run_board_render_quota_cell, type Cell } from './run-board-render-quota-cell'
import {
	run_board_render_quota_github,
	type GithubRateLimit,
} from './run-board-render-quota-github'
import { run_board_render_section } from './run-board-render-section'

// The `⛽ usage` section (joshuafolkken/kit#5395): Claude's and Codex's usage-limit windows, one row
// each, drawing only the windows the provider reported, shortest first, straight after the name
// (joshuafolkken/kit#6629), each cell led by its window's length (`run-board-render-quota-cell.ts`,
// joshuafolkken/kit#6828). Each bar carries ┊, how far through its window the clock is, so a bar past
// it is spending faster than the window refills. ≈ is how many more tasks like the recent ones fit in
// what is left (joshuafolkken/kit#5508), kept blank where none could be told so the reset stays put;
// the reset time follows it. GitHub's allowances follow on their own row
// (`run-board-render-quota-github.ts`), in the same columns.

const { minute_of, two_digits } = figure_format
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 1440
const DAYS_PER_WEEK = 7
const WEEK_MINUTES = DAYS_PER_WEEK * MINUTES_PER_DAY
const WEEK_MS = WEEK_MINUTES * MS_PER_MINUTE
const STALE_MINUTES = 10
const PERCENT = 100
const INDENT = '  '
// `🤖 Claude`, the widest name, and a space; the label column's own lead space makes it two.
const NAME_WIDTH = 10
const COUNT_MARK = '≈'
// The widest count the column holds.
const MAX_COUNT = 999
// A mean spend is a fraction (`7 / 3`), so a whole count can divide to just under itself.
const COUNT_EPSILON = 1e-9
const NONE = '—'
const PACE_MARK = '┊'
// Kept for the held row and the legend; the gauge cells draw the reset time bare.
const RESET_MARK = '↻'
const LABEL = '⛽ usage'
const LIMIT_MARK = '🛑'
const SEPARATOR = ' · '
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const PROVIDERS: ReadonlyArray<QuotaProvider> = ['claude', 'codex']
const SCHEDULER_MARK = '🤖'
const GITHUB = 'GitHub'
// The providers' names as drawn, in their proper case; the keys stay lower case.
const PROVIDER_NAMES: Readonly<Record<QuotaProvider, string>> = { claude: 'Claude', codex: 'Codex' }
const LEGEND = [
	LABEL,
	`${SCHEDULER_MARK} scheduler`,
	`${PACE_MARK} pace`,
	`${RESET_MARK} reset`,
	`${COUNT_MARK} tasks left`,
	run_board_render_quota_github.LEGEND_ENTRY,
]

// The reset a usage limit holds the run's launches until, and how many children it stopped.
interface QuotaHold {
	reset_ms: number
	parked: number
}

interface QuotaView {
	quotas?: Quotas | undefined
	scheduler_provider?: QuotaProvider | undefined
	now_ms: number
	hold?: QuotaHold | undefined
	// GitHub's allowances, drawn after the usage-limit rows; none where they could not be read.
	rate_limit?: GithubRateLimit | undefined
}

// The windows the provider reported, shortest first — the order its row and its summary both read.
function windows_of(reading: QuotaReading | undefined): Array<QuotaWindow> {
	return (reading?.windows ?? []).toSorted((first, second) => first.minutes - second.minutes)
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

// `14:00` today, `Fri 10:00` within the week, else `11/02`.
function reset_text(reset_ms: number, now_ms: number): string {
	const date = new Date(reset_ms)

	if (date.toDateString() === new Date(now_ms).toDateString()) return minute_of(reset_ms)
	if (reset_ms - now_ms < WEEK_MS) return `${WEEKDAYS[date.getDay()] ?? ''} ${minute_of(reset_ms)}`

	return `${two_digits(date.getMonth() + 1)}/${two_digits(date.getDate())}`
}

function padded(text: string, width: number): string {
	return `${text}${' '.repeat(Math.max(0, width - run_board_fit.width_of(text)))}`
}

// How many more tasks spending `per_task` fit in what is left of `window`, none where untold.
function count_of(window: QuotaWindow, now_ms: number, per_task?: number): number | undefined {
	if (per_task === undefined || per_task <= 0) return undefined

	const left = PERCENT - current(window, now_ms).used_percent

	return Math.min(MAX_COUNT, Math.max(0, Math.floor(left / per_task + COUNT_EPSILON)))
}

function per_task_in(reading: QuotaReading | undefined, window: QuotaWindow): number | undefined {
	return reading?.per_task?.[window.minutes]
}

function count_text(count: number | undefined): string {
	return count === undefined ? '' : `${COUNT_MARK}${String(count)}`
}

function cell_of(window: QuotaWindow, now_ms: number, per_task?: number): Cell {
	const shown = current(window, now_ms)

	return {
		label: length_text(window.minutes),
		used_percent: shown.used_percent,
		pace: pace_of(shown, now_ms),
		count: count_text(count_of(window, now_ms, per_task)),
		reset: reset_text(shown.resets_ms, now_ms),
	}
}

// `1044′`, after the reset time.
function stale_text(reading: QuotaReading, now_ms: number): string | undefined {
	if (reading.taken_ms === undefined) return '(time unknown)'

	const minutes = Math.floor((now_ms - reading.taken_ms) / MS_PER_MINUTE)

	return minutes > STALE_MINUTES ? `${String(minutes)}′` : undefined
}

// A single `—` where the provider reported no window, so none read stays apart from 0%.
function cells_text(reading: QuotaReading | undefined, now_ms: number): string {
	const windows = windows_of(reading)

	if (windows.length === 0) return NONE

	return run_board_render_quota_cell.row_text(
		windows.map((window) => cell_of(window, now_ms, per_task_in(reading, window))),
	)
}

// Age annotates the observation; values and warning colors remain readable as it ages.
function reading_text(reading: QuotaReading | undefined, now_ms: number): string {
	const cells = cells_text(reading, now_ms)
	const stale = reading?.windows.length ? stale_text(reading, now_ms) : undefined

	return stale === undefined ? cells : `${cells} ${styleText('dim', stale)}`
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

function name_of(provider: QuotaProvider | 'github', view: QuotaView): string {
	const name = provider === 'github' ? GITHUB : PROVIDER_NAMES[provider]
	if (view.scheduler_provider === undefined) return name

	const mark = provider === view.scheduler_provider ? SCHEDULER_MARK : '  '

	return `${mark} ${name}`
}

function name_cell(name: string): string {
	return padded(name, NAME_WIDTH)
}

// Claude's row reads its hold while a usage limit stops the run's launches.
function row_of(provider: QuotaProvider, view: QuotaView): string {
	const { hold, now_ms } = view
	const body =
		provider === 'claude' && hold !== undefined
			? hold_text(hold, now_ms)
			: reading_text(view.quotas?.[provider], now_ms)

	return `${INDENT}${name_cell(name_of(provider, view))}${body}`
}

// `42/68`: each drawn window's percent; a single `—` where none was reported.
function percents_text(reading: QuotaReading | undefined, now_ms: number): string {
	const windows = windows_of(reading)

	if (windows.length === 0) return NONE

	return windows.map((window) => String(Math.round(current(window, now_ms).used_percent))).join('/')
}

// ` ≈9/5`: each drawn window's count, `—` where one is untold beside a told one; nothing where none is.
function counts_text(reading: QuotaReading | undefined, now_ms: number): string {
	const counts = windows_of(reading).map((window) =>
		count_of(window, now_ms, per_task_in(reading, window)),
	)

	if (counts.every((count) => count === undefined)) return ''

	const texts = counts.map((count) => (count === undefined ? NONE : String(count)))

	return ` ${COUNT_MARK}${texts.join('/')}`
}

// Nothing where the allowances could not be read.
function rate_limit_rows(view: QuotaView): Array<string> {
	const { rate_limit, now_ms } = view
	if (rate_limit === undefined) return []

	const body = run_board_render_quota_github.row_text(rate_limit, now_ms)

	return [`${INDENT}${name_cell(name_of('github', view))}${body}`]
}

// `GitHub REST 38% 1877/5000 ↻12:33 · ▶ GraphQL 1% 48/5000 ↻12:40`.
function rate_limit_summary(view: QuotaView): Array<string> {
	const { rate_limit, now_ms } = view
	if (rate_limit === undefined) return []

	return [`${GITHUB} ${run_board_render_quota_github.summary_text(rate_limit, now_ms)}`]
}

// `Claude 42/68 ≈9/5`: each drawn window's percent, then its count.
function summary_of(view: QuotaView): string {
	const parts = providers_of(view).map((provider) => {
		const reading = view.quotas?.[provider]
		const name = name_of(provider, view).trimStart()

		return `${name} ${percents_text(reading, view.now_ms)}${counts_text(reading, view.now_ms)}`
	})

	return [...parts, ...rate_limit_summary(view)].join(SEPARATOR)
}

// None where no reader is open — a frame drawn with no usage read.
function usage_part(view: QuotaView): DetailPart | undefined {
	if (view.quotas === undefined) return undefined

	const rows = [
		...providers_of(view).map((provider) => row_of(provider, view)),
		...rate_limit_rows(view),
	]
	const lines = rows.map((text) => ({ text, is_detail: false }))
	const rule = run_board_render_section.columns_rule(LABEL, [])

	return { head: ['', rule], lines, label: LABEL, summary: summary_of(view) }
}

const run_board_render_quota = { LEGEND, usage_part }

export { run_board_render_quota }
export type { QuotaHold, QuotaView }
