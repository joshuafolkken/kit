import { WriteStream } from 'node:tty'
import { styleText } from 'node:util'
import type { FiledKind } from '#scripts/run/event/run-event-filed'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import cli_spinners from 'cli-spinners'
import type { BoardNote } from './run-board-notes'
import type { Phase } from './run-board-phase'
import type { ItemState } from './run-board-status'

// The words and the clock `run:board` draws with. A moment on the board is a local clock, `HH:MM`
// where a person reads it to the minute; every length — how long the run, a row, a phase or the
// heartbeat has run — is degree-minute-second style (`1°15′57″`), so `:` is a time of day alone and
// the board never reads a length as a moment.

const CLOCK_WIDTH = 2
const CLOCK_PAD = '0'
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
// A length's units — hours, minutes and seconds — so a length never shares the clock's `:`.
const SPAN_UNITS = { hours: '°', minutes: '′', seconds: '″' } as const
// Every gauge is this wide — the plan, the machine and a row's phase.
const BAR_WIDTH = 10
// A centered square done and a thin line left: the shapes alone tell the two apart where no color is
// drawn, and a terminal dims the line so the gauge does not read heavy. The square, not a full block,
// leaves a gap between stacked bars at line height 1.
const BAR_DONE = '■'
const BAR_LEFT = '─'
const BAR_DONE_COLOR: TextColor = 'cyan'
const BAR_LEFT_COLOR: TextColor = 'dim'
// The spinner a running run and a running row turn, at the package's own interval.
const SPINNER_FRAMES = cli_spinners.dots.frames
const SPINNER_INTERVAL_MS = cli_spinners.dots.interval
// The color depth from which a terminal draws a 24-bit color, and the escapes that draw one.
const RGB_COLOR_DEPTH = 24
const ESC = '\u{1B}'
const DEFAULT_FOREGROUND = `${ESC}[39m`

// The words the board draws, English whatever the session language: one set of words reads the same
// on every board. The board draws most of what it says as a symbol; the words left are the ones a
// symbol cannot carry, and the legend that names the symbols.
const WORDS = {
	no_run: 'no run',
	plan: 'plan',
	merged: 'merged',
	parked: 'parked',
	done: 'done',
	withdrawn: 'withdrawn',
	in_progress: 'running',
	stopped: 'stopped',
	waiting: 'waiting',
	decision: 'decision',
	waits: 'waits on',
	investigate: 'investigate',
	implement: 'implement',
	ship: 'ship',
	review: 'review',
	gate: 'gate',
	sync: 'sync',
	commit: 'commit',
	round_two: 'round-2',
	followup: 'followup',
	report: 'report',
	failed: 'failed',
	notes: 'findings and decisions',
	more: 'more',
	filed: 'filed',
	filed_run: 'filed this run',
	breaking: 'breaking',
	feature: 'feature',
	fix: 'fix',
	park: 'park',
	note: 'note',
	found_during: ' (found during {n})',
	// What the run is doing now, where no stage of its own says it.
	watching: 'watching',
	pool_empty: 'pool empty',
	on_person: 'waiting on a person',
	operation: 'operation',
	ended: 'ended',
	// The session a stopped run waits in, and what closing the board leaves.
	resume: 'stopped — resume with',
	keeps_running: 'Closing this screen leaves the run going · reopen with `pnpm josh backlogrun`',
} as const

type Words = typeof WORDS

type TextColor = Parameters<typeof styleText>[0]

// A color that does not depend on the terminal's palette: `rgb` as the
// `38;2;R;G;B` escape takes it, drawn where the output has 24-bit color, and `named` — the palette's own
// — where it does not.
interface Shade {
	rgb: string
	named: TextColor
}

type Paint = TextColor | Shade

// One unit of a length: its count and the mark it is drawn with.
interface SpanField {
	value: number
	unit: string
}

// Every row icon is an emoji a terminal draws two columns wide by default (Emoji_Presentation), so the
// number after it lines up whichever state a row is in: 🅿 and ☑ are text symbols a terminal such as
// VSCode's draws one column wide, which would shift a parked or finished row.
const STATE_ICONS: Readonly<Record<ItemState, string>> = {
	running: '🔄',
	merged: '✅',
	parked: '💤',
	done: '🏁',
	waiting: '⏳',
	human: '🙋',
	stopped: '🛑',
	withdrawn: '🚫',
}

// The blocking edge, chosen on the same rule: ⛓ is a text symbol.
const WAITS_ICON = '🔗'

// A running row's phases as icons, chosen on the same rule; the row draws every phase it has passed,
// so the rightmost icon is what it is doing now. Each of `josh ship`'s stages has its own; ⚓ rather
// than 🔁, which reads as a retry.
const PHASE_ICONS: Readonly<Record<Phase, string>> = {
	investigate: '🔍',
	plan: '📝',
	implement: '🔨',
	ship: '🚢',
	review: '👀',
	gate: '🚦',
	sync: '🔀',
	commit: '📦',
	round_two: '🔂',
	followup: '⚓',
	report: '📣',
	failed: '💥',
}

// The legend's word for each phase — the header's own `plan` where the phase shares one.
const PHASE_WORDS: Readonly<Record<Phase, keyof Words>> = {
	investigate: 'investigate',
	plan: 'plan',
	implement: 'implement',
	ship: 'ship',
	review: 'review',
	gate: 'gate',
	sync: 'sync',
	commit: 'commit',
	round_two: 'round_two',
	followup: 'followup',
	report: 'report',
	failed: 'failed',
}

// The findings section's rule and each note kind's lead, chosen on the same rule and apart from every
// phase and state icon, so the legend names them and a row needs no word. 🆕 is a filed issue whose
// kind is none of `FILED_KIND_ICONS`.
const NOTES_ICON = '📌'
const NOTE_ICONS: Readonly<Record<BoardNote['kind'], string>> = {
	filed: '🆕',
	park: STATE_ICONS.parked,
	note: '💬',
}
// A filed issue's line leads with its kind in place of 🆕: inside the 📌 section a line is already
// read as a filing, so 🆕 beside the kind would only widen it. 🧨 rather than 💥, which a failed ship
// draws.
const FILED_KIND_ICONS: Readonly<Record<FiledKind, string>> = {
	'breaking-change': '🧨',
	bug: '🐛',
	enhancement: '✨',
}
// A row leads its title with its kind's icon (joshuafolkken/kit#3577), and one with no kind with as many
// blank columns, so every title starts in one column. The legend names a kind by its release category.
const KIND_BLANK = '  '
const KIND_WORDS: Readonly<Record<FiledKind, keyof Words>> = {
	'breaking-change': 'breaking',
	enhancement: 'feature',
	bug: 'fix',
}

// The header's gauges and marks. ⚡ rather than 🔥: a fire beside a gauge drawn green reads as an
// alarm. ⏰ rather than ⏱, a text symbol some terminals draw one column wide: under it the 💓's digits
// would stand a column off.
const HEADER_ICONS = {
	cpu: '⚡',
	memory: '🧠',
	swap: '💾',
	ended: '🔚',
	loading: '⏳',
	elapsed: '⏰',
	heartbeat: '💓',
} as const

// The kind of what the header's third line says, under the `⚡` (joshuafolkken/kit#3767): a call a
// session made, the run watching its pool, the run ended, or each of the run's own stages, keyed by the
// stage's words before any issue. A child's event draws its row's phase icon instead. The run ended
// draws the header's own end mark — 🏁 is already a done row's state icon.
const NOW_ICONS = { operation: '🔧', watching: '🔭', ended: HEADER_ICONS.ended } as const
const { STAGE, LANE_STAGE } = run_event_setup
const STAGE_ICONS: Readonly<Partial<Record<string, string>>> = {
	[STAGE.STARTING]: '🚀',
	[STAGE.PLANNING]: '📝',
	[STAGE.HANDING_OFF]: '🤝',
	[STAGE.JUDGING]: '🤔',
	[STAGE.SESSION]: '💭',
	[STAGE.NO_CHILD]: '🚫',
	[LANE_STAGE.OPENING]: '🚪',
	[LANE_STAGE.INSTALLING]: '📥',
	[LANE_STAGE.DISPATCHING]: '📤',
}

// **The machine gauges' three colors, decided here alone**: Activity Monitor's green, yellow and red
// in the system's dark-mode values. A palette's `green` draws blue and its `red` orange in a VSCode
// terminal, so the normal gauge would read as the cyan plan bar and the busy one as yellow.
const GAUGE_SHADES = {
	normal: { rgb: '48;209;88', named: 'green' },
	yellow: { rgb: '255;214;10', named: 'yellow' },
	red: { rgb: '255;69;58', named: 'red' },
} as const satisfies Readonly<Record<string, Shade>>

function two_digits(value: number): string {
	return String(value).padStart(CLOCK_WIDTH, CLOCK_PAD)
}

// The local wall-clock `HH:MM:SS` of a moment.
function clock_of(ms: number): string {
	const date = new Date(ms)

	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((value) => two_digits(value))
		.join(':')
}

// The local wall-clock `HH:MM` of a moment, for one a person reads to the minute — when a run ended, or
// when a finding was filed.
function minute_of(ms: number): string {
	const date = new Date(ms)

	return [date.getHours(), date.getMinutes()].map((value) => two_digits(value)).join(':')
}

// The local `YYYY-MM-DD HH:MM` of a moment, for one that may fall on another day — when a waiting row may
// start.
function date_minute_of(ms: number): string {
	const date = new Date(ms)
	const day = [date.getMonth() + 1, date.getDate()].map((value) => two_digits(value))

	return `${[String(date.getFullYear()), ...day].join('-')} ${minute_of(ms)}`
}

// A length as its hours, and its minutes and seconds within the hour, each with its unit; a negative
// span reads as zero.
function span_fields(ms: number): Array<SpanField> {
	const seconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND)
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
	const hours = Math.floor(minutes / MINUTES_PER_HOUR)

	return [
		{ value: hours, unit: SPAN_UNITS.hours },
		{ value: minutes % MINUTES_PER_HOUR, unit: SPAN_UNITS.minutes },
		{ value: seconds % SECONDS_PER_MINUTE, unit: SPAN_UNITS.seconds },
	]
}

// **Every length the board draws**, in degree-minute-second style (`26″`, `3′27″`, `1°15′57″`): the
// leading unit not padded and a zero one dropped down to the seconds, the units after it two digits;
// a negative span reads as zero.
function span_of(ms: number): string {
	const fields = span_fields(ms)
	const lead = fields.findIndex((field, index) => field.value > 0 || index === fields.length - 1)
	const [first, ...rest] = fields.slice(lead)
	const head = first === undefined ? '' : `${String(first.value)}${first.unit}`

	return head + rest.map((field) => `${two_digits(field.value)}${field.unit}`).join('')
}

function is_shade(color: Paint): color is Shade {
	return typeof color === 'object' && 'rgb' in color
}

// A shade in 24-bit color where stdout draws it, else its palette color. Whether stdout draws color at
// all is `styleText`'s answer alone, so a shade draws no escape where its palette color would not.
function shaded(shade: Shade, text: string): string {
	const named = styleText(shade.named, text)

	if (named === text || WriteStream.prototype.getColorDepth() < RGB_COLOR_DEPTH) return named

	return `${ESC}[38;2;${shade.rgb}m${text}${DEFAULT_FOREGROUND}`
}

// A part of a gauge in its color; an empty part, or no color, draws no escape. `styleText` drops the
// escape itself where stdout draws no color (a pipe, `NO_COLOR`), so a gauge never disagrees with the
// rest of the board about it.
function painted(color: Paint | undefined, text: string): string {
	if (color === undefined || text === '') return text

	return is_shade(color) ? shaded(color, text) : styleText(color, text)
}

// **The one progress bar the board draws** — the header's plan, the machine and every running row's
// phase: `done` of `total` filled in proportion across `width` cells, the done part in `color`
// (`undefined` leaves it the terminal's own).
function bar_of(
	done: number,
	total: number,
	width: number = BAR_WIDTH,
	color: Paint | undefined = BAR_DONE_COLOR,
): string {
	const filled = total === 0 ? 0 : Math.round((Math.min(done, total) / total) * width)

	return (
		painted(color, BAR_DONE.repeat(filled)) +
		painted(BAR_LEFT_COLOR, BAR_LEFT.repeat(width - filled))
	)
}

// The spinner's frame at a moment, from the clock rather than a count of redraws, so the frame a redraw
// draws needs no state carried between redraws.
function spinner_of(now_ms: number): string {
	const step = Math.floor(Math.max(0, now_ms) / SPINNER_INTERVAL_MS)

	return SPINNER_FRAMES[step % SPINNER_FRAMES.length] ?? ''
}

const run_board_labels = {
	FILED_KIND_ICONS,
	GAUGE_SHADES,
	HEADER_ICONS,
	KIND_BLANK,
	KIND_WORDS,
	NOTES_ICON,
	NOTE_ICONS,
	NOW_ICONS,
	PHASE_ICONS,
	PHASE_WORDS,
	SPINNER_INTERVAL_MS,
	STAGE_ICONS,
	STATE_ICONS,
	WAITS_ICON,
	WORDS,
	bar_of,
	clock_of,
	date_minute_of,
	minute_of,
	painted,
	span_of,
	spinner_of,
}

export { run_board_labels }
export type { Paint, TextColor, Words }
