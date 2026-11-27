import { expect } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import {
	run_board_theme_host_snap_fixture,
	type SnapMask,
} from './run-board-theme-host-snap-fixture'
import type { ThemeFactory } from './run-board-theme-host-types'
import { run_board_theme_wopr_fixture } from './run-board-theme-wopr-fixture'

// joshuafolkken/kit#8917: the differences from the confirmed theme demo the user decided after it
// (the Issue's last comment, the confirmed specification's §2 and §4). Each is a narrow allowance a
// theme's demo comparison names: the cells it leaves out of the comparison are blanked alike in the
// demo's snap and the port's frame, and a positive check holds what kit draws there instead.

const { HOST, snap_text } = run_board_theme_host_fixture
const { demo_snaps, frame_at, theme_of } = run_board_theme_host_snap_fixture
const { area_end, area_top, edge, level_spot } = HOST.layout
const { code_points } = run_board_theme_host_grid
const { WOPR } = run_board_theme_wopr_fixture

// §2: every work's level display ends at the rule's right end, the rule filling its left. The demo
// left-aligned it in an 18-column spot, so the columns a level of up to this width moves across
// differ.
const LEVEL_REACH = 24
const BLANK = ' '
const SNAP_KEY = /^\d(?<event>[a-z])\d+$/u
// flux's big NOTICE clock: the three area rows under the THROUGHPUT rule.
const CLOCK_FIRST = 1
const CLOCK_ROWS = 3
const HEADER_FIRST = 1
const HEADER_BELOW = 2

function event_of(key: string): string {
	return SNAP_KEY.exec(key)?.groups?.['event'] ?? ''
}

function blank_columns(row: string, from: number, to: number): string {
	const cells = code_points(row.padEnd(to, BLANK))

	return cells.map((cell, x) => (x >= from && x < to ? BLANK : cell)).join('')
}

function rows_mapped(text: string, map: (row: string, y: number) => string): string {
	return text
		.split('\n')
		.map((row, y) => map(row, y))
		.join('\n')
}

// The columns a level display moves across: on the level spot's row (where an opening drawing over
// it hides the level, the rule's fill still reaches further left) and on every other row that shows
// the work's level `label` (an opening or ending moving the rule).
function level_moved(label: RegExp): SnapMask {
	return (_key, text) =>
		rows_mapped(text, (row, y) =>
			y === level_spot.y || label.test(row) ? blank_columns(row, edge - LEVEL_REACH, edge) : row,
		)
}

// Whole rows `rows` of the snaps of the events named in `events` (a snap key's event letter).
function rows_redrawn(events: string, rows: ReadonlyArray<number>): SnapMask {
	return (key, text) => {
		if (!events.includes(event_of(key))) return text

		return rows_mapped(text, (row, y) => (rows.includes(y) ? '' : row))
	}
}

function blank_cells(row: string, cells: ReadonlyArray<{ x: number }>): string {
	let masked = row

	for (const { x } of cells) masked = blank_columns(masked, x, x + 1)

	return masked
}

// The cells `cells` of the snaps of the events named in `events`.
function cells_changed(events: string, cells: ReadonlyArray<{ y: number; x: number }>): SnapMask {
	return (key, text) => {
		if (!events.includes(event_of(key))) return text

		return rows_mapped(text, (row, y) =>
			blank_cells(
				row,
				cells.filter((cell) => cell.y === y),
			),
		)
	}
}

function masks_of(...masks: ReadonlyArray<SnapMask>): SnapMask {
	return (key, text) => {
		let masked = text

		for (const mask of masks) masked = mask(key, masked)

		return masked
	}
}

// The gap rows above the THROUGHPUT and LANES rules, where flux's fire trails burn.
const FLUX_TRAIL_ROWS = [area_top - 1, area_end + 1]
const FLUX_CLOCK_ROWS = Array.from({ length: CLOCK_ROWS }, (_, row) => area_top + CLOCK_FIRST + row)
// The header rows under the first, where trace's NOTICE rain falls (the demo left them clear).
const TRACE_HEADER_ROWS = [HEADER_FIRST, HEADER_BELOW]

const LEVELS = {
	trace: /TRACE [■-]{5}/u,
	codec: /CAUTION \d+\.\d+/u,
	nixie: /[αβ] ATTRACTOR FIELD|WORLD LINE SHIFTING…/u,
	skynet: /THREAT: [A-Z]+/u,
	magi: /CONDITION [A-Z]+|MAGI DELIBERATING|POWER CUT|RESULT \d\/3 PASSED/u,
} as const

// joshuafolkken/kit#9137: wopr's code not yet locked changes on every tick, as measured on the film
// (the demo changed it every other tick): the rules' dashes running code and the PROGRESS strip's
// three letters. `run-board-theme-wopr-idle.test.ts` holds what kit draws there.
const WOPR_STRIP_LETTERS = 3
const WOPR_CODE_CELLS = [
	...WOPR.rule_cells,
	...Array.from({ length: WOPR_STRIP_LETTERS }, (_, index) => ({
		y: level_spot.y,
		x: WOPR.strip_x + index,
	})),
]

// joshuafolkken/kit#9137: the NOTICE's alarm beacon turns across the header's first row, and the
// WINNER table pages through the 18 confirmed strategy names (the demo had others).
// `run-board-theme-wopr-alarm.test.ts` and `run-board-theme-wopr-scenario-data.test.ts` hold them.
const WOPR_WINNER_W = 7
const WOPR_BEACON_CELLS = Array.from({ length: HOST.layout.head_top.w }, (_, index) => ({
	y: 0,
	x: HOST.layout.head_top.x + index,
}))
const WOPR_NAME_CELLS = Array.from({ length: WOPR.bottom - WOPR.sky }, (_row, row) =>
	Array.from({ length: WOPR.table.w - WOPR_WINNER_W }, (_cell, index) => ({
		y: WOPR.sky + 1 + row,
		x: WOPR.table.x + index,
	})),
).flat()

const ALLOWANCES = {
	wopr: masks_of(
		cells_changed('prn', WOPR_CODE_CELLS),
		cells_changed('n', [...WOPR_BEACON_CELLS, ...WOPR_NAME_CELLS]),
	),
	// §4 trace: the gauge on the rule's right end; the NOTICE rain over all but the blinking spots.
	trace: masks_of(level_moved(LEVELS.trace), rows_redrawn('n', TRACE_HEADER_ROWS)),
	// §4 flux: the NOTICE's and ENDING's flames twice the demo's pace; the big clock shows the last
	// departure where no finish is estimated.
	flux: masks_of(rows_redrawn('nx', FLUX_TRAIL_ROWS), rows_redrawn('n', FLUX_CLOCK_ROWS)),
	codec: level_moved(LEVELS.codec),
	// The level's own text, which the opening's digit noise may half cover.
	nixie: level_moved(/ATTRACTOR FIELD|WORLD LINE/u),
	skynet: level_moved(LEVELS.skynet),
	magi: level_moved(LEVELS.magi),
} as const

interface LevelPlace {
	key: string
	end: number
}

// The column after the level `label`'s last character on `row`, counted in code points.
function level_end(row: string, label: RegExp): number | undefined {
	const match = label.exec(row)

	return match ? code_points(row.slice(0, match.index + match[0].length)).length : undefined
}

// Where the level `label` ends on each of the work's frames at the demo's snap ticks that show it.
function level_places(factory: ThemeFactory, theme_key: number, label: RegExp): Array<LevelPlace> {
	const theme = theme_of(factory)

	return demo_snaps(theme_key).flatMap(({ key, event, tick }) => {
		const rows = snap_text(frame_at(theme, event, tick)).split('\n')

		return rows
			.map((row) => level_end(row, label))
			.filter((end) => end !== undefined)
			.map((end) => ({ key, end }))
	})
}

// §2: on every frame that shows it, the level display's last character is the rule's last column.
function expect_level_at_edge(factory: ThemeFactory, theme_key: number, label: RegExp): void {
	const places = level_places(factory, theme_key, label)

	expect(places.length).toBeGreaterThan(0)
	expect(places.filter(({ end }) => end !== edge)).toStrictEqual([])
}

const run_board_theme_demo_allowance_fixture = {
	ALLOWANCES,
	LEVELS,
	expect_level_at_edge,
}

export { run_board_theme_demo_allowance_fixture }
