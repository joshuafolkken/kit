import { run_board_change_flash, type Flash } from './run-board-change-flash'
import type { BoardDisplay } from './run-board-display'
import { run_board_drop_screen, type DropScreen } from './run-board-drop-screen'
import type { TerminalSize } from './run-board-fit'
import type { FrameBounds } from './run-board-fold'
import type { BoardHeader } from './run-board-header'
import type { RainMoment } from './run-board-idle-rain'
import { run_board_jump_start, type JumpState } from './run-board-jump-start'
import { run_board_labels } from './run-board-labels'
import { run_board_lamps } from './run-board-lamps'
import type { BoardLayout } from './run-board-layout'
import { run_board_link } from './run-board-link'
import type { BoardNote } from './run-board-notes'
import { run_board_notice_turn, type NoticeTurn } from './run-board-notice-turn'
import type { PanelDraw } from './run-board-panel-draw'
import { run_board_rain_drop } from './run-board-rain-drop'
import { run_board_render } from './run-board-render'
import { run_board_row_sections } from './run-board-row-sections'
import { run_board_spin, type Spot, type Spun } from './run-board-spin'
import { run_board_standing } from './run-board-standing'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs, type LiveDefs, type ThemeDefinition } from './run-board-theme-defs'
import { run_board_tick_flash } from './run-board-tick-flash'
import { run_board_type_rows, type Typing, type TypingSpan } from './run-board-type-rows'

// The frame one `run:board` redraw draws (`run-board-tick.ts`) from what `run-board-display.ts`
// assembled: the header over the laid-out rows, the notes under them, written with its spinners at this
// moment's frame. The pane, the fold, the theme, the links, the sound and the typing are read here off
// the board's ports.

const { SPOT } = run_board_spin
const { THEME_DEFS, live_of, panel_of: panel_painter_of, is_rule_lamped } = run_board_theme_defs

// The ports a frame is drawn through — no read among them, so the worker thread draws the frames it
// records through the same ones (`run-board-gather-record.ts`).
type DrawPorts = Pick<
	BoardPorts,
	| 'write'
	| 'write_drawn'
	| 'link'
	| 'is_tty'
	| 'form'
	| 'types_rows'
	| 'is_live'
	| 'theme'
	| 'icons'
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
		is_keyed: ports.types_rows === true || live_of(ports.theme).flash === true,
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

// A drawn frame, every note it was drawn from — shown or not (joshuafolkken/kit#8117) — and the pane it
// was kept within.
type Drawn = Spun & {
	notes: ReadonlyArray<BoardNote>
	size: TerminalSize | undefined
	colons: ReadonlyArray<Spot>
}

// The theme rows whose lamp choice the panel reads.
type LampDefs = Readonly<Partial<Record<string, Pick<ThemeDefinition, 'lamps'>>>>

type LampPorts = Pick<DrawPorts, 'types_rows' | 'is_live' | 'theme'>

// Whether a live board — its rows typing, or the board live though they do not (joshuafolkken/kit#8674)
// — is drawn in a theme whose definition draws lamps (joshuafolkken/kit#8359).
function is_lamp_theme(ports: LampPorts, defs: LampDefs): boolean {
	const is_live = ports.types_rows === true || ports.is_live === true

	return is_live && ports.theme !== undefined && defs[ports.theme]?.lamps === true
}

type LivePorts = Pick<DrawPorts, 'types_rows' | 'is_live' | 'theme' | 'is_tty'>

// Whether the board draws on a terminal drawing color.
function is_colored_tty(ports: Pick<DrawPorts, 'is_tty'>): boolean {
	return ports.is_tty && run_board_lamps.is_colored()
}

// The lamp panel shows where the rows type — a live board in a theme that draws lamps — on a terminal
// drawing color (joshuafolkken/kit#8236).
function has_lamps(ports: LivePorts, defs: LampDefs = THEME_DEFS): boolean {
	return is_lamp_theme(ports, defs) && is_colored_tty(ports)
}

// Whether the lamp panel's cells run the idle rain: where the panel shows, in a theme whose live board
// rains there (joshuafolkken/kit#8356).
function has_rain(ports: LivePorts): boolean {
	return has_lamps(ports) && live_of(ports.theme).rain
}

// Whether the lamp panel runs over the usage rule's row: where the panel shows, in a theme whose
// definition lamps the rule (joshuafolkken/kit#8702).
function has_rule_lamps(ports: LivePorts): boolean {
	return has_lamps(ports) && is_rule_lamped(ports.theme)
}

// The idle rain's moment a rain frame's lamps are drawn at — none where the panel does not rain, so its
// lamps are drawn as `■` (joshuafolkken/kit#8647).
function rain_of(redraw: Pick<Redraw, 'ports' | 'now_ms'>): RainMoment | undefined {
	return has_rain(redraw.ports) ? { ms: redraw.now_ms, is_burst: false } : undefined
}

// The theme's painter of the animation area and the frame's area, where the lamp panel shows
// (joshuafolkken/kit#8676).
function panel_of(ports: LivePorts, drawn: Pick<Drawn, 'area'>): PanelDraw | undefined {
	const painter = has_lamps(ports) ? panel_painter_of(ports.theme) : undefined

	if (painter === undefined || drawn.area === undefined) return undefined

	return { painter, area: drawn.area }
}

// How a new row enters: typed where the rows type; in a theme whose live board decodes them, decoded on
// a terminal drawing color and shown at once on one drawing none (joshuafolkken/kit#8356).
type RowEntry = 'type' | 'decode' | 'none'

function entry_of(ports: LivePorts, defs: LiveDefs = THEME_DEFS): RowEntry {
	if (ports.types_rows !== true) return 'none'
	if (!live_of(ports.theme, defs).decode) return 'type'

	return is_colored_tty(ports) ? 'decode' : 'none'
}

// Whether the section rules run code while a row types: a theme whose live board decodes them, where its
// lamp panel shows — the spin gates them on the lamps it blinks (joshuafolkken/kit#8375).
function has_codes(ports: Pick<DrawPorts, 'theme'>, defs: LiveDefs = THEME_DEFS): boolean {
	return live_of(ports.theme, defs).codes
}

// Whether a lamp strip fills above each rule: where the rules run code, in a theme whose definition
// switches the strip on (joshuafolkken/kit#8376) — off by default (joshuafolkken/kit#8398).
function has_strip(ports: Pick<DrawPorts, 'theme'>, defs: LiveDefs = THEME_DEFS): boolean {
	const live = live_of(ports.theme, defs)

	return live.codes && live.strip
}

// The rules running code and the strips filling above them that the spin draws, each kept only where its
// switch is on — off, the board holds no cell for it and the spin writes none.
function decoded_of(
	ports: Pick<DrawPorts, 'theme'>,
	drawn: Pick<Drawn, 'rules' | 'strips'>,
	defs: LiveDefs = THEME_DEFS,
): Pick<Drawn, 'rules' | 'strips'> {
	return {
		rules: has_codes(ports, defs) ? drawn.rules : [],
		strips: has_strip(ports, defs) ? drawn.strips : [],
	}
}

// The frame under `header` with its spinners drawn at this moment's frame, and where they are on screen;
// its findings carry why the reads under it fail (`run-board-standing.ts`).
function frame_of(display: BoardDisplay, header: LaidHeader, redraw: Redraw): Drawn {
	const bounds = bounds_of(redraw.ports)
	const notes = [...display.notes, ...run_board_standing.notes_of(header)]
	const lines = run_board_render.render({
		header,
		notes,
		resume: display.resume,
		throughput: display.throughput,
		has_lamps: has_lamps(redraw.ports),
		has_rule_lamps: has_rule_lamps(redraw.ports),
		thanks: display.thanks,
		pinned: display.pinned,
		link: redraw.ports.link,
		...bounds,
	})
	const spinner = run_board_labels.spinner_of(redraw.now_ms)
	const spun = run_board_spin.spun(lines, spinner, { size: bounds.size, rain: rain_of(redraw) })
	// joshuafolkken/kit#8476: the clocks' colons found as the theme draws them, in its colors and in the
	// icons every write draws (joshuafolkken/kit#8505), so the restyle reuses those writes' cache.
	const { theme, icons } = redraw.ports
	const themed = lines.map((line) => run_board_theme.restyle(theme, line, icons))
	const colons = run_board_spin.colons_in(themed, bounds.size)

	return { ...spun, notes, size: bounds.size, colons }
}

// Whether a drop falls down the board between redraws: a live board on a terminal drawing color, in a
// theme whose live board drops one (joshuafolkken/kit#8367) — the lamps' gate, by the theme's own switch.
function has_drop(ports: LivePorts, defs: LiveDefs = THEME_DEFS): boolean {
	if (ports.types_rows !== true || !live_of(ports.theme, defs).drop) return false

	return is_colored_tty(ports)
}

// The last frame's drop and this frame's flash, which together hold the deja vus a drop rains for.
interface DropFlash {
	drop: DropScreen | undefined
	flash: Flash | undefined
}

// The rain of every deja vu that can still be on screen: the last drop's, carried whole so a merged span
// keeps its end, and one from each of the flash's replays' first frame.
function deja_spans_of(last: DropFlash): Array<TypingSpan> {
	const replays = (last.flash?.deja_vu ?? []).map((entry) => entry.start_ms)

	return [
		...(last.drop?.deja_spans ?? []),
		...replays.map((start) => run_board_rain_drop.deja_span(start)),
	]
}

// The frame's cells the drop falls down, where one falls — as the theme draws them, since the drop is
// written past the theme and puts each cell it leaves back as it was on screen — with the spans the rain
// pours over: the last frame's carried on, this frame's rows typing added (joshuafolkken/kit#8369) — and
// the deja vu rains, the last frame's and this frame's replays' (joshuafolkken/kit#8629).
function drop_of(
	redraw: Redraw,
	drawn: Drawn,
	typing: Typing,
	last: DropFlash,
): DropScreen | undefined {
	const { ports } = redraw

	if (!has_drop(ports)) return undefined
	const lines = drawn.lines.map((line) => run_board_theme.restyle(ports.theme, line, ports.icons))
	const screen = run_board_drop_screen.screen_of({ ...drawn, lines }, typing, drawn.size)
	const spans = [...(last.drop?.pours ?? []), ...run_board_type_rows.spans_of(typing)]

	return run_board_rain_drop.poured(screen, spans, redraw.now_ms, deja_spans_of(last))
}

// The rows this frame types where the board types them; a frame before the plan is read is no base — the
// rows the plan brings were already there — so the frame the plan arrives on is the first base. What
// counts as known is `run_board_row_sections.known_of`'s, over the notes the frame was drawn from; the
// lines a saved plan's frame draws faint type over it on the frame the live plan lands on
// (joshuafolkken/kit#8457).
function typing_of(
	state: BoardState,
	drawn: Pick<Drawn, 'keyed' | 'notes'>,
	header: LaidHeader,
	redraw: Redraw,
): Typing {
	const entry = entry_of(redraw.ports)
	const is_on = entry !== 'none' && state.plan !== undefined
	const frame = {
		keyed: drawn.keyed,
		known: run_board_row_sections.known_of(header, drawn.notes),
		faint: run_board_row_sections.faint_keys_of(header),
		is_decoding: entry === 'decode',
	}

	return run_board_type_rows.next(state.typing, frame, redraw.now_ms, is_on)
}

function draw(ports: Pick<DrawPorts, 'write'>, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The places the frame drew that the spin turns between redraws.
function turned_of(drawn: Drawn): Pick<Drawn, 'spots' | 'sweep' | 'lamps' | 'traces' | 'colons'> {
	const { spots, sweep, lamps, traces, colons } = drawn

	return { spots, sweep, lamps, traces, colons }
}

// joshuafolkken/kit#8657: the header notice's trace this frame carries on, where the board traces it —
// the flash's gate, by the theme's own switch; the frame the change flash measures against starts none
// (the matrix types no rows, so the typing keeps no base of its own).
function notice_of(
	state: BoardState,
	drawn: Drawn,
	header: LaidHeader,
	redraw: Redraw,
): NoticeTurn | undefined {
	const { ports } = redraw

	if (!run_board_tick_flash.is_enabled(ports, 'notice_trace')) return undefined

	return run_board_notice_turn.turn_of(state.notice_trace, {
		keyed: drawn.keyed,
		header,
		is_base: state.flash === undefined,
		now_ms: redraw.now_ms,
		look: { theme: ports.theme, icons: ports.icons },
		columns: drawn.size?.columns ?? Infinity,
	})
}

// The frame written with the change flash over it (joshuafolkken/kit#8353), and the trill switched on
// while a row types.
function write_frame(redraw: Redraw, drawn: Drawn, typing: Typing, flash: Flash | undefined): void {
	const { ports, now_ms } = redraw

	draw(ports, run_board_type_rows.typed_lines(drawn.lines, typing, now_ms))
	run_board_change_flash.write(ports, flash, now_ms)
	ports.typing_sound?.set(
		run_board_type_rows.is_typing(typing, now_ms),
		run_board_type_rows.left_ms(typing, now_ms),
	)
}

// What a drawn frame hands the spin to turn between redraws.
interface FrameEffects {
	drawn: Drawn
	header: LaidHeader
	typing: Typing
	notice_trace: NoticeTurn | undefined
}

// The rules, strips, panel, notice trace and bttf time jump (joshuafolkken/kit#8677) the spin turns.
function effects_of(
	state: BoardState,
	frame: FrameEffects,
	redraw: Redraw,
): Pick<BoardState, 'rules' | 'strips' | 'panel' | 'notice_trace'> & JumpState {
	const { drawn, notice_trace } = frame
	const panel = panel_of(redraw.ports, drawn)
	const jump_frame = { ...frame, ports: redraw.ports, area: panel?.area, now_ms: redraw.now_ms }
	const jumped = run_board_jump_start.jump_state(state, jump_frame)

	return { ...decoded_of(redraw.ports, drawn), panel, notice_trace, ...jumped }
}

// The assembled frame drawn, its cue sounded through `cue` where the board passes one — before the
// frame is written, so the notice shows on the frame it sounds on — and the trill switched on while a
// row types, apart from the cue, so both sound on one frame (joshuafolkken/kit#8250).
function draw_display(state: BoardState, display: BoardDisplay, redraw: Redraw): BoardState {
	const header = header_of(display, state, redraw)

	if (display.cue !== undefined) redraw.ports.cue?.(display.cue)
	const drawn = frame_of(display, header, redraw)
	const typing = typing_of(state, drawn, header, redraw)
	const notice_trace = notice_of(state, drawn, header, redraw)
	const flash = run_board_tick_flash.flash_of(
		state.flash,
		{ ...drawn, notice: notice_trace?.place },
		redraw,
		typing,
	)

	write_frame(redraw, drawn, typing, flash)

	const decoded = effects_of(state, { drawn, header, typing, notice_trace }, redraw)
	const drop = drop_of(redraw, drawn, typing, { drop: state.drop, flash })

	return { ...state, ...display.carried, ...turned_of(drawn), ...decoded, typing, drop, flash }
}

const run_board_tick_draw = {
	bounds_of,
	decoded_of,
	draw,
	draw_display,
	entry_of,
	has_drop,
	has_lamps,
	has_rain,
	has_rule_lamps,
	has_strip,
	panel_of,
}

export { run_board_tick_draw }
export type { DrawPorts, Redraw }
