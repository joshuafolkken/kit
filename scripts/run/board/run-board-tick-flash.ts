import { run_board_change_flash, type Flash } from './run-board-change-flash'
import { run_board_fit } from './run-board-fit'
import { run_board_lamps } from './run-board-lamps'
import { run_board_notice_turn, type NoticePlace } from './run-board-notice-turn'
import { run_board_spin, type Spun } from './run-board-spin'
import type { BoardPorts } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs } from './run-board-theme-defs'
import type { KeyedLine, Typing } from './run-board-type-rows'

// joshuafolkken/kit#8353: the change flash one `run:board` redraw carries on — the lines whose identity
// holds across redraws, diffed against the last frame's, on a live board in a theme that flashes, on a
// terminal drawing color.

const FIXED_HEADER_LINES = 2

type FlashPorts = Pick<BoardPorts, 'theme' | 'icons' | 'size' | 'is_tty' | 'opened_ms'>

interface FlashRedraw {
	ports: FlashPorts
	now_ms: number
}

// The frame's cells the flash reads, and the header notice's while it traces (joshuafolkken/kit#8657).
type FlashDrawn = Pick<Spun, 'lines' | 'keyed' | 'spots'> &
	Partial<Pick<Spun, 'lamps'>> & { notice?: NoticePlace | undefined }

// The cells written between redraws by their own writers — the spinners and the lamps, which write
// only what changed, and the tracing notice — so a flash restored over them would leave the frame's
// glyph, not theirs.
function is_owned(drawn: FlashDrawn, cell: { row: number; column: number }): boolean {
	const owned = [...drawn.spots, ...(drawn.lamps ?? [])]
	const is_spot = owned.some((spot) => spot.row === cell.row && spot.column === cell.column)

	return is_spot || run_board_notice_turn.covers(drawn.notice, cell)
}

// Only the fixed header and producer-keyed rows hold their identity across redraws; a line the pane
// wraps or cuts off is left out.
function flash_lines(drawn: FlashDrawn, ports: FlashPorts): Array<KeyedLine> {
	const keyed = new Map(drawn.keyed.map((line) => [line.index, line]))
	const size = ports.size?.()
	const columns = size?.columns ?? Infinity
	const starts = run_board_spin.starts_of(drawn.lines, columns)
	const lines = drawn.lines
		.map((text, index) => ({ text, index }))
		.filter(({ index }) => index < FIXED_HEADER_LINES || keyed.has(index))
		.map(({ text, index }) => ({
			key: keyed.get(index)?.key ?? `fixed:${String(index)}`,
			index,
			row: starts[index] ?? 1,
			prefix_columns: 0,
			text: run_board_theme.restyle(ports.theme, text, ports.icons),
			source: text,
		}))

	return lines.filter(
		(line) =>
			line.row <= (size?.rows ?? Infinity) && run_board_fit.height_of(line.text, columns) === 1,
	)
}

// Whether the board flashes — or traces its notice in (joshuafolkken/kit#8657): a live board on a
// terminal drawing color, in a theme that switches the effect on.
function is_enabled(ports: FlashPorts, effect: 'flash' | 'notice_trace' = 'flash'): boolean {
	const is_live = ports.is_tty && ports.opened_ms !== undefined

	return (
		is_live &&
		run_board_theme_defs.live_of(ports.theme)[effect] === true &&
		run_board_lamps.is_colored()
	)
}

// The flash after this frame, none where the board does not flash; a typing row, a spinner's cell and
// a lamp never flash.
function flash_of(
	last: Flash | undefined,
	drawn: FlashDrawn,
	redraw: FlashRedraw,
	typing: Typing,
): Flash | undefined {
	if (!is_enabled(redraw.ports)) return undefined
	const typing_keys = new Set(typing.lines.map((line) => line.key))
	const lines = flash_lines(drawn, redraw.ports).filter((line) => !typing_keys.has(line.key))
	const flash = run_board_change_flash.next(last, lines, redraw.now_ms)

	return { ...flash, cells: flash.cells.filter((cell) => !is_owned(drawn, cell)) }
}

const run_board_tick_flash = { flash_of, is_enabled }

export { run_board_tick_flash }
