import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_lamp_spots, type Lamp } from './run-board-lamp-spots'
import { run_board_spin, type Turning } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import { run_board_theme } from './run-board-theme'

const { lamps_in } = run_board_lamp_spots
const { spin_to_second, spun } = run_board_spin
const { LAMP, LAMP_MARK } = run_board_spot
const START = Date.parse('2026-11-20T09:00:00.000Z')
const WIDE = { rows: 24, columns: 80 }
const BLINK = '\u{1B}[5m'
// eslint-disable-next-line no-control-regex -- a lamp's cell is written with control characters
const CELL = /\u{1B}\[\d+;\d+H/gu
const PANEL = Array.from({ length: 8 }, () => LAMP).join(' ')
const LINES = ['header', `  24h  5  ${PANEL}`, `   7d     ${PANEL}`]
const SEEN: Turning['typing'] = { seen: new Set(), lines: [] }

interface LampPorts {
	ports: {
		now: () => number
		write: (text: string) => void
		write_drawn: (text: string) => void
		sleep: (ms: number) => Promise<void>
	}
	themed: Array<string>
	drawn: Array<string>
}

afterEach(() => {
	vi.unstubAllEnvs()
})

function lamp_ports(now_ms: number): LampPorts {
	const clock = { now_ms }
	const themed: Array<string> = []
	const drawn: Array<string> = []
	const ports = {
		now: (): number => clock.now_ms,
		write: (text: string): void => {
			themed.push(text)
		},
		write_drawn: (text: string): void => {
			drawn.push(text)
		},
		sleep: async (ms: number): Promise<void> => {
			clock.now_ms += ms
			await Promise.resolve()
		},
	}

	return { ports, themed, drawn }
}

function turning_of(lamps: ReadonlyArray<Lamp>, typing = SEEN): Turning {
	return { spots: [], typing, lamps }
}

describe('run_board_lamp_spots.lamps_in', () => {
	it('records each lamp’s cell, its panel row and its group of four', () => {
		const lamps = lamps_in(LINES, [1, 2, 3], WIDE.columns)

		expect(lamps).toHaveLength(16)
		expect(lamps[0]).toMatchObject({ row: 2, column: 11, panel_row: 0, group: 0, lamp: 0 })
		expect(lamps[5]).toMatchObject({ row: 2, column: 21, group: 1, lamp: 1 })
		expect(lamps[8]).toMatchObject({ row: 3, column: 11, panel_row: 1, lamp: 0 })
	})

	it('draws each lamp out as `■`, the frame’s lines the same at every moment', () => {
		const first = spun(LINES, '⠋', WIDE)
		const later = spun(LINES, '⠙', WIDE)
		const marks = Array.from({ length: 8 }, () => LAMP_MARK).join(' ')

		expect(first.lines[1]).toBe(`  24h  5  ${marks}`)
		expect(later.lines).toStrictEqual(first.lines)
	})
})

describe('run_board_spin.spin_to_second with lamps', () => {
	it('writes every lamp at the second, then only the lamps that changed, past the theme', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, themed, drawn } = lamp_ports(START)

		await spin_to_second(turning_of(spun(LINES, '⠋', WIDE).lamps), ports)
		const cells = drawn.map((text) => text.match(CELL)?.length ?? 0)

		expect(cells[0]).toBe(16)
		expect(cells.slice(1).every((count) => count < 16)).toBe(true)
		expect(themed.join('')).not.toContain(LAMP_MARK)
		expect(drawn.join('')).not.toContain(BLINK)
	})

	it('blinks nothing before the first frame is out', async () => {
		const { ports, drawn } = lamp_ports(START)
		const unseen = { seen: undefined, lines: [] }

		await spin_to_second(turning_of(spun(LINES, '⠋', WIDE).lamps, unseen), ports)

		expect(drawn).toStrictEqual([])
	})

	it('keeps the theme’s line cache from filling with the lamps’ steps', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports } = lamp_ports(START)
		const { lamps } = spun(LINES, '⠋', WIDE)
		const live = run_board_theme.themed({ ...ports, is_themed: undefined }, 'wargames')

		await spin_to_second(turning_of(lamps), live)
		const kept = run_board_theme.kept_lines()

		await spin_to_second(turning_of(lamps), live)

		expect(run_board_theme.kept_lines()).toBe(kept)
	})
})
