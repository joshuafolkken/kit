import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Grid, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_nixie_data, type NixieDraw } from './run-board-theme-nixie-data'

// STEINS;GATE's giant meter (joshuafolkken/kit#8917), ported from the confirmed theme demo: the
// NOTICE's centerpiece. Once the mail is in, the meter itself takes the whole area in digits eight
// rows tall. They spin until the effect peaks, then lock one by one on the β reading, each flashing
// white as it lands, and hold while the rest of the board goes dim.

const { BOLD, code_points, digit, fg, put } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { trace_on } = run_board_theme_host_flash
const { NOTICE_END, TRACE_ON } = run_board_theme_host_state
const { BETA_LINES, BLINK, COLOR, GIANT, GIANT_FROM, GIANT_X, LOCK_STEP, SEGMENTS, nth } =
	run_board_theme_nixie_data

const GIANT_HOLD = NOTICE_END
const SPIN_SALT = 23
// A tube flashes white for four ticks after it locks; landed, the digits glow on four ticks in eight.
const WHITE_AFTER = 4
const GLOW_BEAT = { every: 8, lit: 4 }
// The words left of the meter: the name, then two rows for the field.
// Rows as offsets from the area's top (joshuafolkken/kit#8917; the demo's area_top was 4).
const WORDS = { x: 1, name_y: 1, top_y: 3, bottom_y: 4 }

type Phase = 'lock' | 'spin'

// How a giant digit is drawn: the character, its lit bars' style and its unlit bars' style.
interface GiantLook {
	ch: string
	style: string
	ghost: string
}

interface GiantTube {
	x: number
	index: number
	ch: string
}

// The bars a row of a digit crosses: the top, the middle and the bottom.
function row_bars(cy: number): Array<string> {
	if (cy === 0) return ['a']
	if (cy === GIANT.mid) return ['g']

	return cy === GIANT.h - 1 ? ['d'] : []
}

// A side's bars at row `cy`: the upper one above the middle, the lower below, both on it.
function side_bars(cy: number, upper: string, lower: string): Array<string> {
	if (cy < GIANT.mid) return [upper]

	return cy > GIANT.mid ? [lower] : [upper, lower]
}

// The seven-segment bars a cell of a 9 by 8 digit belongs to.
function segments_at(cx: number, cy: number): Array<string> {
	const left = cx <= GIANT.left ? side_bars(cy, 'f', 'e') : []
	const right = cx >= GIANT.right ? side_bars(cy, 'b', 'c') : []

	return [...row_bars(cy), ...left, ...right]
}

// A cell's style: lit when a bar it belongs to is lit, unlit otherwise; none off every bar.
function bar_style(bars: ReadonlyArray<string>, look: GiantLook): string | undefined {
	if (bars.length === 0) return undefined
	const lit = SEGMENTS[Number(look.ch)] ?? ''

	return bars.some((bar) => lit.includes(bar)) ? look.style : look.ghost
}

function giant_row(grid: Grid, at: Point, cy: number, look: GiantLook): void {
	for (let cx = 0; cx < GIANT.w; cx++) {
		const style = bar_style(segments_at(cx, cy), look)

		if (style !== undefined) put(grid, { y: at.y, x: at.x + cx }, '█', style)
	}
}

// A digit 9 cells by 8 with its top left at `at`.
function giant_digit(grid: Grid, at: Point, look: GiantLook): void {
	for (let cy = 0; cy < GIANT.h; cy++) giant_row(grid, { y: at.y + cy, x: at.x }, cy, look)
}

// The meter's point: two blocks on the area's last two rows.
function giant_point(grid: Grid, area_end: number, x: number, style: string): void {
	for (const y of [area_end - 1, area_end]) put(grid, { y, x }, '██', style)
}

// The words left of the meter: its name, and the field in two rows.
function giant_words(
	grid: Grid,
	area_top: number,
	field: ReadonlyArray<string>,
	style: string,
): void {
	const [top = '', bottom = ''] = field

	put(grid, { y: area_top + WORDS.name_y, x: WORDS.x }, 'DIVERGENCE', `${fg(COLOR.amber)}${BOLD}`)
	put(grid, { y: area_top + WORDS.top_y, x: WORDS.x }, top, style)
	put(grid, { y: area_top + WORDS.bottom_y, x: WORDS.x }, bottom, style)
}

// While the notice types the giant meter spins once the mail is in; afterward it holds, locked.
function typing_phase(notice: Channel): Phase | undefined {
	if (notice.is_typing) return notice.length / notice.total >= GIANT_FROM ? 'spin' : undefined

	return notice.cooled < GIANT_HOLD ? 'lock' : undefined
}

function giant_phase(state: ThemeState): Phase | undefined {
	return state.notice.index < 0 ? undefined : typing_phase(state.notice)
}

// Landed, the digits glow white with each bar of the trace.
function lit_glow(state: ThemeState, tick: number): string {
	if (state.notice.cooled >= TRACE_ON && trace_on(state)) return COLOR.giant_lit

	return tick % GLOW_BEAT.every < GLOW_BEAT.lit ? COLOR.giant_warm : COLOR.amber
}

function giant_glow(state: ThemeState, tick: number, is_locked: boolean, index: number): string {
	if (!is_locked) return COLOR.spin
	if (state.notice.cooled < LOCK_STEP * index + WHITE_AFTER) return COLOR.white

	return lit_glow(state, tick)
}

// One tube of the giant meter, or its point; the column the next one starts at.
function giant_tube(frame: NixieDraw, tube: GiantTube, phase: Phase): number {
	const { grid, state, tick, api } = frame
	const { x, index, ch } = tube

	if (ch === '.') {
		giant_point(grid, api.layout.area_end, x, `${fg(COLOR.amber)}${BOLD}`)

		return x + GIANT.point_step
	}

	const is_locked = phase === 'lock' && state.notice.cooled >= LOCK_STEP * index
	const shown = is_locked ? ch : digit(hash(tick, index, SPIN_SALT))
	const style = `${fg(giant_glow(state, tick, is_locked, index))}${BOLD}`

	giant_digit(
		grid,
		{ y: api.layout.area_top, x },
		{ ch: shown, style, ghost: fg(COLOR.giant_ghost) },
	)

	return x + GIANT.step
}

function giant_labels(frame: NixieDraw, is_landed: boolean, x: number): void {
	const { grid, tick, api } = frame
	const label = `${fg(is_landed || tick % BLINK.every < BLINK.lit ? COLOR.label : COLOR.amber)}${BOLD}`
	const field = is_landed ? ['β ATTRACTOR', 'FIELD'] : ['WORLD LINE', 'SHIFTING…']

	giant_words(grid, api.layout.area_top, field, label)
	put(grid, { y: api.layout.area_end, x: x + 1 }, '%', `${fg(COLOR.amber)}${BOLD}`)
}

// Every tube and the point of `value`; the column after the last.
function giant_tubes(frame: NixieDraw, value: string, phase: Phase): number {
	let x = GIANT_X

	for (const [index, ch] of code_points(value).entries()) {
		x = giant_tube(frame, { x, index, ch }, phase)
	}

	return x
}

// The NOTICE's centerpiece; whether it took the area.
function giant_meter(frame: NixieDraw): boolean {
	const { state, api } = frame
	const phase = giant_phase(state)

	if (!phase) return false
	const value = nth(BETA_LINES, state.notice.index)
	const is_landed = phase === 'lock' && state.notice.cooled >= LOCK_STEP * value.length

	api.clear_area(frame.grid)
	giant_labels(frame, is_landed, giant_tubes(frame, value, phase))

	return true
}

const run_board_theme_nixie_giant = {
	giant_digit,
	giant_meter,
	giant_phase,
	giant_point,
	giant_words,
	segments_at,
}

export { run_board_theme_nixie_giant }
export type { GiantLook }
