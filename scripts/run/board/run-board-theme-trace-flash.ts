import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Channel, Point, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_trace_data, type TraceView } from './run-board-theme-trace-data'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'
import { run_board_theme_trace_rain } from './run-board-theme-trace-rain'

// MATRIX's peak (joshuafolkken/kit#8917), from the confirmed theme demo: deja vu
// (run-board-deja-vu.ts) and the change flash in waves (run-board-change-flash.ts), whose cell the
// running clocks flash with too.

const { ESC, cell_at, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { TRACE_END, TRACE_EVERY } = run_board_theme_host_state
const { CELL_KEY, COLORS, FLASH, SALT, SHADE } = run_board_theme_trace_data
const { HEAD_ON, glyph, mix, paint } = run_board_theme_trace_paint
const { may_paint } = run_board_theme_trace_rain

// Deja vu: the lane rows three columns right, a quarter of their glyphs swapped, in two bursts.
const DEJA = { shift: 3, swap: 0.25, first_end: 3, second_from: 8, second_end: 11 }
// A cell the wave reaches flashes for two ticks, then fades by 0.78 a tick until its own style.
const FLASH_HEAD_TICKS = 2
const FADE_TICKS = 19
const FADE_RATE = 0.78
const FADE: ReadonlyArray<number> = Array.from(
	{ length: FADE_TICKS },
	(_, age) => FADE_RATE ** (age - 1),
)
// Half the cells take a bar's wave; it crosses eight columns a tick, three rows apart.
const WAVE = { share: 0.5, columns: 8, rows: 3 }
const DECODED = /^[!-~]$/u
const ROLES: ReadonlyMap<string, string> = new Map(Object.entries(COLORS))

function burst_of(age: number): number {
	if (age < DEJA.first_end) return 0

	return age >= DEJA.second_from && age < DEJA.second_end ? 1 : -1
}

function deja_cell(source: ReadonlyArray<string>, at: Point, burst: number): Cell {
	const ch = at.x >= DEJA.shift ? (source[at.x - DEJA.shift] ?? ' ') : ' '
	const is_swapped = ch !== ' ' && hash(at.x * CELL_KEY.x + at.y, burst, SALT.deja) < DEJA.swap

	return [is_swapped ? glyph(hash(at.x, at.y, SALT.swap + burst)) : ch, HEAD_ON]
}

function deja_row(view: TraceView, y: number, burst: number): void {
	const source = (view.grid[y] ?? []).map(([ch]) => ch)

	for (let x = view.layout.w - 1; x >= 0; x--) {
		set_cell(view.grid, { y, x }, deja_cell(source, { x, y }, burst))
	}
}

// Deja vu: the lane rows drawn three columns right in head white, a quarter of their glyphs
// swapped, in two short bursts.
function deja_vu(view: TraceView): void {
	const { notice } = view.s

	if (notice.index < 0 || notice.is_typing) return
	const burst = burst_of(notice.cooled)

	if (burst < 0) return

	for (const y of view.layout.lane_rows) deja_row(view, y, burst)
}

function is_flashing(notice: Channel): boolean {
	return notice.index >= 0 && !notice.is_typing && notice.cooled < TRACE_END
}

// How many ticks into its change flash a cell is, or -1 when no wave reaches it.
function flash_age(state: ThemeState, x: number, y: number): number {
	const { notice } = state

	if (!is_flashing(notice)) return -1
	const bar = Math.floor(notice.cooled / TRACE_EVERY)

	if (hash(x * CELL_KEY.x + y, bar, SALT.flash) >= WAVE.share) return -1

	return notice.cooled - bar * TRACE_EVERY - Math.floor(x / WAVE.columns) - (y % WAVE.rows)
}

function own_color(style: string): string {
	return ROLES.get(style.split(':', 1)[0] ?? '') ?? COLORS.body
}

// When a flash's tick a printable ASCII character shows as a katakana picked by tick and column.
function flash_char(ch: string, x: number, beat: Beat): string {
	if (beat.age >= FLASH_HEAD_TICKS || !DECODED.test(ch)) return ch

	return FLASH[(beat.tick + x + 1) % FLASH.length] ?? ch
}

// How far into a flash a cell is, and the frame's tick.
interface Beat {
	age: number
	tick: number
}

// One cell `age` ticks into its change flash: head white for its first two ticks (a katakana
// standing in for a printable ASCII character), then its own character with the gap to its own
// color shrinking each tick; its own style back once the fade is done.
function flash_cell(view: TraceView, at: Point, cell: Cell, beat: Beat): void {
	const { age } = beat

	if (age < 0 || age >= FADE_TICKS) return
	const [ch, style] = cell
	const fading = mix(own_color(style), SHADE.head, FADE[age] ?? 0)
	const faded = age < FLASH_HEAD_TICKS ? HEAD_ON : paint(fading)

	set_cell(view.grid, at, [flash_char(ch, at.x, beat), faded])
}

function is_steady(view: TraceView, cell: Cell, at: Point): boolean {
	return cell[0] === ' ' || cell[1].startsWith(ESC) || !may_paint(view, at.x, at.y)
}

function flash_row(view: TraceView, y: number): void {
	for (let x = 0; x < (view.grid[y]?.length ?? 0); x++) {
		const cell = cell_at(view.grid, y, x)
		const at = { x, y }

		if (!is_steady(view, cell, at)) {
			flash_cell(view, at, cell, { age: flash_age(view.s, x, y), tick: view.tick })
		}
	}
}

// The change flash in waves: with each bar of the trace a wave crosses the board left to right; a
// cell it reaches shows a katakana in head white for two ticks, then fades to its own color.
function change_flash(view: TraceView): void {
	if (view.s.notice.index < 0 || view.s.notice.is_typing) return

	for (let y = 0; y < view.grid.length; y++) flash_row(view, y)
}

const run_board_theme_trace_flash = { burst_of, change_flash, deja_vu, flash_age, flash_cell }

export { run_board_theme_trace_flash }
export type { Beat }
