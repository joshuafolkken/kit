import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Point, ThemeApi } from './run-board-theme-host-types'

// The deviant theme's small parts, drawn alike on every screen of it: the inks, the cursor plate with
// its corner brackets, a line in two weights, the waiting ring, the ornament line, the date card and
// the triangle.

const { BOLD, bg, code_points, fg, mixed, pick } = run_board_theme_host_grid
const { PAIR, clamped, panel_pane, put_in } = run_board_theme_draw
const { BAR, CARD, FACE, MONTHS, ORDINALS, ORNAMENT, PANEL, PLATE, RGB, RING, TRIANGLE } =
	run_board_theme_deviant_data

// The panel as a part lays itself out on it: its right end, its last row and the row its body starts
// on — one row up, the ornament line given up, where the panel is a row short.
interface Stage {
	pane: Pane
	right: number
	bottom: number
	body: number
}

// The date card's three parts; no date where the board tells only a time.
interface DateCard {
	date: string
	half: string
	time: string
}

const CLOCK = /(?:(?<month>\d\d)-(?<day>\d\d) )?(?<hour>\d\d):(?<minute>\d\d)/u

function mix(from: string, to: string, share: number): string {
	return mixed(from, to, clamped(share))
}

function ink(color: string): string {
	return fg(color)
}

function bold(color: string): string {
	return `${fg(color)}${BOLD}`
}

// Bold letters on a ground of their own: a plate, a key box.
function on(color: string, ground: string): string {
	return `${fg(color)}${BOLD}${bg(ground)}`
}

function stage_of(draw: ThemeDraw): Stage {
	const pane = panel_pane(draw)
	const { w, h } = pane.box

	return { pane, right: w - 1, bottom: h - 1, body: h < PANEL.rows ? PANEL.body - 1 : PANEL.body }
}

// The bar's and the timeline's width on a panel `width` wide.
function bar_width(width: number): number {
	return Math.max(BAR.min, Math.min(BAR.max, width - BAR.margin))
}

// A plate: the menu cursor — a bar, white bold text, a corner bracket at each end.
function plate(pane: Pane, at: Point, label: string, ground: string): void {
	put_in(pane, at, '⌜', ink(RGB.soft))
	put_in(pane, { x: at.x + 1, y: at.y }, ` ${label} `, on(RGB.white, ground))
	put_in(pane, { x: at.x + label.length + PLATE.pad, y: at.y }, '⌟', ink(RGB.soft))
}

// Two weights on one line, as every stamped text of the game: the first word bold, the rest thin.
function duo(pane: Pane, at: Point, words: readonly [string, string], color: string): void {
	const [first, rest] = words

	put_in(pane, at, first, bold(color))
	put_in(
		pane,
		{ x: at.x + first.length + 1, y: at.y },
		rest,
		ink(mix(color, RGB.night, PANEL.thin)),
	)
}

function ring_glyph(tick: number): string {
	return pick(
		code_points(RING.glyphs),
		(Math.floor(tick / RING.pace) % RING.glyphs.length) / RING.glyphs.length,
	)
}

function ring(pane: Pane, at: Point, tick: number, color: string): void {
	put_in(pane, at, ring_glyph(tick), bold(color))
}

function ornament_glyph(index: number, width: number): string {
	if (index === 0 || index === width - 1) return '·'

	return width > ORNAMENT.min && index === Math.floor(width * ORNAMENT.cross) ? '+' : '─'
}

// The ornament line: a dot at each end and a cross along it.
function ornament({ pane, right }: Stage, y: number): void {
	const width = Math.max(0, right - 1)
	const line = Array.from({ length: width }, (_, index) => ornament_glyph(index, width))

	put_in(pane, { x: 1, y }, line.join(''), ink(RGB.plate))
}

function date_of(month: string | undefined, day: string | undefined): string {
	if (month === undefined || day === undefined) return ''
	const number = String(Number(day))

	return `${MONTHS[Number(month) - 1] ?? ''} ${number}${ORDINALS.get(number) ?? 'TH'}`
}

// The date card of the board's own clock: its dated "now" where the board gives one, else the
// header's.
function clock_text(api: ThemeApi): string {
	return api.layout.dated_clocks?.[CARD.row] ?? api.plain(CARD.row)
}

// An hour of the day as the half-day's clock reads it: 12 at noon and at midnight.
function half_hour(hour: number): string {
	const shown = hour % CARD.noon === 0 ? CARD.noon : hour % CARD.noon

	return String(shown).padStart(CARD.digits, '0')
}

function card_of(api: ThemeApi): DateCard | undefined {
	const found = CLOCK.exec(clock_text(api))?.groups

	if (found === undefined) return undefined
	const hour = Number(found['hour'])

	return {
		date: date_of(found['month'], found['day']),
		half: hour < CARD.noon ? 'AM' : 'PM',
		time: `${half_hour(hour)}:${found['minute'] ?? ''}`,
	}
}

// The card's first `limit` letters: the date and the half-day soft, the time white.
function lay_date(pane: Pane, at: Point, card: DateCard, limit: number): void {
	const lead = card.date === '' ? 0 : card.date.length + CARD.gap
	const rest = limit - lead

	put_in(pane, at, card.date.slice(0, limit), ink(RGB.soft))
	if (rest <= 0) return
	put_in(pane, { x: at.x + lead, y: at.y }, card.half.slice(0, rest), ink(RGB.soft))
	put_in(
		pane,
		{ x: at.x + lead + CARD.half, y: at.y },
		card.time.slice(0, Math.max(0, rest - CARD.half)),
		bold(RGB.white),
	)
}

// A triangle cell's face: the left lit, the right darker, each following the glow.
function face_ink(color: string, is_left: boolean, glow: number): string {
	if (is_left) return ink(mix(color, RGB.white, FACE.lit + FACE.lit_glow * glow))

	return ink(mix(color, RGB.night, FACE.dark - FACE.dark_glow * glow))
}

function triangle_row(pane: Pane, at: Point, line: string, inks: readonly [string, string]): void {
	const cells = code_points(line)
	const drawn = [...cells.entries()].filter(([, ch]) => ch !== ' ')

	for (const [index, ch] of drawn) {
		put_in(pane, { x: at.x + index, y: at.y }, ch, inks[index < cells.length / PAIR ? 0 : 1])
	}
}

// The triangle, its top left corner at `at`, breathing — its glow held in `FACE.steps` steps, so its
// cells are rewritten as a step is crossed, not every tick.
function triangle(pane: Pane, at: Point, tick: number, color: string): void {
	const breath = (1 + Math.sin(tick / FACE.breath)) / PAIR
	const glow = Math.round(breath * FACE.steps) / FACE.steps
	const inks = [face_ink(color, true, glow), face_ink(color, false, glow)] as const

	for (const [row, line] of TRIANGLE.entries()) {
		triangle_row(pane, { x: at.x, y: at.y + row }, line, inks)
	}
}

const run_board_theme_deviant_parts = {
	bar_width,
	bold,
	card_of,
	duo,
	ink,
	lay_date,
	mix,
	on,
	ornament,
	plate,
	ring,
	ring_glyph,
	stage_of,
	triangle,
}

export { run_board_theme_deviant_parts }
export type { DateCard, Stage }
