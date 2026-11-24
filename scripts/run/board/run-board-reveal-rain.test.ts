import { WriteStream } from 'node:tty'
import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit, type TerminalSize } from './run-board-fit'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_intro, type IntroPorts } from './run-board-intro'
import type { KeyReading } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import type { RainCell } from './run-board-rain'
import { run_board_reveal_rain } from './run-board-reveal-rain'
import { run_board_reveal_rain_fixture } from './run-board-reveal-rain-fixture'
import { run_board_screen } from './run-board-screen'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#8519: the matrix board's first frame revealed behind the code rain — the frame's
// columns keep their characters, colors and widths, the rain's glyphs take one column each, and a key,
// no pauses or no color draw the frame whole at once.

const { CLOSE, beats_of, grid_of, is_colored, row_of } = run_board_reveal_rain
const { drawn_rows, screens } = run_board_reveal_rain_fixture
const { synced } = run_board_screen
const ESC = '\u{1B}'
const GREEN = `${ESC}[32m`
const OFF = `${ESC}[0m`
const SCREEN = `${ESC}[H${ESC}[J`
const BEHIND: RainCell = { kind: 'behind' }
const AHEAD: RainCell = { kind: 'ahead' }
const GLYPH = 'ｱ'
const DROP: RainCell = { kind: 'drop', glyph: GLYPH, paint: run_board_header_trace.SHADES.head }
const DRAWN_DROP = run_board_labels.painted(run_board_header_trace.SHADES.head, GLYPH)
const HALF = 0.5
const RAIN_MS = 45
const THEME = 'matrix'
const FRAME = 'ONE\nTWO  2'
const RAIN = { random: (): number => HALF, is_colored: (): boolean => true }
const NO_KEYS: KeyReading = { folded: undefined }

function first_row(line: string): ReturnType<typeof grid_of>[number] {
	return grid_of(line)[0] ?? []
}

async function instant(): Promise<void> {
	await Promise.resolve()
}

async function never(): Promise<void> {
	await new Promise<void>(() => undefined)
}

function recorded(intro_sleep: (ms: number) => Promise<void>): {
	written: Array<string>
	ports: IntroPorts
} {
	const written: Array<string> = []

	return {
		written,
		ports: {
			write: (text) => {
				written.push(text)
			},
			intro_sleep,
			rain: RAIN,
		},
	}
}

// Keys a test presses once, and whether the rain gave them back.
function skippable(): { keys: KeyReading; press: () => void; released: () => boolean } {
	const held: { taker: (() => void) | undefined; is_released: boolean } = {
		taker: undefined,
		is_released: false,
	}

	return {
		keys: {
			folded: undefined,
			intercept: (on_key) => {
				held.taker = on_key

				return () => {
					held.is_released = true
				}
			},
		},
		press: () => held.taker?.(),
		released: () => held.is_released,
	}
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_reveal_rain.row_of', () => {
	it('rain settles to the original styled frame', () => {
		const columns = first_row(`${SCREEN}${GREEN}AB${OFF} C`)

		expect(
			row_of(
				columns,
				columns.map(() => BEHIND),
			),
		).toBe(`${GREEN}AB${OFF} C${CLOSE}`)
	})

	it('replays the colors a passed column draws in after the rain', () => {
		const columns = first_row(`${GREEN}AB${OFF} C`)

		expect(row_of(columns, [DROP, BEHIND, AHEAD, BEHIND])).toBe(
			`${DRAWN_DROP}${GREEN}B${CLOSE} ${GREEN}${OFF}C${CLOSE}`,
		)
	})

	it('rain preserves wide and combining glyph columns', () => {
		const columns = first_row('漢éx')

		expect(columns).toHaveLength(4)
		expect(
			row_of(
				columns,
				columns.map(() => BEHIND),
			),
		).toBe(`漢éx${CLOSE}`)
		expect(row_of(columns, [BEHIND, DROP, BEHIND, BEHIND])).toBe(` ${DRAWN_DROP}éx${CLOSE}`)
		expect(row_of(columns, [DROP, BEHIND, AHEAD, BEHIND])).toBe(`${DRAWN_DROP}  x${CLOSE}`)
	})
})

describe('run_board_reveal_rain.beats_of', () => {
	it('draws the first frame whole from the top-left, every screen at the frame width', () => {
		const beats = [...beats_of(`${GREEN}漢字${OFF}ab\ncd`, () => HALF)]
		const rows = screens(beats.map((beat) => beat.text))
		const widths = rows.flat().map((line) => run_board_fit.width_of(line))

		expect(beats.length).toBeGreaterThan(1)
		expect(drawn_rows(beats[0]?.text ?? '')).toHaveLength(2)
		expect(rows.every((drawn) => drawn.length === 2)).toBe(true)
		expect(beats.every((beat) => beat.ms === RAIN_MS)).toBe(true)
		expect(new Set(widths)).toStrictEqual(new Set([6]))
	})

	it('falls no rain where stdout draws no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		expect(is_colored()).toBe(false)
	})
})

// A reading that shows each cell as the queue gives it, then the frame behind the rain.
function queued(cells: Array<RainCell>): (cell: RainCell) => RainCell {
	return () => cells.shift() ?? BEHIND
}

// The first beats of a rain over 'abcd' whose cells are read as the queue gives them.
function scripted(cells: Array<RainCell>, count: number): Array<string> {
	const beats = beats_of('abcd', () => HALF, { read: queued(cells) })

	return [...beats].slice(0, count).map((beat) => beat.text)
}

// A reading that shows the frame behind the rain as it is, keeping each cell it read.
function kept(seen: Array<RainCell>): (cell: RainCell) => RainCell {
	return (cell) => {
		seen.push(cell)

		return cell
	}
}

// Each beat's text with the screen the rain's cells it read draw when written whole.
function beats_with_screens(frame: string, size: TerminalSize): Array<[string, Array<string>]> {
	const grid = grid_of(frame, size)
	const seen: Array<RainCell> = []
	const beats = beats_of(frame, () => HALF, { size, read: kept(seen) })

	// `Array.from` maps each beat as the generator makes it, so `seen` holds that beat's cells alone.
	return Array.from(beats, (beat): [string, Array<string>] => {
		const cells = seen.splice(0)
		const rows = grid.map((columns, y) =>
			row_of(columns, cells.slice(y * size.columns, (y + 1) * size.columns)),
		)

		return [beat.text, rows.map((row) => stripVTControlCharacters(row))]
	})
}

describe('run_board_reveal_rain.beats_of — a later beat writes only what changed', () => {
	it('writes only the cells that draw otherwise than in the beat before', () => {
		const behind = [BEHIND, BEHIND, BEHIND, BEHIND]
		const [, dropped, same_again] = scripted([...behind, BEHIND, DROP, BEHIND, BEHIND], 3)

		expect(dropped).toBe(synced(`${ESC}[1;2H${DRAWN_DROP}`))
		expect(same_again).toBe(synced(`${ESC}[1;2Hb${CLOSE}`))
	})

	it('writes no column the rain has passed again', () => {
		const behind = [BEHIND, BEHIND, BEHIND, BEHIND]
		const [, ...later] = scripted([...behind, ...behind, ...behind], 3)

		expect(later).toStrictEqual([synced(''), synced('')])
	})

	// joshuafolkken/kit#8897: reading it per cell stalled the matrix reveal.
	it("reads stdout's color depth once per beat, not once per drop", () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const drawn = run_board_labels.painted(run_board_header_trace.SHADES.head, GLYPH)
		const depth = vi.spyOn(WriteStream.prototype, 'getColorDepth')
		const beats = [...beats_of('abcd', () => HALF, { read: () => DROP })]

		expect(beats[0]?.text).toContain(drawn.repeat(4))
		expect(depth).toHaveBeenCalledTimes(beats.length)
		depth.mockRestore()
	})

	it('leaves on the terminal, after every beat, the screen that beat draws written whole', () => {
		const size = { columns: 6, rows: 3 }
		const beats = beats_with_screens(`${GREEN}漢字${OFF}ab\ncd\n漢x`, size)
		const applied = screens(beats.map(([text]) => text))

		expect(beats.length).toBeGreaterThan(2)
		expect(applied).toStrictEqual(beats.map(([, rows]) => rows))
	})
})

describe('run_board_intro.opening in the matrix theme', () => {
	it('matrix reveals its first frame with rain', async () => {
		const { written, ports } = recorded(instant)
		const opened = run_board_intro.opening(async () => 'read', ports, NO_KEYS, THEME)

		await opened.gather('background')
		const before = written.length

		await opened.reveal?.(`${SCREEN}${FRAME}`)
		const revealed = written.slice(before)

		expect(revealed.length).toBeGreaterThan(2)
		expect(drawn_rows(revealed[0] ?? '')).not.toHaveLength(0)
		expect(revealed.at(-1)).toBe(synced(run_board_theme.restyle(THEME, `${SCREEN}${FRAME}`)))
	})

	it('keeps the block reveal in the wargames theme', async () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const { written, ports } = recorded(instant)
		const opened = run_board_intro.opening(async () => 'read', ports, NO_KEYS, 'wargames')

		await opened.gather('background')
		await opened.reveal?.('a\nb')
		expect(written.slice(-2)).toStrictEqual(['A', '\nB'])
	})
})

describe('run_board_intro.rain', () => {
	it('rain skips immediately to the first frame', async () => {
		const { keys, press, released } = skippable()
		const { written, ports } = recorded(never)
		const pending = run_board_intro.rain(FRAME, ports, keys, THEME)

		press()
		await pending
		expect(written).toHaveLength(2)
		expect(drawn_rows(written[0] ?? '')).not.toHaveLength(0)
		expect(written[1]).toBe(synced(run_board_theme.restyle(THEME, FRAME)))
		expect(released()).toBe(true)
	})

	it('rain bypasses animation without color or timed ports', async () => {
		const drawn = synced(run_board_theme.restyle(THEME, FRAME))
		const untimed = recorded(instant)
		const uncolored = recorded(instant)

		await run_board_intro.rain(FRAME, { write: untimed.ports.write, rain: RAIN }, NO_KEYS, THEME)
		await run_board_intro.rain(
			FRAME,
			{ ...uncolored.ports, rain: { ...RAIN, is_colored: () => false } },
			NO_KEYS,
			THEME,
		)
		expect(untimed.written).toStrictEqual([drawn])
		expect(uncolored.written).toStrictEqual([drawn])
	})
})
