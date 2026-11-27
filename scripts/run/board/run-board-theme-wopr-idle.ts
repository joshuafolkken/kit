import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_led } from './run-board-theme-wopr-led'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'
import { run_board_theme_wopr_place, type RuleCell, type Wopr } from './run-board-theme-wopr-place'

// The WARGAMES theme's board between events (joshuafolkken/kit#8917), ported from the confirmed theme
// demo, itself a port of kit's live board: the lamp panel, the sweep, the rules' launch code, DEFCON,
// the lane cracking in and the PROGRESS strip.

const { BOLD, ESC, cell_at, level_x, put, repeated, rows_to, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { TICK_MS } = run_board_theme_host_state
const { CODE, INK, NAMED, SHADES, STRIP_RANK, THE_CODE } = run_board_theme_wopr_data
const { LETTER_POOL } = run_board_theme_wopr_led
const { code_char, cooled_of, cycled, is_progress, is_row, is_typing, level_of, mixed } =
	run_board_theme_wopr_phase
const { SCATTER_STEPS } = run_board_theme_wopr_place

// lamps.ts:63-76: a group of four holds for 3..18 steps from its own phase, 40 of 100 lit; in a burst
// (a row typing at the step's start, spin-turn.ts:156-161) every group changes every step.
const LAMP = { step_ms: 80, group: 4, row_groups: 1000, every: 2 }
const PERIOD = { least: 3, spread: 16, salt: 1, phase_salt: 2 }
const LIT = { odds: 40, of: 100 }
// `DEFCON 5 4 3 2 1`: at 1 the bracket blinks three ticks in six. The whole scale, one step bracketed,
// sits flush with the rule's right end.
const DEFCON = { label: ' DEFCON', top: 5, calm: 5, blink: 6, dark: 3 }
const DEFCON_SCALE = ' DEFCON [5] 4 3 2 1'
// ROW: the three newest letters are the lock head, the five cells ahead of the block spin code.
const CRACK = { head: 3, ahead: 5, salt: 11 }
// The PROGRESS strip: three letters, each another on every tick until it locks.
const STRIP = { letters: 3, salt: 53 }

function calm_epoch(step: number, group: number): number {
	const period = PERIOD.least + (mixed([group, PERIOD.salt]) % PERIOD.spread)

	return Math.floor((step + (mixed([group, PERIOD.phase_salt]) % period)) / period)
}

function is_lit(ms: number, group: number, lamp: number, is_burst: boolean): boolean {
	const step = Math.floor(ms / LAMP.step_ms)
	const epoch = is_burst ? step : calm_epoch(step, group)

	return mixed([group, epoch, lamp]) % LIT.of < LIT.odds
}

// An out lamp's style on `row`: its row's own.
function out_ink(row: number): string {
	return SHADES[row]?.out ?? ''
}

// A lamp's look: kit's blink. (ROW and NOTICE cover the panel.)
function lamp_style(tick: number, lamp: { row: number; index: number }, is_burst: boolean): string {
	const { row, index } = lamp
	const group = row * LAMP.row_groups + Math.floor(index / LAMP.group)
	const is_on = is_lit(tick * TICK_MS, group, index % LAMP.group, is_burst)

	return (is_on ? SHADES[row]?.lit : undefined) ?? out_ink(row)
}

type LampStyle = (row: number, index: number) => string

// From two columns past the throughput rows' NOW, a `■` every other column up to the rule's end, on
// seven rows (lamps.ts:41-42), cut at the area's last row.
function paint_lamps(wopr: Wopr, grid: Grid, style_at: LampStyle): void {
	const { x, count, top } = wopr.lamps
	const area = rows_to(grid, wopr.bottom)

	for (const row of SHADES.keys()) {
		for (let index = 0; index < count; index++) {
			set_cell(area, { y: top + row, x: x + LAMP.every * index }, ['■', style_at(row, index)])
		}
	}
}

function draw_lamps(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const is_burst = is_typing(state)

	paint_lamps(wopr, grid, (row, index) => lamp_style(tick, { row, index }, is_burst))
}

// The sweep's twenty cells on the empty line under the header, its dot `dot` cells in; none when the
// dot is undefined.
function sweep_at(wopr: Wopr, grid: Grid, dot: number | undefined): void {
	const { mark_x, sweep } = wopr

	if (mark_x < 0 || wopr.api.plain(sweep.y).trim() !== '') return
	put(grid, { y: sweep.y, x: sweep.left }, repeated(' ', sweep.cells), 'body')
	if (dot !== undefined) put(grid, { y: sweep.y, x: sweep.left + dot }, '■', 'body')
}

// The sweep: twenty cells on the empty line under the header, a cell a tick. The dot is cyan.
function draw_sweep(wopr: Wopr, grid: Grid, tick: number): void {
	sweep_at(wopr, grid, tick % wopr.sweep.cells)
}

// A rule's dash as a code character, another on every tick (measured on the film's frames).
function code_cell(grid: Grid, cell: RuleCell, tick: number): void {
	const { y, x } = cell

	if (cell_at(grid, y, x)[0] !== '-') return
	set_cell(grid, cell, [cycled(CODE, tick, hash(y + 1, x + 1, tick)), 'rule'])
}

// Every section rule's dash runs code while a row types; once the last row has typed through, each
// cell turns back to `-` on a step of its own, all within twenty steps (run-board-codes.ts).
function draw_codes(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const cooled = cooled_of(state)

	if (cooled >= SCATTER_STEPS) return

	for (const cell of wopr.rule_cells) {
		if (cell.back >= cooled) code_cell(grid, cell, tick)
	}
}

// The level alone bracketed in its named color, bold below 5; at 1 the bracket blinks.
function defcon_ink(level: number, step: number, tick: number): string {
	if (level === 1 && tick % DEFCON.blink >= DEFCON.dark) return INK.dim_red

	return `${ESC}3${NAMED.charAt(step - 1)}m${level < DEFCON.calm ? BOLD : ''}`
}

// One step of the scale at `at`; the column after it.
function defcon_step(
	grid: Grid,
	at: Point,
	step: number,
	now: { level: number; tick: number },
): number {
	const is_level = step === now.level
	const text = is_level ? `[${String(step)}]` : String(step)
	const ink = defcon_ink(now.level, step, now.tick)

	put(grid, at, ` ${text}`, 'body')
	if (is_level) put(grid, { y: at.y, x: at.x + 1 }, text, ink)

	return at.x + text.length + 1
}

// `DEFCON 5 4 3 2 1` at the throughput rule's end (run-board-header-defcon.ts), the rest in cyan: the
// board's real level where the host gives one, else the theme's own.
function draw_defcon(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const { level_spot } = wopr.api.layout
	const { y } = level_spot
	const now = { level: state.event.level ?? level_of(state), tick }
	const start = level_x(level_spot, DEFCON_SCALE.length)
	let x = start + DEFCON.label.length

	put(grid, { y, x: start }, DEFCON.label, 'body')

	for (let step = DEFCON.top; step >= 1; step--) x = defcon_step(grid, { y, x }, step, now)
}

// The three newest letters: the lock head in white during ROW, the frame's own style otherwise.
function crack_head(wopr: Wopr, grid: Grid, shown: number, is_cracking: boolean): void {
	const { y, x: from } = wopr.api.layout.row

	for (let x = Math.max(from, shown - CRACK.head); x < shown; x++) {
		const style = is_cracking ? INK.white_on : cell_at(wopr.api.board, y, x)[1]

		set_cell(grid, { y, x }, [cell_at(grid, y, x)[0], style])
	}
}

// The five cells ahead of the block spin code where the lane has text.
function crack_ahead(wopr: Wopr, grid: Grid, shown: number, tick: number): void {
	const { layout, board } = wopr.api
	const { y } = layout.row

	for (let x = shown + 1; x <= shown + CRACK.ahead && x < layout.w; x++) {
		const cell: Cell = [code_char(x, tick, CRACK.salt), 'body:dim']

		if (cell_at(board, y, x)[0] !== ' ') set_cell(grid, { y, x }, cell)
	}
}

// ROW: the lane cracks in (typing.ts, type-rows.ts:117).
function crack_row(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const { row } = state

	if (!row.is_typing) return
	const shown = wopr.api.layout.row.x + row.length
	const is_cracking = is_row(state)

	crack_head(wopr, grid, shown, is_cracking)
	if (is_cracking) crack_ahead(wopr, grid, shown, tick)
}

function strip_letter(index: number, locked: number, tick: number): Cell {
	if (Number(STRIP_RANK.charAt(index)) < locked) return [THE_CODE.charAt(index), INK.orange_on]

	return [cycled(LETTER_POOL, tick, hash(index, tick, STRIP.salt)), INK.orange_dim]
}

// PROGRESS: beside DEFCON, `CPE` in orange, its letters locking (P, E, C) at a third, two thirds and
// the end of the now line's typing.
function progress_strip(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	if (!is_progress(state)) return
	const { progress } = state
	const locked = Math.floor((STRIP.letters * progress.length) / Math.max(1, progress.total))
	const { y } = wopr.api.layout.level_spot
	const x = wopr.strip_x

	put(grid, { y, x: x - 1 }, ' ', 'rule')

	for (let index = 0; index < STRIP.letters; index++) {
		const [ch, style] = strip_letter(index, locked, tick)

		put(grid, { y, x: x + index }, ch, style)
	}

	put(grid, { y, x: x + STRIP.letters }, ' ', 'rule')
}

const run_board_theme_wopr_idle = {
	crack_row,
	draw_codes,
	draw_defcon,
	draw_lamps,
	draw_sweep,
	is_lit,
	out_ink,
	paint_lamps,
	progress_strip,
	sweep_at,
}

export { run_board_theme_wopr_idle }
