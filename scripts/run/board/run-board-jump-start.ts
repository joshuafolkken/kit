import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_drop_screen, type FrameSpots } from './run-board-drop-screen'
import { run_board_fire_trail } from './run-board-fire-trail'
import type { TerminalSize } from './run-board-fit'
import type { Notice } from './run-board-header-notice'
import { run_board_jump, type JumpRun } from './run-board-jump'
import { run_board_jump_paint, type JumpScene } from './run-board-jump-paint'
import { run_board_jump_screen, type GoneRow, type JumpDraw } from './run-board-jump-screen'
import { run_board_lamps } from './run-board-lamps'
import { run_board_lane_swap, type LaneMemory } from './run-board-lane-swap'
import { run_board_notice_trace } from './run-board-notice-trace'
import type { NoticePlace, NoticeTurn } from './run-board-notice-turn'
import type { PanelArea } from './run-board-panel-draw'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import type { Theme } from './run-board-theme-defs'
import type { KeyedLine, Typing } from './run-board-type-rows'

// joshuafolkken/kit#8677: when a frame starts or carries on the bttf time jump. A jump starts on the
// first letter of a lane's merge notice (`lane-end`) typing on a terminal drawing color, runs as many
// ticks as the notice has letters, and is never restarted by the next merge notice while it runs.
// Each frame redraws it over its own cells.

const JUMP_THEMES: ReadonlySet<Theme> = new Set(['bttf'])
// The header's rows, which the merging lane's row is never among.
const { HEADER_ROWS } = run_board_jump_paint
const { THAW_AT, TICK_MS } = run_board_jump
const { NO_TYPING } = run_board_jump_screen
const { left_lane } = run_board_lane_swap

// What a frame gives the jump: its ports, the notice it shows and its trace, its cells and keyed rows,
// the rows typing, the animation area where it is out, its moment and the lane rows the board dropped.
interface JumpFrame {
	ports: Pick<BoardPorts, 'theme' | 'is_tty' | 'icons' | 'opened_ms'>
	notice: Notice | undefined
	turn: NoticeTurn | undefined
	drawn: FrameSpots & {
		size: TerminalSize | undefined
		keyed?: ReadonlyArray<KeyedLine> | undefined
	}
	typing: Typing
	area: PanelArea | undefined
	now_ms: number
	lanes?: LaneMemory | undefined
}

// What the board keeps of the jump between frames.
type JumpState = Pick<BoardState, 'jump' | 'arrive_ms' | 'lane_memory'>

function is_jump_board(ports: JumpFrame['ports']): boolean {
	if (ports.theme === undefined || !JUMP_THEMES.has(ports.theme)) return false

	return ports.is_tty && run_board_lamps.is_colored()
}

// Where the merge notice's trace starts on this frame, none where no merge notice starts typing.
function first_letter(frame: JumpFrame): NoticePlace | undefined {
	const { notice, turn } = frame

	if (notice?.cause.cue !== 'lane-end' || turn?.trace.start_ms !== frame.now_ms) return undefined

	return turn.place
}

// The run a frame starts: on the first letter of a merge notice's trace, as long as the notice is.
function started(frame: JumpFrame): JumpRun | undefined {
	if (!is_jump_board(frame.ports)) return undefined
	const place = first_letter(frame)

	if (place === undefined) return undefined
	const letters = run_board_notice_trace.length_of(place.text)

	const issue = frame.notice?.cause.issue

	return { start_ms: frame.now_ms, letters, issue, lane: left_lane(frame.lanes, issue) }
}

// The merging lane's row, 0-based: the first under the header naming its issue; none with no issue.
function lane_of(lines: ReadonlyArray<string>, issue: number | undefined): number | undefined {
	if (issue === undefined) return undefined
	const tag = issue_cite.plain_for('program', issue)
	const index = lines.findIndex((line, row) => row >= HEADER_ROWS && line.includes(tag))

	return index === -1 ? undefined : index
}

// joshuafolkken/kit#8711: the merged lane's row the jump draws back, as the theme draws it; none where
// the run names no row its lane left.
function gone_of(run: JumpRun, frame: JumpFrame): GoneRow | undefined {
	if (run.lane === undefined) return undefined
	const { ports, drawn } = frame
	const line = run_board_theme.restyle(ports.theme, run.lane.text, ports.icons)
	const lines = [line]
	const screen = run_board_drop_screen.screen_of({ lines, spots: [] }, NO_TYPING, drawn.size)

	return { row: run.lane.row, cells: screen.rows[0] ?? [] }
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
		lane: lane_of(texts, run.issue) ?? run.lane?.row,
		panel: area === undefined ? undefined : { top: area.top - 1, rows: area.rows },
		trails,
	}

	return { run, screen, scene, place: frame.turn?.place, panel: area, gone: gone_of(run, frame) }
}

// The last run carried on while it runs — joshuafolkken/kit#8675: once thawed, with only its trails
// burning out, it yields to a merge notice that starts a jump.
function carried(last: JumpDraw | undefined, frame: JumpFrame): JumpRun | undefined {
	if (last === undefined || !run_board_jump.is_running(last.run, frame.now_ms)) return undefined

	if (run_board_jump.is_thawed(last.run, frame.now_ms) && started(frame) !== undefined) {
		return undefined
	}

	return last.run
}

// The jump a frame draws: the last one carried on, else one the frame starts.
function jump_of(last: JumpDraw | undefined, frame: JumpFrame): JumpDraw | undefined {
	const run = carried(last, frame) ?? started(frame)

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

// What a frame leaves of the jump: the lane rows it dropped remembered, the jump it draws over them and
// the arrival.
function jump_state(last: JumpState, frame: JumpFrame): JumpState {
	const lane_memory = run_board_lane_swap.remembered(last.lane_memory, frame.drawn.keyed ?? [])
	const jump = jump_of(last.jump, { ...frame, lanes: lane_memory })

	return { jump, arrive_ms: arrive_of(last.arrive_ms, frame), lane_memory }
}

const run_board_jump_start = { arrive_of, jump_of, jump_state }

export { run_board_jump_start }
export type { JumpFrame, JumpState }
