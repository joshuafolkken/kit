import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Channel } from './run-board-theme-host-types'
import { run_board_theme_rk800_break } from './run-board-theme-rk800-break'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'

// The rk800 theme's reconstruction scrub, a ROW's moving parts. The timeline's head first rewinds
// to the left end, then plays forward as the lane types; each yellow tick lights as the head passes
// it. Over the timeline the new lane's row stands as dotted line-art and turns solid behind the
// head. A thin white line crosses the whole board at the head's column. For the event the board
// sinks into a dark scan blue, the lanes alone bright; every rule flashes blue once as it ends.

const { code_points, is_rule, restyle } = run_board_theme_host_grid
const { PAIR, data_pane, put_in, share_of } = run_board_theme_draw
const { RGB, STAMP, TIMELINE } = run_board_theme_rk800_data
const { bold, ink, mix, on } = run_board_theme_rk800_parts
const { is_kept_row } = run_board_theme_rk800_break

// The scrub at a tick: the area's pane, the track's width, the head's cell on it, whether the head
// still rewinds and whether the lane has typed.
interface Scrub {
	pane: Pane
	width: number
	head: number
	is_rewinding: boolean
	is_done: boolean
}

// The track's styles behind the head and ahead of it.
const PLAYED = { tick: bold(RGB.yellow), line: bold(RGB.white) }
const AHEAD = { tick: ink(mix(RGB.yellow, RGB.night, TIMELINE.unlit)), line: ink(RGB.plate) }
// The line-art's row and the hints' row, counted up from the timeline's.
const ART_UP = 3

// How far the head has played: from the left end once the rewind is over, to the right as the lane types.
function play_share(row: Channel): number {
	if (!row.is_typing) return 1

	return share_of(row.length, STAMP.rewind, Math.max(1, row.total - STAMP.rewind))
}

function scrub_of(draw: ThemeDraw, count: string): Scrub {
	const { s, tick } = draw
	const pane = data_pane(draw)
	const taken = TIMELINE.track_x + TIMELINE.box_w + count.length + TIMELINE.tail + PAIR
	const width = Math.max(TIMELINE.min, pane.box.w - taken)
	const age = tick - s.row.start
	const is_rewinding = s.row.is_typing && age < STAMP.rewind
	const share = is_rewinding ? 1 - age / STAMP.rewind : play_share(s.row)
	const head = Math.round(share * (width - 1))

	return { pane, width, head, is_rewinding, is_done: !s.row.is_typing }
}

// The cells from one yellow tick to the next on a track `width` wide.
function tick_every(width: number): number {
	return Math.max(PAIR, Math.floor(width / (TIMELINE.ticks + 1)))
}

// The yellow ticks stand evenly along the track.
function is_tick(index: number, width: number): boolean {
	return index > 0 && index % tick_every(width) === 0
}

// A cell of the track: the scrub head, a yellow tick, the line — lit where the head has played.
function track_cell(index: number, scrub: Scrub): readonly [string, string] {
	if (index === scrub.head) return ['●', PLAYED.line]
	const inks = !scrub.is_rewinding && index < scrub.head ? PLAYED : AHEAD

	return is_tick(index, scrub.width) ? ['┃', inks.tick] : ['━', inks.line]
}

// The timeline on the pane's last row: L2, the track, R2 and the count of lanes typed.
function timeline(scrub: Scrub, count: string): void {
	const { pane, width, is_done } = scrub
	const y = pane.box.h - 1
	const end = TIMELINE.track_x + width + 1

	put_in(pane, { x: 1, y }, ' L2 ', on(RGB.white, RGB.blue))

	for (let index = 0; index < width; index++) {
		put_in(pane, { x: TIMELINE.track_x + index, y }, ...track_cell(index, scrub))
	}

	put_in(pane, { x: end, y }, ' R2 ', on(RGB.white, is_done ? RGB.blue : RGB.plate))
	put_in(pane, { x: end + TIMELINE.box_w + 1, y }, count, bold(RGB.white))
}

function is_blank(cells: ReadonlyArray<string>, at: number): boolean {
	return (cells[at] ?? ' ') === ' '
}

// A field's outline: a dot at each end of it, dashes between.
function outline_glyph(cells: ReadonlyArray<string>, index: number): string {
	if (is_blank(cells, index)) return ' '

	return is_blank(cells, index - 1) || is_blank(cells, index + 1) ? '·' : '╌'
}

// The new lane's row over the track, column for column: dotted outlines of its fields, solid behind
// the head; a blue marker at each edge of the area.
function lane_art(draw: ThemeDraw, scrub: Scrub): void {
	const { pane, width, head, is_rewinding } = scrub
	const cells = code_points(draw.api.layout.row_text).slice(0, width)
	const outline = cells.map((_, index) => outline_glyph(cells, index)).join('')
	const solid = cells.slice(0, is_rewinding ? 0 : head + 1).join('')
	const y = pane.box.h - ART_UP
	const x = TIMELINE.track_x

	put_in(pane, { x, y }, outline, ink(mix(RGB.soft, RGB.night, STAMP.outline)))
	put_in(pane, { x, y }, solid, ink(RGB.text))
	put_in(pane, { x: 0, y }, '▌', bold(RGB.blue))
	put_in(pane, { x: pane.box.w - 1, y }, '▐', bold(RGB.blue))
}

// Between the line-art and the timeline: the rewind's hint, and a key prompt in the middle.
function hints(draw: ThemeDraw, scrub: Scrub): void {
	const { pane, is_rewinding } = scrub
	const y = pane.box.h - PAIR
	const is_lit = draw.tick % STAMP.prompt_beat >= STAMP.prompt_lit
	const ground = mix(RGB.blue, RGB.white, is_lit ? STAMP.prompt_glow : 0)

	if (is_rewinding) put_in(pane, { x: TIMELINE.track_x, y }, STAMP.hint, ink(RGB.soft))
	put_in(pane, { x: Math.floor(pane.box.w / PAIR) - 1, y }, ' △ ', on(RGB.white, ground))
}

// A cell the line crosses: a line where it is empty, else its own glyph in white.
function line_cell(cell: Cell): Cell {
	return cell[0] === ' ' ? ['│', ink(RGB.white)] : [cell[0], bold(RGB.white)]
}

// The line's column on row `y`: a kept row's cells are recolored only, never drawn on.
function cross_row(draw: ThemeDraw, y: number, x: number): void {
	const row = draw.grid[y]
	const cell = row?.[x]

	if (!row || !cell) return
	row[x] = is_kept_row(draw.api.layout, y) ? [cell[0], bold(RGB.white)] : line_cell(cell)
}

// The thin white line down the whole board at the head's column, while the lane types.
function scan_line(draw: ThemeDraw, scrub: Scrub): void {
	if (scrub.is_done) return
	const x = scrub.pane.box.x + TIMELINE.track_x + scrub.head

	for (const y of draw.grid.keys()) cross_row(draw, y, x)
}

// How deep the board has sunk: easing in as the lane starts, back out once the rules have flashed.
function sink_share(row: Channel, tick: number): number {
	if (row.is_typing) return share_of(tick, row.start, STAMP.ease)

	return 1 - share_of(row.cooled, STAMP.flash, STAMP.tail - STAMP.flash)
}

// The whole board but the lanes' rows sinks into the dark scan blue; the tick the lane has typed,
// every rule flashes blue.
function sink(draw: ThemeDraw): void {
	const { api, grid, s, tick } = draw
	const deep = ink(mix(RGB.text, RGB.deep, sink_share(s.row, tick)))
	const is_flash = !s.row.is_typing && s.row.cooled < STAMP.flash
	const rule = is_flash ? bold(RGB.blue) : deep
	const lanes = api.layout.lane_rows

	restyle(
		grid,
		(_, __, y) => !lanes.includes(y),
		(_, __, cell) => (is_rule(cell) ? rule : deep),
	)
}

const run_board_theme_rk800_scrub = {
	hints,
	lane_art,
	outline_glyph,
	play_share,
	scan_line,
	scrub_of,
	sink,
	tick_every,
	timeline,
	track_cell,
}

export { run_board_theme_rk800_scrub }
export type { Scrub }
