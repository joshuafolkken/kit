import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_drop_screen, type FrameSpots } from './run-board-drop-screen'
import type { TerminalSize } from './run-board-fit'
import type { Notice } from './run-board-header-notice'
import { run_board_jump, type JumpRun } from './run-board-jump'
import type { JumpScene } from './run-board-jump-paint'
import type { JumpDraw } from './run-board-jump-screen'
import { run_board_lamps } from './run-board-lamps'
import { run_board_notice_trace } from './run-board-notice-trace'
import type { NoticePlace, NoticeTurn } from './run-board-notice-turn'
import type { PanelArea } from './run-board-panel-draw'
import type { BoardPorts } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import type { Theme } from './run-board-theme-defs'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8677: when a frame starts or carries on the bttf time jump. A jump starts on the
// first letter of a lane's merge notice (`lane-end`) typing on a terminal drawing color, runs as many
// ticks as the notice has letters, and is never restarted by the next merge notice while it runs.
// Each frame redraws it over its own cells.

const JUMP_THEMES: ReadonlySet<Theme> = new Set(['bttf'])
// The header's rows, which the merging lane's row is never among.
const HEADER_ROWS = 3

// What a frame gives the jump: its ports, the notice it shows and its trace, its cells, the rows
// typing, the animation area where it is out, and its moment.
interface JumpFrame {
	ports: Pick<BoardPorts, 'theme' | 'is_tty' | 'icons'>
	notice: Notice | undefined
	turn: NoticeTurn | undefined
	drawn: FrameSpots & { size: TerminalSize | undefined }
	typing: Typing
	area: PanelArea | undefined
	now_ms: number
}

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

	return { start_ms: frame.now_ms, letters, issue: frame.notice?.cause.issue }
}

// The merging lane's row, 0-based: the first under the header naming its issue; none with no issue.
function lane_of(lines: ReadonlyArray<string>, issue: number | undefined): number | undefined {
	if (issue === undefined) return undefined
	const tag = issue_cite.plain_for('program', issue)
	const index = lines.findIndex((line, row) => row >= HEADER_ROWS && line.includes(tag))

	return index === -1 ? undefined : index
}

// The board the run is painted on this frame, drawn as the theme draws it.
function draw_of(run: JumpRun, frame: JumpFrame): JumpDraw {
	const { ports, drawn, area } = frame
	const lines = drawn.lines.map((line) => run_board_theme.restyle(ports.theme, line, ports.icons))
	const screen = run_board_drop_screen.screen_of({ ...drawn, lines }, frame.typing, drawn.size)
	const texts = screen.rows.map((row) => row.map((cell) => cell.text).join(''))
	const scene: JumpScene = {
		rows: screen.rows.length,
		lane: lane_of(texts, run.issue),
		panel: area === undefined ? undefined : { top: area.top - 1, rows: area.rows },
	}

	return { run, screen, scene, place: frame.turn?.place, panel: area }
}

// The jump a frame draws: the last one carried on while it runs, else one the frame starts.
function jump_of(last: JumpDraw | undefined, frame: JumpFrame): JumpDraw | undefined {
	const is_carried = last !== undefined && run_board_jump.is_running(last.run, frame.now_ms)
	const run = is_carried ? last.run : started(frame)

	return run === undefined ? undefined : draw_of(run, frame)
}

const run_board_jump_start = { jump_of }

export { run_board_jump_start }
export type { JumpFrame }
