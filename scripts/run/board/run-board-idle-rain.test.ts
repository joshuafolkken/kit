import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_idle_rain, type RainMoment } from './run-board-idle-rain'
import { run_board_lamp_spots, type LampMoment } from './run-board-lamp-spots'
import { run_board_spot } from './run-board-spot'
import { run_board_sweep } from './run-board-sweep'

// joshuafolkken/kit#8356: the matrix board's idle rain in the lamp panel's cells — one column wide, a
// white-green head with the blank below it, pouring faster while a row decodes, written only where the
// lamps sit.

const { POUR, SPEED, cell_text, row_at, speed_of } = run_board_idle_rain
const PRECISION = 9
const { lamps_in, write_lamps } = run_board_lamp_spots
const { LAMP } = run_board_spot
const START = Date.parse('2026-11-22T09:00:00.000Z')
const FRAME_MS = 70
const PANEL_ROWS = 5
const COLUMNS = Array.from({ length: 40 }, (_, index) => index + 1)
const PLACES = COLUMNS.flatMap((column) =>
	Array.from({ length: PANEL_ROWS }, (_, panel_row) => ({ column, panel_row })),
)
const HEAD = '225;255;225'
const IDLE: RainMoment = { ms: START, is_burst: false }
const PANEL = Array.from({ length: 8 }, () => LAMP).join(' ')
const LINES = ['header', `  24h  5  ${PANEL}`, `   7d     ${PANEL}`]
// eslint-disable-next-line no-control-regex -- a cell is written with control characters
const CELL = /\u{1B}\[(\d+;\d+)H/gu
const SCREEN_COLUMNS = 80
const LAMPS = lamps_in(LINES, [1, 2, 3], SCREEN_COLUMNS)
const LAMP_PLACES = LAMPS.map((lamp) => `${String(lamp.row)};${String(lamp.column)}`)

interface Written {
	places: Array<string>
	is_themed: boolean
}

afterEach(() => {
	vi.unstubAllEnvs()
})

// The first moment from `START` the column's head is on a panel row with one row below it.
function head_moment(column: number): RainMoment {
	for (let frame = 0; ; frame += 1) {
		const at = { ms: START + frame * FRAME_MS, is_burst: false }
		const row = Math.floor(row_at(column, at))

		if (row >= 0 && row < PANEL_ROWS - 1) return at
	}
}

describe('run_board_idle_rain.cell_text', () => {
	it('draws every cell one column wide', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const frames = [0, 1, 7, 30].map((frame) => ({ ...IDLE, ms: START + frame * FRAME_MS }))
		const widths = frames.flatMap((at) =>
			PLACES.map((place) => run_board_fit.width_of(stripVTControlCharacters(cell_text(place, at)))),
		)

		expect(new Set(widths)).toStrictEqual(new Set([1]))
	})

	it.each([1, 3, 9, 20])(
		'paints column %i’s head white-green on its row, the cell below blank',
		(column) => {
			vi.stubEnv('FORCE_COLOR', '3')
			const at = head_moment(column)
			const row = Math.floor(row_at(column, at))

			expect(cell_text({ column, panel_row: row }, at)).toContain(HEAD)
			expect(cell_text({ column, panel_row: row + 1 }, at)).toBe(' ')
		},
	)
})

describe('run_board_idle_rain.speed_of', () => {
	it.each(COLUMNS)('pours column %i faster while a row decodes than its idle pace', (column) => {
		const idle = speed_of(column, IDLE)

		expect(idle).toBeGreaterThanOrEqual(SPEED.least)
		expect(idle).toBeLessThanOrEqual(SPEED.least + SPEED.spread)
		expect(speed_of(column, { ...IDLE, is_burst: true })).toBeGreaterThan(idle)
	})

	// joshuafolkken/kit#8369: the panel's frame is the demo's live one; the board's drop steps the sweep's.
	it.each(COLUMNS)(
		'pours column %i at the board drops’ least pour pace, in rows a second',
		(column) => {
			const per_ms = speed_of(column, { ...IDLE, is_burst: true }) / FRAME_MS

			expect(per_ms * run_board_sweep.SWEEP_MS).toBeCloseTo(POUR.least, PRECISION)
		},
	)
})

// The screen places, `row;column`, the rain wrote at `at` after `since`, past the theme, and whether it
// wrote any through the theme.
function written_at(at: LampMoment, since: LampMoment | undefined): Written {
	const drawn: Array<string> = []
	const themed: Array<string> = []
	const ports = {
		write: (text: string): void => {
			themed.push(text)
		},
		write_drawn: (text: string): void => {
			drawn.push(text)
		},
	}

	write_lamps(LAMPS, ports, at, since)
	const places = [...drawn.join('').matchAll(CELL)].map((match) => match[1] ?? '')

	return { places, is_themed: themed.length > 0 }
}

describe('run_board_lamp_spots.write_lamps with the idle rain', () => {
	it('writes every lamp’s own cell and no other, past the theme', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(written_at({ ...IDLE, is_rain: true }, undefined)).toStrictEqual({
			places: LAMP_PLACES,
			is_themed: false,
		})
	})

	it('writes later only lamp cells, those whose rain changed', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const since = { ...IDLE, is_rain: true }
		const { places } = written_at({ ...since, ms: START + 10 * FRAME_MS }, since)

		expect(places.length).toBeGreaterThan(0)
		expect(places.filter((place) => !LAMP_PLACES.includes(place))).toStrictEqual([])
	})
})
