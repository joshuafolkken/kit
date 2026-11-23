import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_exit_rain } from './run-board-exit-rain'
import { run_board_fit } from './run-board-fit'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyReading } from './run-board-keys'
import type { RainCell } from './run-board-rain'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import { run_board_reveal_rain_fixture } from './run-board-reveal-rain-fixture'

// joshuafolkken/kit#8614: the matrix rain on a terminal narrower than the board — the frame wrapped at
// the terminal's columns as a redraw wraps it, the rain over every row and column of the terminal, and
// every beat written whole at once without a newline, so the screen never scrolls.

const { CLOSE, beats_of, grid_of, row_of } = run_board_reveal_rain
const { drawn_rows, screens } = run_board_reveal_rain_fixture
const ESC = '\u{1B}'
const UNDERLINE = `${ESC}[4m`
const OFF = `${ESC}[0m`
const HALF = 0.5
const SIZE = { columns: 10, rows: 6 }
const THEME = 'matrix'
// A line wider than the terminal, ending in an underlined link as the legend does.
const WIDE = `header\n0123456789012345${UNDERLINE}link${OFF}\nend`
const BEHIND: RainCell = { kind: 'behind' }
const RAIN = { random: (): number => HALF, is_colored: (): boolean => true }
const NO_KEYS: KeyReading = { folded: undefined }

function random(): number {
	return HALF
}

async function instant(): Promise<void> {
	await Promise.resolve()
}

// Each beat's row count and the widths its rows draw.
// The screen each beat leaves on the terminal: its row count and the widths its rows draw.
function shapes_of(texts: ReadonlyArray<string>): Array<{ rows: number; widths: Set<number> }> {
	return screens(texts).map((rows) => ({
		rows: rows.length,
		widths: new Set(rows.map((row) => run_board_fit.width_of(row))),
	}))
}

const FILLED = { rows: SIZE.rows, widths: new Set([SIZE.columns]) }

// The frame's screen rows once the rain has passed them all.
function passed_rows(frame: string): Array<string> {
	return grid_of(frame, SIZE).map((columns) =>
		row_of(
			columns,
			columns.map(() => BEHIND),
		),
	)
}

// Ports that record each write, their pauses ending at once, the rain pinned, on a `SIZE` terminal.
function recorded(): { written: Array<string>; ports: IntroPorts } {
	const written: Array<string> = []

	return {
		written,
		ports: {
			write: (text) => {
				written.push(text)
			},
			intro_sleep: instant,
			rain: RAIN,
			size: () => SIZE,
		},
	}
}

describe('run_board_reveal_rain.beats_of on a terminal narrower than the board', () => {
	it('draws every reveal beat at the terminal width and no taller than its rows', () => {
		const beats = [...beats_of(WIDE, random, { size: SIZE })]

		expect(beats.length).toBeGreaterThan(1)
		expect(shapes_of(beats.map((beat) => beat.text))).toStrictEqual(beats.map(() => FILLED))
	})

	it('rains over every row and column of a terminal larger than the frame', () => {
		const beats = [...beats_of('ab\nc', random, { size: SIZE })]

		expect(shapes_of(beats.map((beat) => beat.text))).toStrictEqual(beats.map(() => FILLED))
	})

	it('shows the frame wrapped at the terminal once the rain has passed, its tail kept', () => {
		expect(passed_rows(WIDE).map((row) => stripVTControlCharacters(row))).toStrictEqual([
			'header    ',
			'0123456789',
			'012345link',
			'end       ',
			' '.repeat(SIZE.columns),
			' '.repeat(SIZE.columns),
		])
	})

	it('starts a wide character landing on a row’s last column on the next row, as the terminal does', () => {
		const [first = '', second = ''] = passed_rows('012345678漢x').map((row) =>
			stripVTControlCharacters(row),
		)

		expect(first).toBe('012345678 ')
		expect(second.startsWith('漢x')).toBe(true)
	})

	it('closes an underline at the end of each row it runs over', () => {
		const [first = '', second = ''] = passed_rows(`0123456${UNDERLINE}789abc${OFF}`)

		expect(first.endsWith(`789${CLOSE}`)).toBe(true)
		expect(second.startsWith(`${UNDERLINE}abc`)).toBe(true)
		expect(second.endsWith(CLOSE)).toBe(true)
	})
})

describe('run_board_reveal_rain.beats_of — how each beat is written', () => {
	it('writes each beat whole at once with no newline, so the bottom row never scrolls', () => {
		const texts = [...beats_of(WIDE, random, { size: SIZE })].map((beat) => beat.text)

		expect(drawn_rows(texts[0] ?? '')).toHaveLength(SIZE.rows)
		expect(texts.some((text) => text.includes('\n'))).toBe(false)
	})

	it('rains no beat on a terminal with no rows', () => {
		expect([...beats_of(WIDE, random, { size: { columns: SIZE.columns, rows: 0 } })]).toStrictEqual(
			[],
		)
	})

	it('rains over the widest line and the frame rows without a terminal size', () => {
		const texts = [...beats_of('ab\nc', random)].map((beat) => beat.text)

		expect(grid_of('ab\nc').map((row) => row.length)).toStrictEqual([2, 2])
		expect(shapes_of(texts)).toStrictEqual(texts.map(() => ({ rows: 2, widths: new Set([2]) })))
	})
})

describe('the terminal size reaching the reveal and the wipe', () => {
	it('reveals the first frame over the terminal the ports size', async () => {
		const { written, ports } = recorded()

		await run_board_intro.rain(WIDE, ports, NO_KEYS, THEME)
		expect(written.length).toBeGreaterThan(2)
		expect(shapes_of(written.slice(0, -1))).toStrictEqual(written.slice(0, -1).map(() => FILLED))
	})

	it('wipes the last frame over the terminal the ports size', async () => {
		const { written, ports } = recorded()

		await run_board_exit_rain.wipe(WIDE, ports, NO_KEYS, THEME)
		expect(written.length).toBeGreaterThan(2)
		expect(shapes_of(written.slice(0, -1))).toStrictEqual(written.slice(0, -1).map(() => FILLED))
	})
})
