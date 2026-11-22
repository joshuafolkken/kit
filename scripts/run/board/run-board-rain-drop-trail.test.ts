import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen, type DropScreen } from './run-board-drop-screen'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_rain_drop, type Fall, type Share } from './run-board-rain-drop'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8627: the matrix board's drops with a film's long trail, the pour twice as fast and
// hurrying once the typing ends.

const { drop_bytes, falls_at, head_row, poured } = run_board_rain_drop
const { SHADES } = run_board_header_trace
const { painted } = run_board_labels
const ESC = '\u{1B}'
const GREEN = `${ESC}[32m`
const RESET = `${ESC}[0m`
const ESCAPES = new RegExp(String.raw`${ESC}\[[\d;]*m`, 'gu')
const IDLE: Typing = { seen: undefined, lines: [] }
const SALT = { column: 1, speed: 2, trail: 6, pour_trail: 7 }
const STEP_MS = run_board_rain_drop.DROP_MS
const SECOND_MS = 1000
const ROWS = 50
const PRIME = 31
const SEED = 7
const SCALE = 1000

// Every draw at its least, but those named by their salt.
function share_by(drawn: ReadonlyMap<number, number>): Share {
	return (values) => drawn.get(values[1] ?? 0) ?? 0
}

// A spread of draws, the same for the same values: the board's own source in small.
function scattered(values: ReadonlyArray<number>): number {
	const mixed = values.reduce((sum, value) => Math.abs(sum * PRIME + value) % (SCALE * SCALE), SEED)

	return (mixed % SCALE) / SCALE
}

function screen(lines: ReadonlyArray<string>, columns = 1): DropScreen {
	return run_board_drop_screen.screen_of({ lines, spots: [] }, IDLE, {
		rows: lines.length,
		columns,
	})
}

function blank_screen(rows: number, columns = 1): DropScreen {
	return screen(
		Array.from({ length: rows }, () => ''),
		columns,
	)
}

// The drop that entered at 0 alone in the first column, the later ones in the second, every one at
// 0.34 rows a step with a trail 40% of the rows.
function lone_share(values: ReadonlyArray<number>): number {
	if (values[1] === SALT.column) return values[0] === 0 ? 0 : 1
	if (values[1] === SALT.speed) return 1

	return 0
}

// The written text of each cell of `bytes` in the first column, by its row.
function written_rows(bytes: string): Map<number, string> {
	const cells = bytes.matchAll(
		new RegExp(String.raw`${ESC}\[(\d+);1H((?:(?!${ESC}\[\d+;\d+H).)*)`, 'gsu'),
	)

	return new Map([...cells].map((match) => [Number(match[1]), (match[2] ?? '').replace(RESET, '')]))
}

// Whether `text` is one glyph painted `paint`.
function is_painted(text: string | undefined, paint: Paint): boolean {
	return text === painted(paint, (text ?? '').replaceAll(ESCAPES, ''))
}

// The trails of the drops on `drop_screen` at `at_ms` that entered by 1000, the spread source drawing.
function trail_lengths(drop_screen: DropScreen, at_ms: number): Array<number> {
	return falls_at(drop_screen, at_ms, scattered)
		.filter((fall) => fall.born_ms <= 1000)
		.map((fall) => fall.length)
}

// The drops the rain poured onto `drop_screen` still on it at `at_ms`.
function poured_at(drop_screen: DropScreen, at_ms: number): Array<Fall> {
	return falls_at(drop_screen, at_ms, share_by(new Map())).filter(
		(fall) => fall.ends_ms !== undefined,
	)
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_rain_drop — a trail 40% to 100% of the screen', () => {
	const tall = poured(blank_screen(ROWS, 8), [{ from_ms: 1000, to_ms: 1050 }], 1000)

	it('draws each trail round(rows × (0.4 + r × 0.6)) cells long, the second’s and the pour’s', () => {
		const lengths = [0, 0.5, 0.999].map((trail) => {
			const share = share_by(
				new Map([
					[SALT.trail, trail],
					[SALT.pour_trail, trail],
				]),
			)

			return falls_at(tall, 1000, share).map((fall) => fall.length)
		})

		expect(lengths).toEqual([
			[20, 20, 20, 20, 20],
			[35, 35, 35, 35, 35],
			[50, 50, 50, 50, 50],
		])
	})

	it('reads the same drop’s trail the same on every turn, within 0.4 to 1 of the rows', () => {
		const lengths = trail_lengths(tall, 1050)

		expect(lengths).toHaveLength(5)
		expect(trail_lengths(tall, 1100)).toEqual(lengths)

		for (const length of lengths) {
			expect(length).toBeGreaterThanOrEqual(0.4 * ROWS)
			expect(length).toBeLessThanOrEqual(ROWS)
		}
	})

	it('keeps the slowest drop while its whole-screen trail still reaches the last row', () => {
		// Twenty rows, the drop at 0 at 0.12 rows a step: at 15000 its head is on row 37, its 20-cell
		// trail's end on row 17, past the 24 rows a four-cell trail would have kept it for.
		const long = share_by(new Map([[SALT.trail, 1]]))
		const born = falls_at(blank_screen(20), 15_000, long).map((fall) => fall.born_ms)

		expect(born).toContain(0)
	})
})

describe('run_board_rain_drop — the trail’s paint stretched over its length', () => {
	it('paints a four-cell trail exactly as `TRAIL` did', () => {
		// Ten rows at 40%: four cells behind the head on row 5.
		const rows = written_rows(drop_bytes(blank_screen(10, 2), 600, undefined, lone_share))
		const paints = [SHADES.head, SHADES.bright, SHADES.mid, SHADES.dark, SHADES.darkest]

		expect([...rows.keys()]).toEqual([5, 4, 3, 2, 1])

		for (const [index, paint] of paints.entries()) {
			expect(is_painted(rows.get(5 - index), paint)).toBe(true)
		}
	})

	it('spreads each of `TRAIL`’s shades over a quarter of a long trail', () => {
		// Fifty rows at 40%: twenty cells behind the head on row 21.
		const rows = written_rows(drop_bytes(blank_screen(ROWS, 2), 3000, undefined, lone_share))
		const paints = [SHADES.bright, SHADES.mid, SHADES.dark, SHADES.darkest]

		expect(rows.size).toBe(21)

		for (const [quarter, paint] of paints.entries()) {
			for (let cell = 1; cell <= 5; cell += 1) {
				expect(is_painted(rows.get(21 - quarter * 5 - cell), paint)).toBe(true)
			}
		}
	})
})

describe('run_board_rain_drop — a long trail over text', () => {
	// Text on the odd rows, blank on the even ones.
	const striped = screen(
		Array.from({ length: ROWS }, (_row, index) => (index % 2 === 0 ? `${GREEN}X${RESET}` : '')),
		2,
	)

	it('lights text white at the head and bright for two cells, the rest only on blanks', () => {
		const rows = written_rows(drop_bytes(striped, 3000, undefined, lone_share))

		expect(rows.get(21)).toBe(painted(SHADES.head, 'X'))
		expect(rows.get(20)).not.toContain('X')
		expect(rows.get(19)).toBe(painted(SHADES.bright, 'X'))

		for (let row = 1; row <= 17; row += 1) {
			if (row % 2 === 1) expect(rows.has(row)).toBe(false)
			else expect(rows.get(row)).not.toContain('X')
		}
	})
})

// A poured drop's rows, step by step as the approved demo adds them: its pace times one more for each
// second since the typing's end.
function stepped_row(fall: Fall, steps: number): number {
	let fallen = 0

	for (let step = 0; step < steps; step += 1) {
		const since_ms = fall.born_ms + step * STEP_MS - (fall.ends_ms ?? Infinity)

		fallen += fall.speed * (1 + Math.max(0, since_ms) / SECOND_MS)
	}

	return 1 + Math.floor(fallen + 1e-9)
}

describe('run_board_rain_drop — a poured drop hurrying once the typing ends', () => {
	const fall: Fall = { born_ms: 1000, column: 1, speed: 1.3, length: 20, ends_ms: 1230 }

	it('falls as far as the demo’s steps add up to, its pace times 1 + the seconds since', () => {
		for (let steps = 0; steps <= 60; steps += 1) {
			expect(head_row(fall, fall.born_ms + steps * STEP_MS)).toBe(stepped_row(fall, steps))
		}

		expect(head_row(fall, 1250)).toBe(1 + Math.floor(5 * 1.3))
	})

	it('never hurries the second’s drop', () => {
		const second: Fall = { born_ms: 1000, column: 1, speed: 1.3, length: 20 }

		expect(head_row(second, 1000 + 60 * STEP_MS)).toBe(1 + Math.floor(60 * 1.3))
	})

	it('leaves once its trail falls past the last row, sooner than it would unhurried', () => {
		// Twenty rows, one pouring step at 1000: four drops at 1.2 rows a step with eight-cell trails.
		const pouring = poured(blank_screen(20, 8), [{ from_ms: 1000, to_ms: 1050 }], 1000)

		expect(poured_at(pouring, 1850)).toHaveLength(4)
		expect(poured_at(pouring, 1900)).toEqual([])
		expect(
			head_row({ born_ms: 1000, column: 1, speed: 1.2, length: 8 }, 1900) - 8,
		).toBeLessThanOrEqual(20)
	})
})
