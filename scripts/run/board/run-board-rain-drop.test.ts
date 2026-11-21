import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen, type DropScreen } from './run-board-drop-screen'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_idle_rain } from './run-board-idle-rain'
import { run_board_labels } from './run-board-labels'
import { run_board_rain_drop, type Fall, type Share } from './run-board-rain-drop'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8367: one drop a second falling down the whole matrix board, in place of the sweep.

const { drop_bytes, falls_at, head_row, poured } = run_board_rain_drop
const { POUR } = run_board_idle_rain
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
const SALT_POUR_COLUMN = 4
const SALT_POUR_SPEED = 5
const PRECISION = 9

// Every draw at its least, but the column and the pace as given.
function share_of(column: number, speed: number): Share {
	return (values) => {
		if (values[1] === SALT_COLUMN) return column
		if (values[1] === SALT_SPEED) return speed

		return 0
	}
}

// Every draw at its least, but a poured drop's pace as given and the `nth` of a step's drops a quarter
// of the way further across.
function pour_share_of(speed: number): Share {
	return (values) => {
		if (values[1] === SALT_POUR_COLUMN) return (values[2] ?? 0) / 4
		if (values[1] === SALT_POUR_SPEED) return speed

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

// A drop the rain poured in, by its pace: the idle ones are all slower.
function is_poured(fall: Fall): boolean {
	return fall.speed >= POUR.least
}

// joshuafolkken/kit#8369: the rain pours while a row types, here from 1000 up to 1200.
describe('run_board_rain_drop.falls_at — the pour while a row types', () => {
	const pouring = poured(blank_screen(20, 8), [{ from_ms: 1000, to_ms: 1200 }], 1000)

	it('enters four drops on each step in place of the second’s one, at 0.6..1.1 rows a step', () => {
		const slow = falls_at(pouring, 1150, pour_share_of(0))
		const fast = falls_at(pouring, 1150, pour_share_of(1))

		expect(slow.filter((fall) => is_poured(fall)).map((fall) => fall.born_ms)).toEqual(
			[1000, 1050, 1100, 1150].flatMap((born_ms) => Array.from({ length: 4 }, () => born_ms)),
		)
		expect(slow.filter((fall) => !is_poured(fall)).map((fall) => fall.born_ms)).toEqual([0])
		expect(
			new Set(slow.filter((fall) => fall.born_ms === 1000).map((fall) => fall.column)),
		).toEqual(new Set([1, 3, 5, 7]))
		expect(slow.at(-1)?.speed).toBeCloseTo(0.6, PRECISION)
		expect(fast.at(-1)?.speed).toBeCloseTo(1.1, PRECISION)
	})

	it('speeds a falling drop up to the pour’s pace on each step it pours', () => {
		const [idle] = falls_at(pouring, 1200, share_of(0, 0))
		const fall = idle ?? { born_ms: 0, column: 1, speed: 0 }

		expect(fall.speed).toBeCloseTo(0.12, PRECISION)
		expect(head_row(fall, 1000, pouring.pours)).toBe(3)
		// 20 idle steps at 0.12 and 4 poured at 0.6: 4.8 rows, where 24 idle ones fall 2.88.
		expect(head_row(fall, 1200, pouring.pours)).toBe(5)
		expect(head_row(fall, 1200)).toBe(3)
	})

	it('returns to a drop a second from the step the typing ends; a poured drop keeps its pace', () => {
		const falls = falls_at(pouring, 2000, pour_share_of(0.5))
		const last = falls.findLast((fall) => is_poured(fall)) ?? { born_ms: 0, column: 1, speed: 0 }
		const seconds = falls.filter((fall) => !is_poured(fall)).map((fall) => fall.born_ms)

		expect(last.born_ms).toBe(1150)
		expect(seconds).toEqual([0, 2000])
		expect(head_row(last, 1350, pouring.pours)).toBe(1 + Math.floor(4 * 0.85))
		expect(head_row(last, 1350, pouring.pours)).toBe(head_row(last, 1350))
	})
})

function by_text(left: string, right: string): number {
	return left.localeCompare(right)
}

// The written cells of `bytes`, by `row;column`.
function written_cells(bytes: string): Map<string, string> {
	const cells = bytes.matchAll(
		new RegExp(String.raw`${ESC}\[(\d+;\d+)H((?:(?!${ESC}\[\d+;\d+H).)*)`, 'gsu'),
	)

	return new Map([...cells].map((match) => [match[1] ?? '', match[2] ?? '']))
}

describe('run_board_rain_drop.drop_bytes — a pouring step', () => {
	const pouring = poured(blank_screen(20, 40), [{ from_ms: 1000, to_ms: 3000 }], 1000)

	it('writes only the cells that changed since the step before, and every one that did', () => {
		const before = written_cells(drop_bytes(pouring, 1950, undefined))
		const now = written_cells(drop_bytes(pouring, 2000, undefined))
		const step = written_cells(drop_bytes(pouring, 2000, 1950))
		const changed = [...new Set([...before.keys(), ...now.keys()])].filter(
			(key) => before.get(key) !== now.get(key),
		)

		expect(now.size).toBeGreaterThan(step.size)
		expect([...step.keys()].toSorted(by_text)).toEqual(changed.toSorted(by_text))
		for (const [key, text] of now) if (step.has(key)) expect(step.get(key)).toBe(text)
	})

	it('draws a falling drop at the head the pour sped it to', () => {
		const sped = poured(blank_screen(20, 8), [{ from_ms: 1000, to_ms: 1200 }], 1000)
		// The idle drop falls in the last column, the poured ones in the first; its head is on row 5.
		const keys = [...written_cells(drop_bytes(sped, 1200, undefined, share_of(0.999, 0))).keys()]

		expect(keys.filter((key) => key.endsWith(';8')).toSorted(by_text)).toEqual([
			'1;8',
			'2;8',
			'3;8',
			'4;8',
			'5;8',
		])
	})
})

describe('run_board_rain_drop.poured — the spans carried across redraws', () => {
	it('keeps a span while a drop it sped up can be on screen, and merges the rest', () => {
		const spans = [
			{ from_ms: 0, to_ms: 100 },
			{ from_ms: 20_000, to_ms: 20_200 },
			{ from_ms: 20_100, to_ms: 20_300 },
		]

		expect(poured(blank_screen(20, 8), spans, 21_000).pours).toEqual([
			{ from_ms: 20_000, to_ms: 20_300 },
		])
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
