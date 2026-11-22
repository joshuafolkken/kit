import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_lamp_spots, type Lamp } from './run-board-lamp-spots'
import { run_board_lamps } from './run-board-lamps'
import { run_board_spin, type Turning } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import { run_board_theme } from './run-board-theme'
import { run_board_type_rows } from './run-board-type-rows'

const { lamps_in } = run_board_lamp_spots
const { LAMP_TICK_MS, is_lit } = run_board_lamps
const { REDRAW_MS, spin_to_second, spun } = run_board_spin
const { is_typing } = run_board_type_rows
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
		const first = spun(LINES, '⠋', { size: WIDE })
		const later = spun(LINES, '⠙', { size: WIDE })
		const marks = Array.from({ length: 8 }, () => LAMP_MARK).join(' ')

		expect(first.lines[1]).toBe(`  24h  5  ${marks}`)
		expect(later.lines).toStrictEqual(first.lines)
	})
})

describe('run_board_spin.spin_to_second with lamps', () => {
	it('writes every lamp at the second, then only the lamps that changed, past the theme', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, themed, drawn } = lamp_ports(START)

		await spin_to_second(turning_of(spun(LINES, '⠋', { size: WIDE }).lamps), ports)
		const cells = drawn.map((text) => text.match(CELL)?.length ?? 0)

		expect(cells[0]).toBe(16)
		expect(cells.slice(1).every((count) => count < 16)).toBe(true)
		expect(themed.join('')).not.toContain(LAMP_MARK)
		expect(drawn.join('')).not.toContain(BLINK)
	})

	it('blinks nothing before the first frame is out', async () => {
		const { ports, drawn } = lamp_ports(START)
		const unseen = { seen: undefined, lines: [] }

		await spin_to_second(turning_of(spun(LINES, '⠋', { size: WIDE }).lamps, unseen), ports)

		expect(drawn).toStrictEqual([])
	})

	it('keeps the theme’s line cache from filling with the lamps’ steps', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports } = lamp_ports(START)
		const { lamps } = spun(LINES, '⠋', { size: WIDE })
		const live = run_board_theme.themed({ ...ports, theme: undefined }, 'wargames')

		await spin_to_second(turning_of(lamps), live)
		const kept = run_board_theme.kept_lines()

		await spin_to_second(turning_of(lamps), live)

		expect(run_board_theme.kept_lines()).toBe(kept)
	})
})

describe('run_board_spin.spin_to_second with the idle rain', () => {
	it('runs the rain before the first frame is out', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { ports, drawn } = lamp_ports(START)
		const unseen = { seen: undefined, lines: [] }
		const raining = { ...turning_of(spun(LINES, '⠋', { size: WIDE }).lamps, unseen), is_rain: true }

		await spin_to_second(raining, ports)

		expect(drawn[0]?.match(CELL)?.length).toBe(16)
		expect(drawn.join('')).not.toContain(LAMP_MARK)
	})
})

// joshuafolkken/kit#8237: while a row types, every group changes on every step.
const TYPED_LAMPS = spun(LINES, '⠋', { size: WIDE }).lamps

function typing_of(text: string): Turning['typing'] {
	return {
		seen: new Set(),
		lines: [{ key: 'now:x', row: 1, index: 0, prefix_columns: 0, text, start_ms: START }],
	}
}

// The lamp cells written at each moment of the second after the first write, by the moment.
async function cells_by_moment(typing: Turning['typing']): Promise<Map<number, number>> {
	vi.stubEnv('FORCE_COLOR', '3')
	const { ports } = lamp_ports(START)
	const cells = new Map<number, number>()
	const timed = {
		...ports,
		write_drawn: (text: string): void => {
			cells.set(ports.now(), text.match(CELL)?.length ?? 0)
		},
	}

	await spin_to_second(turning_of(TYPED_LAMPS, typing), timed)
	cells.delete(START)

	return cells
}

// The step boundaries after `from_ms` and before the next second.
function steps_after(from_ms: number): Array<number> {
	const first = from_ms - (from_ms % LAMP_TICK_MS) + LAMP_TICK_MS

	return Array.from(
		{ length: Math.ceil((START + REDRAW_MS - first) / LAMP_TICK_MS) },
		(_, index) => first + index * LAMP_TICK_MS,
	)
}

// The lamps that change from the step before `at_ms` to it, each step read with its own burst.
function changed(at_ms: number, is_burst: boolean, was_burst: boolean): number {
	const since_ms = at_ms - LAMP_TICK_MS

	return TYPED_LAMPS.filter(
		(lamp) =>
			is_lit(at_ms, lamp.group, lamp.lamp, is_burst) !==
			is_lit(since_ms, lamp.group, lamp.lamp, was_burst),
	).length
}

describe('run_board_spin.spin_to_second with lamps while a row types', () => {
	it('changes lamps on every step and only on a step while the row types', async () => {
		const cells = await cells_by_moment(typing_of('x'.repeat(100)))
		const steps = steps_after(START)

		expect([...cells.keys()]).toStrictEqual(steps)
		expect(steps.map((at_ms) => cells.get(at_ms))).toStrictEqual(
			steps.map((at_ms) => changed(at_ms, true, true)),
		)
	})

	it('blinks the groups apart again from the step after the row is typed through', async () => {
		const typing = typing_of('xxxxxx')
		const cells = await cells_by_moment(typing)
		const [calm_ms = 0, ...after] = steps_after(START).filter((at_ms) => !is_typing(typing, at_ms))

		expect(after.length).toBeGreaterThan(0)
		expect(cells.get(calm_ms) ?? 0).toBe(changed(calm_ms, false, true))
		expect(after.map((at_ms) => cells.get(at_ms) ?? 0)).toStrictEqual(
			after.map((at_ms) => changed(at_ms, false, false)),
		)
	})
})
