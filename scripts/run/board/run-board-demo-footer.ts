import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_demo_keys } from './run-board-demo-keys'
import { run_board_faint } from './run-board-faint'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_theme_host_sample, type DemoKey } from './run-board-theme-host-sample'
import type { ThemeTimeline } from './run-board-theme-host-types'
import { run_board_theme_run, type ThemeRun, type ThemeValue } from './run-board-theme-run'

// The footer a live board ends on in demo mode, in place of the legend and the footer under it: the
// selector the throwaway theme demos draw above their board (`.claude/skills/board-theme/demo-template.md`
// → `caption_rows`), with the live board's keys. Under a blank row, one row names the work picked and
// what plays on it, and the rows after it every key, those two lit: the works' keys on one row, what
// the other keys play and the exit on the next; either wraps, a key and its name whole, where the pane
// is narrower. What plays is read off the run: the part playing, else the event demo mode's timeline
// holds — IDLE's is empty — while the theme's own frame says it plays. The frame keeps these rows
// however short the pane
// (`run-board-pinned-footer.ts`).

const { DEMO_KEY, EVENT_OF_KEY, PART_OF_KEY } = run_board_demo_keys
const { THEME_VALUES } = run_board_theme_run
const { GAUGE_SHADES, painted } = run_board_labels
const INDENT = '  '
const LEAD = `${INDENT}KEYS${INDENT}`
const HANGING = ' '.repeat(LEAD.length)
const GAP_WIDTH = 3
const GAP = ' '.repeat(GAP_WIDTH)
// What no theme, the first value, is called, and what `/` does here.
const NO_THEME = 'none'
const EXIT_WORD = 'EXIT'
// The demo's events by their own keys; the row's text names none of them.
const EVENTS = run_board_theme_host_sample.demo_events('')
const TITLE_GAP = ' - '
// The event whose timeline fills each channel; the one that fills none is IDLE.
const CHANNEL_EVENTS: ReadonlyArray<readonly ['notice' | 'progress' | 'row', PlayedEvent]> = [
	['notice', 'n'],
	['progress', 'p'],
	['row', 'r'],
]
const IDLE_EVENT: PlayedEvent = 'i'

// The demo's events a key of demo mode plays.
type PlayedEvent = Extract<DemoKey, 'i' | 'n' | 'p' | 'r'>
type DemoRun = ThemeRun
type DemoMode = NonNullable<ThemeRun['demo']>

function name_of(value: ThemeValue): string {
	return value === '' ? NO_THEME : value
}

// A work's key and name, as its place among the values.
function theme_item(value: ThemeValue): string {
	return `${String(THEME_VALUES.indexOf(value))} ${name_of(value)}`
}

// Each event's and each part's key and name.
const EVENT_ITEMS = new Map(
	Array.from(EVENT_OF_KEY, ([key, event]) => [event, `${key} ${EVENTS[event].name}`] as const),
)
const PART_ITEMS = new Map(
	Array.from(PART_OF_KEY, ([key, part]) => [part, `${key} ${part.toUpperCase()}`] as const),
)

// Every key and what it does, in two groups, each starting a row of its own at every width: the works,
// then what a key plays — the events, the parts — and the exit.
const GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
	THEME_VALUES.map((value) => theme_item(value)),
	[...EVENT_ITEMS.values(), ...PART_ITEMS.values(), `${DEMO_KEY} ${EXIT_WORD}`],
]

// The event a demo timeline is: the one whose channel it fills.
function event_of(timeline: ThemeTimeline): PlayedEvent {
	const filled = CHANNEL_EVENTS.find(([channel]) => timeline[channel].length > 0)

	return filled?.[1] ?? IDLE_EVENT
}

// What plays: nothing but IDLE where no theme is built over the board; the part while one plays; else
// the event of demo mode's timeline, until the theme's own frame of it said its play is over
// (`ThemeModule.playing`, told through `run_board_theme_run.demo_over`).
function effect_item(run: DemoRun, demo: DemoMode): string | undefined {
	if (run.built === undefined) return EVENT_ITEMS.get(IDLE_EVENT)
	if (run.part !== undefined) return PART_ITEMS.get(run.part.name)

	return EVENT_ITEMS.get(demo.over === demo.timeline ? IDLE_EVENT : event_of(demo.timeline))
}

// An item as the title row names it: `[key] name`.
function captioned(item: string): string {
	const [key = ''] = item.split(' ', 1)

	return `[${key}]${item.slice(key.length)}`
}

function joined(items: ReadonlyArray<string>): string {
	return items.join(GAP)
}

// The items in rows no wider than `room`, each item whole; an item wider than `room` has a row to itself.
function wrapped(items: ReadonlyArray<string>, room: number): Array<Array<string>> {
	const rows: Array<Array<string>> = []

	for (const item of items) {
		const last = rows.at(-1)

		if (last === undefined || joined([...last, item]).length > room) rows.push([item])
		else last.push(item)
	}

	return rows
}

function dim(text: string): string {
	return text === '' ? '' : run_board_faint.faint(text)
}

// A keys row faint, the one of `chosen` it holds — a row holds one group's — lit.
function lit(row: string, chosen: ReadonlyArray<string>): string {
	const span = chosen.find((item) => row.includes(item))

	if (span === undefined) return dim(row)
	const at = row.indexOf(span)
	const [before, after] = [row.slice(0, at), row.slice(at + span.length)]

	return `${dim(before)}${painted(GAUGE_SHADES.yellow, span)}${dim(after)}`
}

// A row kept within the pane: one wider than it would wrap and take two of the pane's rows.
function clipped(row: string, columns: number): string {
	return run_board_fit.width_of(row) > columns ? run_board_cut_styled.cut_styled(row, columns) : row
}

function keys_rows(chosen: ReadonlyArray<string>, columns: number): Array<string> {
	const rows = GROUPS.flatMap((group) => wrapped(group, columns - LEAD.length))

	return rows.map((row, index) => lit(`${index === 0 ? LEAD : HANGING}${joined(row)}`, chosen))
}

// The rows a frame in demo mode ends on, none outside it; `columns` is the pane's width, unbounded where
// no pane is read.
function rows_of(run: DemoRun | undefined, columns = Infinity): Array<string> | undefined {
	if (run?.demo === undefined) return undefined
	const effect = effect_item(run, run.demo)
	const chosen = [theme_item(run.value), effect].filter((item) => item !== undefined)
	const title = `${INDENT}${chosen.map((item) => captioned(item)).join(TITLE_GAP)}`

	return ['', title, ...keys_rows(chosen, columns)].map((row) => clipped(row, columns))
}

const run_board_demo_footer = { rows_of }

export { run_board_demo_footer }
