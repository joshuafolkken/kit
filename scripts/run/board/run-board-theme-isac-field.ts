import { run_board_theme_draw, type Pane } from './run-board-theme-draw'
import type { Point } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'

// The isac theme's hexagonal dot field, which its scanner, its ROW and its NOTICE all draw: dots on
// a hex-offset grid, lit out to a radius, and one ring pulse crossing them.

const { PAIR, put_in } = run_board_theme_draw
const { HEX, INKS } = run_board_theme_isac_data

// The field at a moment: its centre, how far its ring has run, and the radius its dots are lit to.
interface Field {
	center: Point
	reach: number
	lit: number
}

type Mark = readonly [string, string]

function is_hex(at: Point): boolean {
	return (at.x + (at.y % PAIR) * HEX.shift) % HEX.every === 0
}

// How far a cell is from the centre, in rows: a cell is twice as tall as it is wide.
function field_distance(at: Point, center: Point): number {
	return Math.hypot((at.x - center.x) / HEX.aspect, at.y - center.y)
}

// What the field draws on a cell: the ring where it passes, a dot on the grid, nothing between.
function field_mark(at: Point, field: Field): Mark | undefined {
	const distance = field_distance(at, field.center)

	if (Math.abs(distance - field.reach) < HEX.ring_w) return ['∙', INKS.BRIGHT]
	if (!is_hex(at)) return undefined

	return ['·', distance < field.lit ? INKS.ORANGE : INKS.DIM]
}

function field_row(pane: Pane, y: number, field: Field): void {
	for (let x = 0; x < pane.box.w; x++) {
		const mark = field_mark({ x, y }, field)

		if (mark) put_in(pane, { x, y }, mark[0], mark[1])
	}
}

// The field over the whole pane.
function hex_field(pane: Pane, field: Field): void {
	for (let y = 0; y < pane.box.h; y++) field_row(pane, y, field)
}

const run_board_theme_isac_field = { field_distance, field_mark, hex_field, is_hex }

export { run_board_theme_isac_field }
export type { Field }
