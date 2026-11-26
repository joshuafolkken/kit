import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Cell, Channel } from './run-board-theme-host-types'
import { run_board_theme_trace_data, type TraceView } from './run-board-theme-trace-data'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// MATRIX's typing (joshuafolkken/kit#8917), from the confirmed theme demo: the progress line's glow
// (run-board-type-glow.ts), the new lane decoding out of dark rain (run-board-decode.ts) and the
// notice locking out of spinning glyphs (run-board-notice-trace.ts).

const { cell_at, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { REROLL, SALT } = run_board_theme_trace_data
const { BRIGHT_ON, DARK_ON, HEAD_ON, glyph } = run_board_theme_trace_paint

// Every letter stays bright for ten ticks after the last; the last two and the cursor glow white.
const GLOW_TICKS = 10
const GLOW_LEAD = 2
// The decode re-picks its dark glyphs every eight columns; its next two cells show the row's own.
const DECODE_EPOCH = 8
const DECODE_LEAD = 2

function is_glowing(progress: Channel): boolean {
	return progress.index >= 0 && (progress.is_typing || progress.cooled < GLOW_TICKS)
}

function glow_paint(progress: Channel, index: number): string {
	return progress.is_typing && index >= progress.length - GLOW_LEAD ? HEAD_ON : BRIGHT_ON
}

function glow_cell(view: TraceView, index: number): void {
	const { progress } = view.s
	const { y, x } = view.layout.progress

	if (index >= progress.length && !progress.is_typing) return
	const [ch] = cell_at(view.grid, y, x + index)

	set_cell(view.grid, { y, x: x + index }, [ch, glow_paint(progress, index)])
}

// The progress line: early letters bright, the last two and the cursor in head white; every
// letter bright for a while after the last.
function type_glow(view: TraceView): void {
	const { progress } = view.s
	const { x, end } = view.layout.progress

	if (!is_glowing(progress)) return

	for (let index = 0; index <= progress.length && x + index < end; index++) glow_cell(view, index)
}

function decoded_cell(view: TraceView, x: number, epoch: number): Cell {
	const { row } = view.layout
	const [ch, style] = cell_at(view.api.board, row.y, x)

	if (x < row.x + view.s.row.length + DECODE_LEAD) return [ch, HEAD_ON]
	if (ch === ' ') return [' ', style]
	const seed = hash(x, view.tick, SALT.reroll) < REROLL ? view.tick : epoch

	return [glyph(hash(x, seed, SALT.decode)), DARK_ON]
}

// The new lane: resolved columns in their own style, the next two the row's own characters in head
// white, the rest dark rain glyphs re-picked every eight columns, each cell rerolling for a frame.
function decode(view: TraceView): void {
	const { row } = view.s

	if (!row.is_typing) return
	const epoch = Math.floor(row.length / DECODE_EPOCH)
	const { y, x: from } = view.layout.row

	for (let x = from + row.length; x < view.row_last; x++) {
		set_cell(view.grid, { y, x }, decoded_cell(view, x, epoch))
	}
}

// The notice: the letters not yet locked spin as fresh rain glyphs in head white; they lock left
// to right, a letter a tick.
function notice_lock(view: TraceView): void {
	const typed = view.s.notice_text

	if (typed.index < 0 || !typed.is_typing) return
	const { y, x } = view.layout.notice

	for (let index = typed.length; index < typed.total; index++) {
		const seed = hash(index, view.tick, SALT.lock)

		if (typed.text[index] !== ' ') set_cell(view.grid, { y, x: x + index }, [glyph(seed), HEAD_ON])
	}
}

const run_board_theme_trace_decode = { decode, notice_lock, type_glow }

export { run_board_theme_trace_decode }
