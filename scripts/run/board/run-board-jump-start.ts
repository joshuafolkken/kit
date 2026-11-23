import { run_board_drop_screen, type FrameSpots } from './run-board-drop-screen'
import { run_board_fire_trail } from './run-board-fire-trail'
import type { TerminalSize } from './run-board-fit'
import { run_board_jump, type JumpRun } from './run-board-jump'
import type { JumpScene } from './run-board-jump-paint'
import type { JumpDraw } from './run-board-jump-screen'
import { run_board_lamps } from './run-board-lamps'
import type { PanelArea } from './run-board-panel-draw'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import type { Theme } from './run-board-theme-defs'
import { run_board_type_rows, type Typing, type TypingLine } from './run-board-type-rows'

// joshuafolkken/kit#8677, joshuafolkken/kit#8731: when a frame starts or carries on the bttf time jump.
// A jump starts on a terminal drawing color when a row starts typing — the cue the wargames lamps' burst
// and the matrix pour read — whatever the row, runs as many ticks as the row has letters, and is never
// restarted by a row that starts typing while it runs. A typing is taken as a cue once, by when it
// started, so a frame drawn late still starts its jump from its first letter. Each frame redraws the
// jump over its own cells.

const JUMP_THEMES: ReadonlySet<Theme> = new Set(['bttf'])
const { THAW_AT, TICK_MS } = run_board_jump
const { letters_of } = run_board_type_rows

// What a frame gives the jump: its ports, its cells, the rows typing, the animation area where it is
// out and its moment.
interface JumpFrame {
	ports: Pick<BoardPorts, 'theme' | 'is_tty' | 'icons' | 'opened_ms'>
	drawn: FrameSpots & { size: TerminalSize | undefined }
	typing: Typing
	area: PanelArea | undefined
	now_ms: number
}

// What the board keeps of the jump between frames.
type JumpState = Pick<BoardState, 'jump' | 'arrive_ms' | 'cued_ms'>

function is_jump_board(ports: JumpFrame['ports']): boolean {
	if (ports.theme === undefined || !JUMP_THEMES.has(ports.theme)) return false

	return ports.is_tty && run_board_lamps.is_colored()
}

// The rows that started typing after `cued_ms`, every typing row with none cued yet.
function fresh_of(typing: Typing, cued_ms: number | undefined): Array<TypingLine> {
	return typing.lines.filter(
		(line) => line.start_ms > (cued_ms ?? -Infinity) && letters_of(line) > 0,
	)
}

// The run a frame starts on a typing not yet cued: from its first letter, over the longest such row.
function started(frame: JumpFrame, cued_ms: number | undefined): JumpRun | undefined {
	if (!is_jump_board(frame.ports)) return undefined
	const fresh = fresh_of(frame.typing, cued_ms)
	const [longest] = fresh.toSorted((left, right) => letters_of(right) - letters_of(left))

	return longest === undefined
		? undefined
		: { start_ms: longest.start_ms, letters: letters_of(longest) }
}

// The latest moment a typing row started, the last one kept: every typing the frame shows is cued.
function cued_of(last_ms: number | undefined, typing: Typing): number | undefined {
	const latest = Math.max(last_ms ?? -Infinity, ...typing.lines.map((line) => line.start_ms))

	return Number.isFinite(latest) ? latest : undefined
}

// The board the run is painted on this frame, drawn as the theme draws it.
function draw_of(run: JumpRun, frame: JumpFrame): JumpDraw {
	const { ports, drawn, area } = frame
	const lines = drawn.lines.map((line) => run_board_theme.restyle(ports.theme, line, ports.icons))
	const drawn_screen = run_board_drop_screen.screen_of(
		{ ...drawn, lines },
		frame.typing,
		drawn.size,
	)
	const texts = drawn_screen.rows.map((row) => row.map((cell) => cell.text).join(''))
	const trails = run_board_fire_trail.rows_of(texts)
	const screen = run_board_fire_trail.padded(drawn_screen, trails)
	const scene: JumpScene = {
		rows: screen.rows.length,
		panel: area === undefined ? undefined : { top: area.top - 1, rows: area.rows },
		trails,
	}

	return { run, screen, scene, panel: area }
}

// The last run carried on while it runs — joshuafolkken/kit#8675: once thawed, with only its trails
// burning out, it yields to a typing that starts a jump.
function carried(
	last: JumpDraw | undefined,
	frame: JumpFrame,
	cued_ms: number | undefined,
): JumpRun | undefined {
	if (last === undefined || !run_board_jump.is_running(last.run, frame.now_ms)) return undefined

	if (run_board_jump.is_thawed(last.run, frame.now_ms) && started(frame, cued_ms) !== undefined) {
		return undefined
	}

	return last.run
}

// The jump a frame draws: the last one carried on, else one a typing not cued by `cued_ms` starts.
function jump_of(
	last: JumpDraw | undefined,
	frame: JumpFrame,
	cued_ms?: number,
): JumpDraw | undefined {
	const run = carried(last, frame, cued_ms) ?? started(frame, cued_ms)

	return run === undefined ? undefined : draw_of(run, frame)
}

// When the panel's arrival started, kept once set: a live jump board's first frame with the animation
// area out starts it at its thaw — the intro's beats draw no panel, so the figure thaws from ice and the
// readout brakes from 88 as the painter takes over.
function arrive_of(last_ms: number | undefined, frame: JumpFrame): number | undefined {
	if (last_ms !== undefined || frame.area === undefined) return last_ms
	if (frame.ports.opened_ms === undefined || !is_jump_board(frame.ports)) return undefined

	return frame.now_ms - THAW_AT * TICK_MS
}

// What a frame leaves of the jump: the jump it draws, the arrival and the typing it has cued.
function jump_state(last: JumpState, frame: JumpFrame): JumpState {
	return {
		jump: jump_of(last.jump, frame, last.cued_ms),
		arrive_ms: arrive_of(last.arrive_ms, frame),
		cued_ms: cued_of(last.cued_ms, frame.typing),
	}
}

const run_board_jump_start = { arrive_of, jump_of, jump_state }

export { run_board_jump_start }
export type { JumpFrame, JumpState }
