import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Box, Point } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'
import { run_board_theme_rk800_replay, type ClueInks } from './run-board-theme-rk800-replay'
import type { Scrub } from './run-board-theme-rk800-scrub'

// The rk800 theme's reconstruction of the lane itself, in the open part of a ROW's area between
// the stamp and the timeline. A dotted scan mesh, its alternate row offset by half a pitch, with a
// bright wave at the timeline head's column and the nodes it has passed a little brighter. The new
// lane's fields as wireframe boxes in the mesh: corner dots, then dashed edges as the head crosses
// a box, then solid edges and the field's text fading in. Two dim copies of the lane's row offset
// from its outline, sliding onto it at the head. And a small scan image between bracket corners —
// a branching, vein-like texture in dark red to white half blocks, computed, revealed column by
// column under a passing scan line — once the second clue card has appeared.

const { bg, cell_at, code_points, fg, repeated } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { PAIR, clamped, put_in } = run_board_theme_draw
const { PANEL, RGB, TIMELINE } = run_board_theme_rk800_data
const { bold, ink, mix } = run_board_theme_rk800_parts
const { card_columns, fields_of, is_passed } = run_board_theme_rk800_replay

// The mesh: the column it starts on (right of the stamp), its pitch, and how wide the wave is.
const MESH = { left: 22, pitch: 4, wave: 2, rows: 2, up: 5 }
// A field's box: the cells its frame adds to its text, the gap to the next, the columns its text
// takes to fade in behind the head.
const FRAME = { pad: 4, gap: 1, fade: 4, least: 2 }
// The ghosts: how far off the outline they start, and how dim they are.
const GHOST = { off: 3, dim: 0.6, art_up: 3 }
// The scan image inset: its size, how far from the area's right edge it stands, the rows a pane
// must have for it, and the ticks its scan line takes a column.
const INSET = { w: 12, back: 15, line_pace: 2 }
// The scan image's texture: a vein swaying along the image, a branch leaving it past the split.
const VEIN = {
	sway: 0.8,
	swing: 0.3,
	split: 0.45,
	slope: 0.45,
	thin: 1.1,
	grain: 0.25,
	hot: 0.7,
	line: 0.4,
	salt: 96,
}
const WAVE = bold(RGB.cyan)
const PASSED = ink(mix(RGB.steel, RGB.soft, 1 / PAIR))
const AHEAD = ink(mix(RGB.steel, RGB.night, 1 / PAIR))
const DOTS = ink(RGB.steel)

// A field's box in the mesh: its text and its columns.
interface Field {
	text: string
	x: number
	w: number
}

// `ch` on a blank cell of the pane only: the mesh and the ghosts never cover a drawn part.
function put_free(pane: Pane, at: Point, ch: string, style: string): void {
	const here = cell_at(pane.grid, pane.box.y + at.y, pane.box.x + at.x)

	if (here[0] === ' ') put_in(pane, at, ch, style)
}

// The mesh's two rows, counted up from the pane's last.
function mesh_rows(pane: Pane): [number, number] {
	const top = pane.box.h - MESH.up

	return [top, top + 1]
}

// The head's column in the pane; left of everything while it rewinds, so what it has built unbuilds.
function head_x(scrub: Scrub): number {
	return TIMELINE.track_x + scrub.head
}

// A node's style by where it lies from the head: the wave on it, passed, or still ahead.
function node_ink(x: number, scrub: Scrub): string {
	if (Math.abs(x - head_x(scrub)) <= MESH.wave) return WAVE
	const is_behind = scrub.is_done || (!scrub.is_rewinding && x < head_x(scrub))

	return is_behind ? PASSED : AHEAD
}

// The dotted mesh over the area's blank cells right of the stamp.
function mesh(scrub: Scrub): void {
	const { pane } = scrub

	for (const [index, y] of mesh_rows(pane).entries()) {
		const from = MESH.left + (index % PAIR) * (MESH.pitch / PAIR)

		for (let x = from; x < pane.box.w - 1; x += MESH.pitch) {
			put_free(pane, { x, y }, '·', node_ink(x, scrub))
		}
	}
}

// One letter of the lane's row as its two ghosts: over and under the outline, closing in on it the
// nearer the head is.
function ghost_pair(scrub: Scrub, index: number, ch: string): void {
	const ahead = index - scrub.head

	if (ch === ' ' || ahead <= 0) return
	const off = Math.min(GHOST.off, Math.ceil(ahead / PAIR))
	const x = TIMELINE.track_x + index
	const y = scrub.pane.box.h - GHOST.art_up
	const style = ink(mix(RGB.soft, RGB.night, GHOST.dim))

	put_free(scrub.pane, { x: x - off, y: y - 1 }, ch, style)
	put_free(scrub.pane, { x: x + off, y: y + 1 }, ch, style)
}

// The lane's row ahead of the head, as two dim copies sliding onto its outline; none once it has typed.
function ghosts(draw: ThemeDraw, scrub: Scrub): void {
	if (scrub.is_done) return
	const cells = code_points(draw.api.layout.row_text).slice(0, scrub.width)

	for (const [index, ch] of cells.entries()) ghost_pair(scrub, index, ch)
}

// Whether the scan inset shows: on a pane with all its rows, once the second clue card has appeared.
function has_inset(draw: ThemeDraw, scrub: Scrub): boolean {
	const [, second] = card_columns(scrub, fields_of(draw).length)

	return scrub.pane.box.h >= PANEL.rows && second !== undefined && is_passed(scrub, second)
}

// The lane's fields laid side by side in the mesh, each box as wide as its text; a text that would
// run into the inset's place is cut, and a box with no room is left out.
function fields_in(draw: ThemeDraw, scrub: Scrub): Array<Field> {
	const limit = scrub.pane.box.w - INSET.back - 1
	const fields: Array<Field> = []
	let x = MESH.left

	for (const { title } of fields_of(draw)) {
		const text = title.slice(0, Math.max(0, limit - x - FRAME.pad))

		if (text.length >= FRAME.least) fields.push({ text, x, w: text.length + FRAME.pad })
		x += text.length + FRAME.pad + FRAME.gap
	}

	return fields
}

// How far a box is built: 0 its corner dots, 1 dashed as the head crosses it, 2 solid behind the head.
function built(field: Field, scrub: Scrub): number {
	const x = scrub.is_rewinding ? -1 : head_x(scrub)

	if (scrub.is_done || x >= field.x + field.w) return PAIR

	return x >= field.x ? 1 : 0
}

// The field's text in its box's top edge, fading in behind the head; the edge itself until then.
function box_top(scrub: Scrub, field: Field, inks: ClueInks): void {
	const [y] = mesh_rows(scrub.pane)
	const shown = scrub.is_done ? 1 : clamped((head_x(scrub) - field.x - field.w) / FRAME.fade)
	const style = shown >= 1 ? inks.title : ink(mix(RGB.night, RGB.white, shown))

	put_in(scrub.pane, { x: field.x, y }, `┌ ${field.text} ┐`, inks.line)
	put_in(scrub.pane, { x: field.x + PAIR, y }, field.text, style)
}

// A box not yet solid: its corner dots, and dashed edges between them once the head is crossing it.
function sketch(scrub: Scrub, field: Field, edge: string): void {
	const end = field.x + field.w - 1

	for (const y of mesh_rows(scrub.pane)) {
		put_in(scrub.pane, { x: field.x, y }, '·', DOTS)
		put_in(scrub.pane, { x: field.x + 1, y }, edge, DOTS)
		put_in(scrub.pane, { x: end, y }, '·', DOTS)
	}
}

// A field's wireframe box at its stage: corner dots, dashed edges, then solid edges round its text.
function box(scrub: Scrub, field: Field, inks: ClueInks): void {
	const [, low] = mesh_rows(scrub.pane)
	const stage = built(field, scrub)
	const inner = field.w - PAIR

	if (stage < PAIR) {
		sketch(scrub, field, stage === 1 ? repeated('╌', inner) : '')

		return
	}

	box_top(scrub, field, inks)
	put_in(scrub.pane, { x: field.x, y: low }, `└${repeated('─', inner)}┘`, inks.line)
}

function boxes(draw: ThemeDraw, scrub: Scrub, inks: ClueInks): void {
	for (const field of fields_in(draw, scrub)) box(scrub, field, inks)
}

// How bright the vein is at a pixel of an image `size` pixels: on the vein or its branch, grainy.
function vein(px: number, py: number, size: { w: number; h: number }): number {
	const mid = size.h / PAIR + Math.sin(px * VEIN.sway + 1) * size.h * VEIN.swing
	const past = Math.max(0, px - size.w * VEIN.split)
	const near = Math.min(
		Math.abs(py - mid),
		Math.abs(py - mid - past * VEIN.slope) + (past > 0 ? 0 : size.h),
	)
	const grain = 1 - VEIN.grain * hash(px, py, VEIN.salt)

	return clamped(1 - near / VEIN.thin) * grain
}

// A pixel's color: dark red up to bright red, white where the vein is hottest.
function vein_rgb(level: number): string {
	if (level > VEIN.hot) return mix(RGB.red, RGB.white, (level - VEIN.hot) / (1 - VEIN.hot))

	return mix(RGB.wall_dark, RGB.red, level / VEIN.hot)
}

// A cell's two pixels as a half block's style: the upper its foreground, the lower its background.
function pixel_pair(at: Point, size: { w: number; h: number }, lift: number): string {
	const top = vein_rgb(clamped(vein(at.x, at.y * PAIR, size) + lift))
	const low = vein_rgb(clamped(vein(at.x, at.y * PAIR + 1, size) + lift))

	return `${fg(top)}${bg(low)}`
}

// The scan image in `area` of the pane, two pixels a cell in half blocks, as far as `shown` of its
// columns and rows are revealed, a scan line passing along it.
function scan_image(
	pane: Pane,
	area: Box,
	shown: { cols: number; rows: number },
	tick: number,
): void {
	const size = { w: area.w, h: area.h * PAIR }
	const line = Math.floor(tick / INSET.line_pace) % Math.max(1, area.w)
	const lifts = Array.from({ length: Math.min(area.w, shown.cols) }, (_, x) =>
		x === line ? VEIN.line : 0,
	)

	for (let y = 0; y < Math.min(area.h, shown.rows); y++) {
		for (const [x, lift] of lifts.entries()) {
			put_in(pane, { x: area.x + x, y: area.y + y }, '▀', pixel_pair({ x, y }, size, lift))
		}
	}
}

// The scan inset at the mesh's right end, between bracket corners, revealed as the head moves on
// from the second card's tick.
function inset(draw: ThemeDraw, scrub: Scrub): void {
	const { pane } = scrub
	const [top, low] = mesh_rows(pane)
	const x = pane.box.w - INSET.back + 1
	const second = card_columns(scrub, fields_of(draw).length)[1] ?? 0
	const cols = scrub.is_done ? INSET.w : head_x(scrub) - second

	if (!has_inset(draw, scrub)) return
	put_in(pane, { x: x - 1, y: top }, '⌜', ink(RGB.soft))
	put_in(pane, { x: x + INSET.w, y: low }, '⌟', ink(RGB.soft))
	scan_image(pane, { x, y: top, w: INSET.w, h: MESH.rows }, { cols, rows: MESH.rows }, draw.tick)
}

const run_board_theme_rk800_mesh = { boxes, built, ghosts, inset, mesh, scan_image, vein }

export { run_board_theme_rk800_mesh }
