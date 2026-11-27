import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_mesh } from './run-board-theme-rk800-mesh'
import { run_board_theme_rk800_parts, type Stage } from './run-board-theme-rk800-parts'
import { run_board_theme_rk800_replay, type ClueInks } from './run-board-theme-rk800-replay'
import { run_board_theme_rk800_scrub, type Scrub } from './run-board-theme-rk800-scrub'

// The rk800 theme's ROW: the reconstruction view. THROUGHPUT and USAGE left of the panel go dark;
// a fact is stamped in two weights beside a blue chip, wiped in from the left, over the scrub's
// moving parts (`run-board-theme-rk800-scrub.ts`) and under the replayed figure and its clue cards
// (`run-board-theme-rk800-replay.ts`). The panel keeps its plate and ring; a blue chip marks the
// new lane.

const { cell_at, put, repeated } = run_board_theme_host_grid
const { active, finished } = run_board_theme_host_state
const { PAIR, clear_pane, put_in } = run_board_theme_draw
const { PANEL, RGB, STAMP } = run_board_theme_rk800_data
const { boxes, ghosts, inset, mesh, scan_image } = run_board_theme_rk800_mesh
const { bold, ink, on, plate, ring, stage_of } = run_board_theme_rk800_parts
const { BRIGHT, FLASH, clues, dim_pane, tally } = run_board_theme_rk800_replay
// The controller hint's line between its two boxes.
const HINT = { line_x: 5, line_w: 4 }
const { hints, lane_art, scan_line, scrub_of, sink, timeline } = run_board_theme_rk800_scrub

function is_stamping(state: ThemeState): boolean {
	return active(state.row, STAMP.tail)
}

// The fact as far as it has wiped in: `shown` letters across its lines, in its own styles or the
// white of the moment it settles.
function fact(pane: Pane, shown: number, inks: ClueInks): void {
	const rule = Math.min(STAMP.rule_w, shown - STAMP.rule_after)
	const [x, thin_x] = [STAMP.text_x, STAMP.thin_x]

	put_in(pane, { x, y: 1 }, STAMP.lead.slice(0, shown), inks.line)
	put_in(pane, { x: STAMP.chip_x, y: PAIR }, '▌', inks.chip)
	put_in(
		pane,
		{ x, y: PAIR },
		STAMP.bold.slice(0, Math.max(0, shown - STAMP.bold_after)),
		inks.title,
	)
	put_in(
		pane,
		{ x: thin_x, y: PAIR },
		STAMP.thin.slice(0, Math.max(0, shown - STAMP.thin_after)),
		inks.line,
	)

	// A pane a row short gives the rule's row to the lane's line-art.
	if (pane.box.h >= PANEL.rows) {
		put_in(pane, { x, y: PAIR + 1 }, repeated('─', rule), ink(RGB.plate))
	}
}

// The controller hint under the plate, where the panel has the row: the two shoulder boxes joined
// by a thin line, L2 lit while the head rewinds, R2 while it plays.
function controller(stage: Stage, scrub: Scrub): void {
	const { pane, body } = stage
	const [left, right] = scrub.is_rewinding ? [RGB.blue, RGB.plate] : [RGB.plate, RGB.blue]

	if (body !== PANEL.body) return
	put_in(pane, { x: 1, y: 1 }, ' L2 ', on(RGB.white, left))
	put_in(pane, { x: HINT.line_x, y: 1 }, repeated('─', HINT.line_w), ink(RGB.plate))
	put_in(pane, { x: HINT.line_x + HINT.line_w, y: 1 }, ' R2 ', on(RGB.white, right))
}

// The scan image built up over the panel's body, row by row as the head plays.
function build_up(draw: ThemeDraw, stage: Stage, scrub: Scrub): void {
	const { pane, right, bottom, body } = stage
	const frame = { x: 1, y: body, w: Math.max(0, right - PAIR), h: bottom - body }
	const share = scrub.is_done ? 1 : scrub.head / Math.max(1, scrub.width - 1)

	scan_image(pane, frame, { cols: frame.w, rows: Math.ceil(share * frame.h) }, draw.tick)
}

// The panel through a reconstruction: its plate, its ring — yellow and quick while the lane types —
// the controller hint, the scan image building up, and how the reconstruction stands.
function panel(draw: ThemeDraw, scrub: Scrub): void {
	const stage = stage_of(draw)
	const { pane, right, bottom } = stage
	const is_open = !scrub.is_done
	const [status, color] = is_open ? [STAMP.open, RGB.soft] : [STAMP.closed, RGB.cyan]

	clear_pane(pane)
	plate(pane, { x: 1, y: 0 }, 'RECONSTRUCT', RGB.plate)
	ring(
		pane,
		{ x: right - 1, y: 0 },
		draw.tick * (is_open ? PAIR : 1),
		is_open ? RGB.yellow : RGB.blue,
	)
	controller(stage, scrub)
	build_up(draw, stage, scrub)
	put_in(pane, { x: 1, y: bottom }, status, ink(color))
}

// The lane itself carries the fact's blue chip, blinking while it types; never over a mark.
function lane_chip(draw: ThemeDraw): void {
	const { api, grid, s, tick } = draw
	const at = { y: s.row.span.y, x: Math.max(0, s.row.span.x - STAMP.chip_back) }
	const is_free = api.layout.lane_rows.includes(at.y) && cell_at(grid, at.y, at.x)[0] === ' '
	const is_lit = !s.row.is_typing || tick % STAMP.blink < STAMP.blink_lit

	if (is_free && is_lit) put(grid, at, '▌', bold(RGB.blue))
}

function count_of(row: Channel): string {
	return `${String(finished(row))}/${String(row.index + 1)}`
}

// What the scrub moves: the lane's line-art, the hints and the timeline; dimmed once the lane has
// settled — settled is bright, moving is dim.
function moving(draw: ThemeDraw, scrub: Scrub, count: string): void {
	const { cooled } = draw.s.row

	clear_pane(scrub.pane)
	lane_art(draw, scrub)
	hints(draw, scrub)
	timeline(scrub, count)
	ghosts(draw, scrub)
	mesh(scrub)
	if (scrub.is_done && cooled >= STAMP.flash) dim_pane(scrub.pane)
}

// The area as the reconstruction view: the scrub's parts over the scan mesh, then what settles —
// the fact, the clue cards and the lane's wireframe fields, white the moment the lane has typed —
// and the scan inset.
function area(draw: ThemeDraw, scrub: Scrub, count: string): void {
	const { cooled, start } = draw.s.row
	const inks = scrub.is_done && cooled < STAMP.flash ? FLASH : BRIGHT

	moving(draw, scrub, count)
	fact(scrub.pane, Math.max(0, draw.tick - start) * STAMP.pace, inks)
	clues(draw, scrub, inks)
	boxes(draw, scrub, inks)
	inset(draw, scrub)
	tally(draw, scrub)
}

// ROW: the board sinks, the data gives way to the reconstruction view, and the head's line crosses
// the board.
function stamp(draw: ThemeDraw): void {
	const count = count_of(draw.s.row)
	const scrub = scrub_of(draw, count)

	sink(draw)
	area(draw, scrub, count)
	panel(draw, scrub)
	scan_line(draw, scrub)
	lane_chip(draw)
}

const run_board_theme_rk800_stamp = { is_stamping, stamp }

export { run_board_theme_rk800_stamp }
