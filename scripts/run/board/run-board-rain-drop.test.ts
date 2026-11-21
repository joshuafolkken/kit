import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen, type DropScreen } from './run-board-drop-screen'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_idle_rain } from './run-board-idle-rain'
import { run_board_labels } from './run-board-labels'
import { run_board_rain_drop, type Share } from './run-board-rain-drop'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8367: one drop a second falling down the whole matrix board, in place of the sweep.

const { drop_bytes, falls_at } = run_board_rain_drop
const { SHADES } = run_board_header_trace
const { painted } = run_board_labels
const ESC = '\u{1B}'
const CSI = `${ESC}[`
const GREEN = `${CSI}32m`
const RESET = `${CSI}0m`
const ESCAPES = new RegExp(String.raw`${ESC}\[[\d;]*[mH]`, 'gu')
const IDLE: Typing = { seen: undefined, lines: [] }
const SALT_COLUMN = 1
const SALT_SPEED = 2
const PRECISION = 9

// Every draw at its least, but the column and the pace as given.
function share_of(column: number, speed: number): Share {
	return (values) => {
		if (values[1] === SALT_COLUMN) return column
		if (values[1] === SALT_SPEED) return speed

		return 0
	}
}

function screen(lines: ReadonlyArray<string>, size: { rows: number; columns: number }): DropScreen {
	return run_board_drop_screen.screen_of({ lines, spots: [] }, IDLE, size)
}

function blank_screen(rows: number, columns: number): DropScreen {
	return screen(
		Array.from({ length: rows }, () => ''),
		{ rows, columns },
	)
}

function at(row: number, text: string): string {
	return `${CSI}${String(row)};1H${RESET}${text}`
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_rain_drop.falls_at — one drop a second', () => {
	const tall = blank_screen(20, 10)

	it('enters a drop on the top row exactly on each second', () => {
		const share = share_of(0, 0)

		expect(falls_at(tall, 1999, share).map((fall) => fall.born_ms)).toEqual([0, 1000])
		const entered = falls_at(tall, 2000, share).at(-1)

		expect(entered?.born_ms).toBe(2000)
		expect(entered === undefined ? 0 : run_board_rain_drop.head_row(entered, 2000)).toBe(1)
	})

	it('enters in the column the random draw picks', () => {
		expect(falls_at(tall, 0, share_of(0.55, 0)).map((fall) => fall.column)).toEqual([6])
		expect(falls_at(tall, 0, share_of(0.999, 0)).map((fall) => fall.column)).toEqual([10])
	})

	it('falls at the idle rain panel’s pace, the one formula both share', () => {
		const [slow] = falls_at(tall, 0, share_of(0, 0))
		const [fast] = falls_at(tall, 0, share_of(0, 1))

		expect(slow?.speed).toBe(run_board_idle_rain.pace_of(0))
		expect(fast?.speed).toBe(run_board_idle_rain.pace_of(1))
		expect(slow?.speed).toBeCloseTo(0.12, PRECISION)
		expect(fast?.speed).toBeCloseTo(0.34, PRECISION)
	})

	it('leaves once its trail falls past the frame’s last row, the rows the frame has now', () => {
		const share = share_of(0, 1)
		const short = blank_screen(3, 10)

		expect(falls_at(short, 1000, share).map((fall) => fall.born_ms)).toEqual([0, 1000])
		expect(falls_at(short, 1050, share).map((fall) => fall.born_ms)).toEqual([1000])
		expect(falls_at(tall, 1050, share).map((fall) => fall.born_ms)).toEqual([0, 1000])
	})
})

describe('run_board_rain_drop.drop_bytes — a cell with text', () => {
	const lettered = screen(
		Array.from({ length: 6 }, () => `${GREEN}X${RESET}`),
		{ rows: 6, columns: 1 },
	)
	const share = share_of(0, 1)

	it('lights the cell without changing it: white at the head, bright for two behind', () => {
		expect(drop_bytes(lettered, 600, undefined, share)).toBe(
			[
				at(5, painted(SHADES.head, 'X')),
				at(4, painted(SHADES.bright, 'X')),
				at(3, painted(SHADES.bright, 'X')),
			].join(''),
		)
	})

	it('writes only what changed since the last turn and puts a left cell back in its own colors', () => {
		expect(drop_bytes(lettered, 750, 600, share)).toBe(
			[
				at(3, `${GREEN}X${RESET}`),
				at(6, painted(SHADES.head, 'X')),
				at(5, painted(SHADES.bright, 'X')),
			].join(''),
		)
	})
})

describe('run_board_rain_drop.drop_bytes — a blank cell and the cells it skips', () => {
	const share = share_of(0, 1)

	it('shows code in a blank cell, the trail fading behind the head', () => {
		const written = drop_bytes(blank_screen(5, 1), 600, undefined, share)
		const glyphs = written.replaceAll(ESCAPES, '')

		expect([...glyphs]).toHaveLength(5)
		expect(glyphs).not.toContain(' ')
		expect(written).toContain(painted(SHADES.head, glyphs.at(0) ?? ''))
		expect(written).toContain(painted(SHADES.darkest, glyphs.at(-1) ?? ''))
	})

	it('leaves a character two columns wide whole, and writes nothing with no screen', () => {
		const wide = screen(['日', '日'], { rows: 2, columns: 2 })

		expect(drop_bytes(wide, 50, undefined, share)).toBe('')
		expect(drop_bytes(undefined, 600, undefined, share)).toBe('')
	})
})
