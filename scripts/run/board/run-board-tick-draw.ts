import type { BoardDisplay } from './run-board-display'
import type { FrameBounds } from './run-board-fold'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_lamps } from './run-board-lamps'
import type { BoardLayout } from './run-board-layout'
import { run_board_link } from './run-board-link'
import type { BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_row_sections } from './run-board-row-sections'
import { run_board_spin, type Spun } from './run-board-spin'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme_defs, type ThemeDefinition } from './run-board-theme-defs'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// The frame one `run:board` redraw draws (`run-board-tick.ts`) from what `run-board-display.ts`
// assembled: the header over the laid-out rows, the notes under them, written with its spinners at this
// moment's frame. The pane, the fold, the theme, the links, the sound and the typing are read here off
// the board's ports.

const { SPOT } = run_board_spin
const { THEME_DEFS } = run_board_theme_defs

// The ports a frame is drawn through — no read among them, so the worker thread draws the frames it
// records through the same ones (`run-board-gather-record.ts`).
type DrawPorts = Pick<
	BoardPorts,
	| 'write'
	| 'link'
	| 'is_tty'
	| 'form'
	| 'types_rows'
	| 'theme'
	| 'size'
	| 'footer'
	| 'folded'
	| 'opened_ms'
	| 'cue'
	| 'sound'
	| 'typing_sound'
>

// What one redraw draws with.
interface Redraw {
	ports: DrawPorts
	now_ms: number
}

// A run's header, always over its laid-out rows.
type LaidHeader = BoardHeader & { layout: BoardLayout }

type PortHeader = Pick<BoardHeader, 'form' | 'spinner' | 'is_keyed' | 'theme' | 'is_sound_on'>

// What the header reads off the board's own ports: only a live board reads the sound switch.
function port_header(ports: DrawPorts): PortHeader {
	return {
		form: ports.form,
		spinner: ports.is_tty ? SPOT : undefined,
		is_keyed: ports.types_rows,
		theme: ports.theme,
		is_sound_on: ports.sound?.(),
	}
}

// A plan read before the board opened is the saved one it first drew (joshuafolkken/kit#8219).
function saved_of(
	fetched_ms: number | undefined,
	opened_ms: number | undefined,
): number | undefined {
	if (fetched_ms === undefined || opened_ms === undefined) return undefined

	return fetched_ms < opened_ms ? fetched_ms : undefined
}

type Sampled = Pick<BoardHeader, 'machine' | 'usages' | 'budget_waits' | 'quotas'>

// The machine's samples as the board holds them now: a live board's worker samples them every round
// but assembles a frame only when its data moves (joshuafolkken/kit#8330).
function sampled_of(state: BoardState): Sampled {
	const { gauges, usages, budget_waits, quotas } = state

	return { machine: gauges, usages, budget_waits, quotas }
}

// The assembled header with what the ports add — the terminal's form, the sound switch and the links —
// stamped with this redraw's moment, the machine's samples and the reads' failure as the board holds
// them now, so a display a live board's worker assembled earlier still moves every elapsed time
// (joshuafolkken/kit#8160).
function header_of(display: BoardDisplay, state: BoardState, redraw: Redraw): LaidHeader {
	const { ports } = redraw

	return {
		...display.header,
		...sampled_of(state),
		now_ms: redraw.now_ms,
		read_failed_ms: state.read_failed_ms,
		read_error: state.read_error,
		plan_saved_ms: saved_of(display.header.plan_fetched_ms, ports.opened_ms),
		...port_header(ports),
		...run_board_link.links_of(display.header.repo, ports.link),
	}
}

// The pane a live frame is kept within and the footer it ends on, read at every redraw.
function bounds_of(ports: DrawPorts): FrameBounds {
	return { size: ports.size?.(), footer: ports.footer, folded: ports.folded?.() }
}

// A drawn frame and every note it was drawn from — shown or not (joshuafolkken/kit#8117).
type Drawn = Spun & { notes: ReadonlyArray<BoardNote> }

// The theme rows whose lamp choice the panel reads.
type LampDefs = Readonly<Partial<Record<string, Pick<ThemeDefinition, 'lamps'>>>>

// Whether the board's rows type in a theme whose definition draws lamps (joshuafolkken/kit#8359).
function is_lamp_theme(ports: Pick<DrawPorts, 'types_rows' | 'theme'>, defs: LampDefs): boolean {
	if (ports.types_rows !== true || ports.theme === undefined) return false

	return defs[ports.theme]?.lamps === true
}

// The lamp panel shows where the rows type — a live board in a theme that draws lamps — on a terminal
// drawing color (joshuafolkken/kit#8236).
function has_lamps(
	ports: Pick<DrawPorts, 'types_rows' | 'theme' | 'is_tty'>,
	defs: LampDefs = THEME_DEFS,
): boolean {
	return is_lamp_theme(ports, defs) && ports.is_tty && run_board_lamps.is_colored()
}

// The frame under `header` with its spinners drawn at this moment's frame, and where they are on screen.
function frame_of(display: BoardDisplay, header: LaidHeader, redraw: Redraw): Drawn {
	const bounds = bounds_of(redraw.ports)
	const { notes } = display
	const lines = run_board_render.render({
		header,
		notes,
		resume: display.resume,
		throughput: display.throughput,
		has_lamps: has_lamps(redraw.ports),
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

function draw(ports: Pick<DrawPorts, 'write'>, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The assembled frame drawn, its cue sounded through `cue` where the board passes one — before the
// frame is written, so the notice shows on the frame it sounds on — and the trill switched on while a
// row types, apart from the cue, so both sound on one frame (joshuafolkken/kit#8250).
function draw_display(state: BoardState, display: BoardDisplay, redraw: Redraw): BoardState {
	const header = header_of(display, state, redraw)

	if (display.cue !== undefined) redraw.ports.cue?.(display.cue)
	const drawn = frame_of(display, header, redraw)
	const typing = typing_of(state, drawn, header, redraw)

	draw(redraw.ports, run_board_type_rows.typed_lines(drawn.lines, typing, redraw.now_ms))
	redraw.ports.typing_sound?.set(run_board_type_rows.is_typing(typing, redraw.now_ms))

	const { spots, sweep, lamps } = drawn

	return { ...state, ...display.carried, spots, sweep, lamps, typing }
}

const run_board_tick_draw = { bounds_of, draw, draw_display, has_lamps }

export { run_board_tick_draw }
export type { DrawPorts, Redraw }
