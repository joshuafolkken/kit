import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_menu } from './run-board-theme-deviant-menu'
import { run_board_theme_deviant_parts, type Stage } from './run-board-theme-deviant-parts'
import { run_board_theme_draw, type Pane } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Point } from './run-board-theme-host-types'

// The deviant theme's idle panel's third page, STATUS: at the left an LED ring that turns slowly in
// blue; from the middle a probability readout — a thin rule, the number in three-row digits of thin
// line characters with its arrow, the two small label lines and one status line under it. The number
// is the board's stress read the other way (`100 - stress`), counting to its value in steps once the
// page has turned up. Through a NOTICE the panel shows this page: the ring red and quick and the
// number falling as the wall builds, then cyan and rising from the peak. A six-row panel draws the
// number on one row and drops nothing.

const { code_points, repeated } = run_board_theme_host_grid
const { PAIR, put_in } = run_board_theme_draw
const { PANEL, RGB, STRESS } = run_board_theme_deviant_data
const { bar_style, entrance, entrance_ticks, has_entered } = run_board_theme_deviant_menu
const { bold, duo, ink, mix } = run_board_theme_deviant_parts

// A cell of the ring: where it is from the ring's corner, and its character.
interface RingCell extends Point {
	ch: string
}

// The cells round the edge of `rows`, clockwise from the top left.
function ring_path(rows: ReadonlyArray<string>): Array<RingCell> {
	const last = { x: (rows[0]?.length ?? 1) - 1, y: rows.length - 1 }
	const across = Array.from({ length: last.x + 1 }, (_, x) => x)
	const down = Array.from({ length: Math.max(0, last.y - 1) }, (_, index) => index + 1)
	const points = [
		...across.map((x) => ({ x, y: 0 })),
		...down.map((y) => ({ x: last.x, y })),
		...across.toReversed().map((x) => ({ x, y: last.y })),
		...down.toReversed().map((y) => ({ x: 0, y })),
	]

	return points.map((at) => ({ ...at, ch: rows[at.y]?.charAt(at.x) ?? ' ' }))
}

// The ring: its cells, its column, the ticks a cell takes at rest, the lit cells behind its head
// and how far its unlit cells are taken to the night.
const RING_CELLS = ring_path(['╭───╮', '│   │', '╰───╯'])
const LED = { x: 1, pace: 4, tail: 4, dark: 0.75 }

// The ring's look at a moment: its color and how much of it shows.
interface RingLook {
	color: string
	shown: number
}

// The readout: its columns, the rule's widest, a digit's cells with its gap, and the room kept clear
// of the chevrons at the panel's right edge.
const READOUT = {
	x: 8,
	arrow_x: 22,
	label_x: 24,
	rule_w: 27,
	digit_w: 4,
	margin: 3,
	top: 2,
	full: 100,
}
const LABELS = ['PROBABILITY', 'OF SUCCESS']
// The label lines and the status line enter as the menus' items do.
const ITEMS = LABELS.length + 1
// The count: how far from its value the number starts, its step and the ticks a step takes.
const COUNT = { from: 20, step: 2, pace: 2 }
// The status line's word by the stress it reads at rest, and through a NOTICE.
const NOTES = { stable: 'STABLE', unstable: 'UNSTABLE', critical: 'CRITICAL', unstable_from: 30 }
const NOTICE_NOTES = { lead: 'DEVIANT', alarm: 'DESTABILIZING', after: 'STABILIZING' }
const REST_LEAD = 'STATUS'
const CRITICAL_FROM = 70
// A page shown whole, with no entrance: a NOTICE's.
const SETTLED = 1000
// Three-row digits of thin line characters, `0` to `9`.
const DIGITS: ReadonlyArray<ReadonlyArray<string>> = [
	['┌─┐', '│ │', '└─┘'],
	[' ╶┐', '  │', '  ╵'],
	['╶─┐', '┌─┘', '└─╴'],
	['╶─┐', ' ─┤', '╶─┘'],
	['╷ ╷', '└─┤', '  ╵'],
	['┌─╴', '└─┐', '╶─┘'],
	['┌─╴', '├─┐', '└─┘'],
	['╶─┐', '  │', '  ╵'],
	['┌─┐', '├─┤', '└─┘'],
	['┌─┐', '└─┤', '╶─┘'],
]

// What the page reads off the panel's look: the stress, and where a NOTICE stands.
interface StatusLook {
	stress: number
	is_alarm: boolean
	has_mark: boolean
}

// The readout at a moment: its number, whether it falls, its color and the status line's two words.
interface Readout {
	value: number
	is_falling: boolean
	color: string
	lead: string
	note: string
}

function is_notice(look: StatusLook): boolean {
	return look.is_alarm || look.has_mark
}

function note_of(stress: number): string {
	if (stress >= CRITICAL_FROM) return NOTES.critical

	return stress >= NOTES.unstable_from ? NOTES.unstable : NOTES.stable
}

// At rest: the number counts to its value from `COUNT.from` off it, a step every few ticks once the
// page has entered — up to a calm board's, down to a troubled one's.
function resting(stress: number, age: number): Readout {
	const is_falling = stress > STRESS.base
	const steps = Math.floor(Math.max(0, age - entrance_ticks(ITEMS)) / COUNT.pace)
	const left = Math.max(0, COUNT.from - steps * COUNT.step) * (is_falling ? 1 : -1)
	const value = Math.min(READOUT.full, Math.max(0, READOUT.full - stress + left))

	return { value, is_falling, color: RGB.white, lead: REST_LEAD, note: note_of(stress) }
}

// Through a NOTICE: falling in red while the wall builds, rising in cyan from the peak.
function notice_readout(value: number, is_alarm: boolean): Readout {
	const { lead, alarm, after } = NOTICE_NOTES

	return is_alarm
		? { value, is_falling: true, color: RGB.red, lead, note: alarm }
		: { value, is_falling: false, color: RGB.cyan, lead, note: after }
}

function readout_of(look: StatusLook, age: number): Readout {
	if (is_notice(look)) return notice_readout(READOUT.full - look.stress, look.is_alarm)

	return resting(look.stress, age)
}

// A ring cell's ink: the head white-hot, the cells behind it fading to the ring's dark.
function led_ink(behind: number, color: string, shown: number): string {
	const dark = mix(color, RGB.night, LED.dark)
	const lit = behind === 0 ? mix(color, RGB.white, 1 / PAIR) : mix(color, dark, behind / LED.tail)

	return ink(mix(RGB.night, behind < LED.tail ? lit : dark, shown))
}

// The LED ring, three rows by five columns, its head turning clockwise: slowly in blue, quick and red
// while a NOTICE's wall builds.
function led_ring(pane: Pane, at: Point, turn: number, look: RingLook): void {
	const count = RING_CELLS.length
	const head = Math.floor(turn) % count

	for (const [index, cell] of RING_CELLS.entries()) {
		const style = led_ink((head - index + count) % count, look.color, look.shown)

		put_in(pane, { x: at.x + cell.x, y: at.y + cell.y }, cell.ch, style)
	}
}

// The number in three-row digits from `at`, its `%` on the last row.
function big_number(pane: Pane, at: Point, text: string, style: string): void {
	for (const [index, ch] of code_points(text).entries()) {
		const rows = DIGITS[Number(ch)] ?? []

		for (const [row, line] of rows.entries()) {
			put_in(pane, { x: at.x + index * READOUT.digit_w, y: at.y + row }, line, style)
		}
	}

	put_in(pane, { x: at.x + text.length * READOUT.digit_w, y: at.y + PAIR }, '%', style)
}

// The number: three rows where the panel has them, one row on a six-row panel.
function number(stage: Stage, readout: Readout, shown: number): void {
	const style = bold(mix(RGB.night, readout.color, shown))
	const at = { x: READOUT.x, y: READOUT.top }
	const text = String(readout.value)

	if (stage.body === PANEL.body) big_number(stage.pane, at, text, style)
	else put_in(stage.pane, at, `${text}%`, style)
}

function arrow(pane: Pane, readout: Readout, shown: number): void {
	const [ch, color] = readout.is_falling ? ['∨', RGB.red] : ['∧', RGB.cyan]

	put_in(pane, { x: READOUT.arrow_x, y: READOUT.top }, ch, bold(mix(RGB.night, color, shown)))
}

// Item `index` of the page — a label line, or the status line — while it enters as the menus' items
// do: a bare bar, then its text on it. True once it has entered, for its own look to be drawn.
function item(pane: Pane, at: Point, look: { text: string; index: number; age: number }): boolean {
	const enter = entrance(look.age, look.index, ITEMS)

	if (look.age >= entrance_ticks(ITEMS)) return true
	if (has_entered(enter)) put_in(pane, at, look.text, bar_style(enter, RGB.night, RGB.soft))

	return false
}

function labels(stage: Stage, age: number): void {
	const top = stage.bottom - LABELS.length - 1

	for (const [index, text] of LABELS.entries()) {
		const at = { x: READOUT.label_x, y: top + index }

		if (item(stage.pane, at, { text, index, age })) put_in(stage.pane, at, text, ink(RGB.soft))
	}
}

// The status line under the readout: its first word bold, its second thin, in the readout's color.
function status_line(stage: Stage, readout: Readout, age: number): void {
	const at = { x: READOUT.x, y: stage.bottom - 1 }
	const text = `${readout.lead} ${readout.note}`

	if (item(stage.pane, at, { text, index: LABELS.length, age })) {
		duo(stage.pane, at, [readout.lead, readout.note], readout.color)
	}
}

// The ring and the thin rule over the readout, `shown` of the way in.
function fittings(stage: Stage, tick: number, look: StatusLook, shown: number): void {
	const { pane, right, body } = stage
	const [turn, color] = look.is_alarm ? [tick, RGB.red] : [tick / LED.pace, RGB.blue]
	const rule = repeated('─', Math.min(READOUT.rule_w, right - READOUT.margin - READOUT.x))

	led_ring(pane, { x: LED.x, y: body }, turn, { color, shown })
	put_in(pane, { x: READOUT.x, y: 1 }, rule, ink(mix(RGB.night, RGB.plate, shown)))
}

// The STATUS page, `age` ticks after it turned up — a NOTICE's stands whole.
function status_page(stage: Stage, tick: number, age: number, look: StatusLook): void {
	const since = is_notice(look) ? SETTLED : age
	const readout = readout_of(look, since)
	const shown = entrance(since, 0, ITEMS).label

	fittings(stage, tick, look, shown)
	number(stage, readout, shown)
	arrow(stage.pane, readout, shown)
	labels(stage, since)
	status_line(stage, readout, since)
}

const run_board_theme_deviant_status = { is_notice, status_page }

export { run_board_theme_deviant_status }
export type { StatusLook }
