import { run_board_display, type BoardDisplay } from './run-board-display'
import type { FrameBounds } from './run-board-fold'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout } from './run-board-layout'
import { run_board_link } from './run-board-link'
import type { BoardNote } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_render } from './run-board-render'
import { run_board_row_sections } from './run-board-row-sections'
import { run_board_spin, type Spun } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// The frame one `run:board` redraw draws (`run-board-tick.ts`) from what `run-board-display.ts`
// assembled: the header over the laid-out rows, the notes under them, written with its spinners at this
// moment's frame. The pane, the fold, the theme, the links, the sound and the typing are read here off
// the board's ports.

const { SPOT } = run_board_spin
const { assemble_display } = run_board_display

// What one redraw draws with.
interface Redraw {
	ports: BoardPorts
	now_ms: number
}

// A run's header, always over its laid-out rows.
type LaidHeader = BoardHeader & { layout: BoardLayout }

type PortHeader = Pick<BoardHeader, 'form' | 'spinner' | 'is_keyed' | 'is_themed' | 'is_sound_on'>

// What the header reads off the board's own ports: only a live board reads the sound switch.
function port_header(ports: BoardPorts): PortHeader {
	return {
		form: ports.form,
		spinner: ports.is_tty ? SPOT : undefined,
		is_keyed: ports.types_rows,
		is_themed: ports.is_themed,
		is_sound_on: ports.sound?.(),
	}
}

// The assembled header with what the ports add: the terminal's form, the sound switch and the links.
function header_of(display: BoardDisplay, ports: BoardPorts): LaidHeader {
	return {
		...display.header,
		...port_header(ports),
		...run_board_link.links_of(display.header.repo, ports.link),
	}
}

// The pane a live frame is kept within and the footer it ends on, read at every redraw.
function bounds_of(ports: BoardPorts): FrameBounds {
	return { size: ports.size?.(), footer: ports.footer, folded: ports.folded?.() }
}

// A drawn frame and every note it was drawn from — shown or not (joshuafolkken/kit#8117).
type Drawn = Spun & { notes: ReadonlyArray<BoardNote> }

// The frame under `header` with its spinners drawn at this moment's frame, and where they are on screen.
function frame_of(display: BoardDisplay, header: LaidHeader, redraw: Redraw): Drawn {
	const bounds = bounds_of(redraw.ports)
	const { notes } = display
	const lines = run_board_render.render({
		header,
		notes,
		resume: display.resume,
		throughput: display.throughput,
		thanks: display.thanks,
		link: redraw.ports.link,
		...bounds,
	})
	const spun = run_board_spin.spun(lines, run_board_labels.spinner_of(redraw.now_ms), bounds.size)

	return { ...spun, notes }
}

// The rows this frame types where the board types them; a frame before the plan is read is no base — the
// rows the plan brings were already there — so the frame the plan arrives on is the first base. What
// counts as known is `run_board_row_sections.known_of`'s, over the notes the frame was drawn from.
function typing_of(
	state: BoardState,
	drawn: Pick<Drawn, 'keyed' | 'notes'>,
	header: LaidHeader,
	redraw: Redraw,
): Typing {
	const is_on = redraw.ports.types_rows === true && state.plan !== undefined
	const frame = { keyed: drawn.keyed, known: run_board_row_sections.known_of(header, drawn.notes) }

	return run_board_type_rows.next(state.typing, frame, redraw.now_ms, is_on)
}

function draw(ports: BoardPorts, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The assembled frame drawn, its cue sounded through `cue` where the board passes one — before the
// frame is written, so the notice shows on the frame it sounds on.
function draw_display(state: BoardState, display: BoardDisplay, redraw: Redraw): BoardState {
	const header = header_of(display, redraw.ports)

	if (display.cue !== undefined) redraw.ports.cue?.(display.cue)
	const drawn = frame_of(display, header, redraw)
	const typing = typing_of(state, drawn, header, redraw)

	draw(redraw.ports, run_board_type_rows.typed_lines(drawn.lines, typing, redraw.now_ms))

	return { ...state, ...display.carried, spots: drawn.spots, typing }
}

// The run's frame over `run_layout`, the run's own rows, the root checkout's single runs laid over them.
function draw_run(
	state: BoardState,
	local: LocalRead,
	redraw: Redraw,
	run_layout: BoardLayout,
): BoardState {
	return draw_display(state, assemble_display(state, local, redraw.now_ms, run_layout), redraw)
}

const run_board_tick_draw = { bounds_of, draw, draw_display, draw_run }

export { run_board_tick_draw }
