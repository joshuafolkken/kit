import { run_board_demo_footer } from './run-board-demo-footer'
import { run_board_demo_lanes } from './run-board-demo-lanes'
import type { BoardDisplay } from './run-board-display'
import type { SectionKey, TerminalSize } from './run-board-fit'
import type { FrameBounds } from './run-board-fold'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_header_defcon } from './run-board-header-defcon'
import { run_board_labels } from './run-board-labels'
import { run_board_lamps } from './run-board-lamps'
import type { BoardLayout } from './run-board-layout'
import { run_board_link } from './run-board-link'
import type { BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_row_sections } from './run-board-row-sections'
import { run_board_spin, type Spot, type Spun } from './run-board-spin'
import { run_board_standing } from './run-board-standing'
import type { BoardPorts, BoardState } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// The frame one `run:board` redraw draws (`run-board-tick.ts`) from what `run-board-display.ts`
// assembled: the header over the laid-out rows, the notes under them, written with its spinners at this
// moment's frame. The pane, the fold, the theme, the links, the sound and the typing are read here off
// the board's ports.

const { SPOT } = run_board_spin

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
	| 'theme_run'
	| 'plain_ports'
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
		is_keyed: ports.types_rows === true,
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

// Whether the board is in demo mode, whose lanes section draws its sample lanes where the run has none
// (`run-board-demo-lanes.ts`, joshuafolkken/kit#8917).
function is_demo(ports: Pick<DrawPorts, 'theme_run'>): boolean {
	return ports.theme_run?.demo !== undefined
}

// The sections drawn folded: a person's folds, but in demo mode the lanes drawn open, so its ROW types
// on a lane row in sight (joshuafolkken/kit#8917); the folds kept are the person's, back on leaving it.
function folded_of(ports: DrawPorts): ReadonlySet<SectionKey> | undefined {
	const folded = ports.folded?.()

	if (folded === undefined || !is_demo(ports)) return folded

	return new Set([...folded].filter((key) => key !== 'lanes'))
}

// The pane a live frame is kept within and the footer it ends on, read at every redraw; in demo mode it
// ends on demo mode's own, pinned (`run-board-demo-footer.ts`).
function bounds_of(ports: DrawPorts): FrameBounds {
	const size = ports.size?.()
	const bounds = { size, footer: ports.footer, folded: folded_of(ports) }
	const pinned_footer = run_board_demo_footer.rows_of(ports.theme_run, size?.columns)

	return pinned_footer === undefined ? bounds : { ...bounds, pinned_footer }
}

// A drawn frame, every note it was drawn from — shown or not (joshuafolkken/kit#8117) — and the pane it
// was kept within.
type Drawn = Spun & {
	notes: ReadonlyArray<BoardNote>
	size: TerminalSize | undefined
	colons: ReadonlyArray<Spot>
}

// The lamp panel a themed live board's theme lays its panel and area out by (joshuafolkken/kit#8236,
// joshuafolkken/kit#8917): a live board — its rows typing, or the board live though they do not
// (joshuafolkken/kit#8674) — in a theme, on a terminal drawing color. Where it shows it runs over the
// usage rule's row too (joshuafolkken/kit#8702).
function has_lamps(ports: Pick<DrawPorts, 'types_rows' | 'is_live' | 'theme' | 'is_tty'>): boolean {
	const is_live = ports.types_rows === true || ports.is_live === true

	return is_live && ports.theme !== undefined && ports.is_tty && run_board_lamps.is_colored()
}

// The frame under `header` with its spinners drawn at this moment's frame, and where they are on screen;
// its findings carry why the reads under it fail (`run-board-standing.ts`).
function frame_of(display: BoardDisplay, header: LaidHeader, redraw: Redraw): Drawn {
	const bounds = bounds_of(redraw.ports)
	const notes = [...display.notes, ...run_board_standing.notes_of(header)]
	const is_lamped = has_lamps(redraw.ports)
	const lines = run_board_render.render({
		header,
		notes,
		resume: display.resume,
		throughput: display.throughput,
		has_lamps: is_lamped,
		has_rule_lamps: is_lamped,
		thanks: display.thanks,
		pinned: display.pinned,
		link: redraw.ports.link,
		is_demo_lanes: is_demo(redraw.ports),
		...bounds,
	})
	const spinner = run_board_labels.spinner_of(redraw.now_ms)
	const spun = run_board_spin.spun(lines, spinner, { size: bounds.size })
	// joshuafolkken/kit#8476: the clocks' colons found as the theme draws them, in its colors and in the
	// icons every write draws (joshuafolkken/kit#8505), so the restyle reuses those writes' cache.
	const { theme, icons } = redraw.ports
	const themed = lines.map((line) => run_board_theme.restyle(theme, line, icons))
	const colons = run_board_spin.colons_in(themed, bounds.size)

	return { ...spun, notes, size: bounds.size, colons }
}

// The typing with demo mode's sample lanes counted as seen, so they show whole the frame demo mode is
// entered on rather than typing as new rows: they are scenery, and demo mode's own ROW types on them.
function seen_samples(typing: Typing, redraw: Redraw): Typing {
	const { seen } = typing

	if (seen === undefined || !is_demo(redraw.ports)) return typing

	return { ...typing, seen: run_board_demo_lanes.with_samples(seen) }
}

// The rows this frame types where the board types them — a themed board, whose theme layer types them
// (joshuafolkken/kit#8917); a frame before the plan is read is no base — the rows the plan brings were
// already there — so the frame the plan arrives on is the first base. What counts as known is
// `run_board_row_sections.known_of`'s, over the notes the frame was drawn from; the lines a saved plan's
// frame draws faint type over it on the frame the live plan lands on (joshuafolkken/kit#8457).
function typing_of(
	state: BoardState,
	drawn: Pick<Drawn, 'keyed' | 'notes'>,
	header: LaidHeader,
	redraw: Redraw,
): Typing {
	const is_on = redraw.ports.types_rows === true && state.plan !== undefined
	const known = run_board_row_sections.known_of(header, drawn.notes)
	const frame = {
		keyed: drawn.keyed,
		known: is_demo(redraw.ports) ? run_board_demo_lanes.with_samples(known) : known,
		faint: run_board_row_sections.faint_keys_of(header),
	}

	return run_board_type_rows.next(seen_samples(state.typing, redraw), frame, redraw.now_ms, is_on)
}

function draw(ports: Pick<DrawPorts, 'write'>, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The places the frame drew that the spin turns between redraws, and its keyed rows the theme layer lays
// out by (joshuafolkken/kit#8917).
function turned_of(drawn: Drawn): Pick<Drawn, 'spots' | 'lamps' | 'colons' | 'keyed'> {
	const { spots, lamps, colons, keyed } = drawn

	return { spots, lamps, colons, keyed }
}

// A frame laid out, the redraw it was drawn through and its header.
interface Laid {
	redraw: Redraw
	header: LaidHeader
	drawn: Drawn
}

function laid_in(display: BoardDisplay, state: BoardState, redraw: Redraw): Laid {
	const header = header_of(display, state, redraw)

	return { redraw, header, drawn: frame_of(display, header, redraw) }
}

// The frame in the redraw's look. A themed board keeps its theme with no lamp panel on screen — a narrow
// or short pane, a folded section: the theme then draws no area parts (`run-board-theme-layout.ts`,
// joshuafolkken/kit#8917). Only a board that draws no lamps at all — a terminal without the colors a
// theme needs — is drawn through the board's plain ports, in no theme.
function laid_of(display: BoardDisplay, state: BoardState, redraw: Redraw): Laid {
	const plain = redraw.ports.plain_ports

	if (plain === undefined || has_lamps(redraw.ports)) return laid_in(display, state, redraw)

	return laid_in(display, state, { ...redraw, ports: plain })
}

// The assembled frame drawn, its cue sounded through `cue` where the board passes one — before the
// frame is written, so the notice shows on the frame it sounds on. Every row is written whole: a themed
// board's theme layer types the rows typing (joshuafolkken/kit#8917), and the level it shows where its
// theme shows its own is the header's.
function draw_display(state: BoardState, display: BoardDisplay, given: Redraw): BoardState {
	if (display.cue !== undefined) given.ports.cue?.(display.cue)
	const { redraw, header, drawn } = laid_of(display, state, given)
	const typing = typing_of(state, drawn, header, redraw)

	draw(redraw.ports, drawn.lines)
	const alert_level = run_board_header_defcon.level_of(header)
	const dated_clocks = run_board_header.dated_clocks(header)

	return { ...state, ...display.carried, ...turned_of(drawn), typing, alert_level, dated_clocks }
}

const run_board_tick_draw = {
	bounds_of,
	draw,
	draw_display,
	has_lamps,
}

export { run_board_tick_draw }
export type { DrawPorts, Redraw }
