import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_lamp_spots } from './run-board-lamp-spots'
import { run_board_panel_draw, type PanelDraw, type PanelPainter } from './run-board-panel-draw'
import { run_board_spin, type Turning } from './run-board-spin'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8676: the animation area a theme's painter draws in — placed from the frame's lamps,
// right-aligned to the rule's end, its cells drawn in a character, a color and a background, on every
// `PANEL_TICK_MS` step where the painter ticks.

const {
	AREA_ROWS,
	PANEL_TICK_MS,
	area_of,
	cell_bytes,
	looked,
	panel_bytes,
	tick_after,
	write_panel,
} = run_board_panel_draw
const { LAMP } = run_board_spot
const START = Date.parse('2026-11-22T09:00:00.000Z')
const RULE = `── throughput ${'─'.repeat(40)}`
const PANEL = Array.from({ length: 8 }, () => LAMP).join(' ')
const LINES = [RULE, `  24h  5  ${PANEL}`, `   7d     ${PANEL}`]
const STARTS = [1, 2, 3]
// The rows under the throughput ones down to the lanes rule.
const USAGE = ['', '── usage ──', '  Claude', '  Codex', '  GitHub']
const LANES = '── lanes ──'
const LAMPS = run_board_lamp_spots.lamps_in(LINES, STARTS, 80)
const AT = { ms: START, is_burst: false }
const SHADE = { rgb: '255;70;50', named: 'red' } as const
const BACK = { rgb: '70;255;110', named: 'green' } as const
const SEEN: Turning['typing'] = { seen: new Set(), lines: [] }
// The place of the cell the stepping painter changes on every step.
const STEP_CELL = `\u{1B}[2;${String(RULE.length)}H`

afterEach(() => {
	vi.unstubAllEnvs()
})

// A painter drawing `X` on the area's top row — the throughput rule's — at its last column, and the
// moment's step on the row under it.
function stepping(is_ticking: boolean): PanelPainter {
	return {
		is_idle: true,
		is_ticking,
		cells: (area, at) => [
			{ row: area.top, column: area.end, text: 'X' },
			{ row: area.top + 1, column: area.end, text: String(Math.floor(at.ms / PANEL_TICK_MS) % 10) },
		],
	}
}

function draw_of(painter: PanelPainter): PanelDraw {
	const area = area_of(LINES, STARTS, LAMPS)

	if (area === undefined) throw new Error('the frame has no area')

	return { painter, area }
}

function written(draw: PanelDraw | undefined): { drawn: Array<string>; themed: Array<string> } {
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

	write_panel(draw, ports, AT, undefined)

	return { drawn, themed }
}

describe('run_board_panel_draw.area_of', () => {
	it('places the area on the throughput rule’s row and the seven under it, ended at the rule’s end', () => {
		expect(area_of([...LINES, ...USAGE, '', LANES], STARTS, LAMPS)).toStrictEqual({
			top: 1,
			end: RULE.length,
			rows: AREA_ROWS,
			lamps: LAMPS,
		})
		expect(AREA_ROWS).toBe(8)
	})

	// joshuafolkken/kit#8712: the GitHub row is drawn once the rate limit is read.
	it('ends the area at the usage section’s end, before the GitHub row is drawn or the frame ends', () => {
		const no_github = [...LINES, ...USAGE.slice(0, -1), '', LANES]

		expect(area_of(no_github, STARTS, LAMPS)?.rows).toBe(AREA_ROWS - 1)
		expect(area_of(LINES, STARTS, LAMPS)?.rows).toBe(LINES.length)
	})

	it('places none where the frame draws no lamp — a narrow or colorless terminal', () => {
		expect(area_of(LINES, STARTS, [])).toBeUndefined()
	})

	it('places none where the throughput rows are cut off the screen', () => {
		const cut = run_board_spin.spun(LINES, '⠋', { size: { rows: 1, columns: 80 } })

		expect(cut.area).toBeUndefined()
	})
})

describe('run_board_panel_draw.cell_bytes', () => {
	it('writes a plain cell as its text at its place', () => {
		expect(cell_bytes({ row: 2, column: 9, text: '■' })).toBe('\u{1B}[2;9H■')
	})

	it('draws a cell’s text in its color on its background', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const bytes = cell_bytes({ row: 1, column: 3, text: 'Y', fg: SHADE, bg: BACK })

		expect(bytes).toBe(
			'\u{1B}[1;3H\u{1B}[48;2;70;255;110m\u{1B}[38;2;255;70;50mY\u{1B}[39m\u{1B}[49m',
		)
	})

	it('draws no background below 24-bit color, its text in the named color', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const bytes = cell_bytes({ row: 1, column: 3, text: 'Y', fg: SHADE, bg: BACK })

		expect(bytes).toBe('\u{1B}[1;3H\u{1B}[31mY\u{1B}[39m')
	})

	it.each(['1', '3'])('draws a named background as it is at color level %s', (level) => {
		vi.stubEnv('FORCE_COLOR', level)
		const bytes = cell_bytes({ row: 1, column: 3, text: 'Y', bg: 'bgYellow' })

		expect(bytes).toBe('\u{1B}[1;3H\u{1B}[43mY\u{1B}[49m')
	})
})

describe('run_board_panel_draw.panel_bytes', () => {
	it('writes every cell with no moment before, the throughput rule’s row included', () => {
		const bytes = panel_bytes(draw_of(stepping(true)), AT, undefined)

		expect(bytes).toContain(`\u{1B}[1;${String(RULE.length)}HX`)
		expect(bytes).toContain(`\u{1B}[2;${String(RULE.length)}H`)
	})

	it('writes only the cells that changed since the moment before', () => {
		const later = { ...AT, ms: START + PANEL_TICK_MS }
		const bytes = panel_bytes(draw_of(stepping(true)), later, AT)

		expect(bytes).not.toContain('X')
		expect(bytes).toContain(`\u{1B}[2;${String(RULE.length)}H`)
	})
})

describe('run_board_panel_draw.write_panel', () => {
	it('writes the area past the theme, in one synchronized write', () => {
		const { drawn, themed } = written(draw_of(stepping(true)))

		expect(drawn).toHaveLength(1)
		expect(drawn[0]).toContain('X')
		expect(themed).toStrictEqual([])
	})

	it('writes nothing with no area out — a board in no theme', () => {
		expect(written(undefined)).toStrictEqual({ drawn: [], themed: [] })
	})
})

describe('run_board_panel_draw.tick_after', () => {
	it('wakes on the next 50 ms step for a painter that ticks', () => {
		const ticking = draw_of(stepping(true))

		expect(tick_after(ticking, START + 10)).toBe(START + PANEL_TICK_MS)
		expect(PANEL_TICK_MS).toBe(50)
	})

	it('never wakes for a painter that does not tick, or no area', () => {
		const still = draw_of(stepping(false))

		expect(tick_after(still, START)).toBe(Infinity)
		expect(tick_after(undefined, START)).toBe(Infinity)
	})
})

describe('run_board_spin.spin_to_second with a ticking painter', () => {
	it('draws the area on every 50 ms step up to the second', async () => {
		const clock = { now_ms: START }
		const steps: Array<number> = []
		const ports = {
			now: (): number => clock.now_ms,
			write: (): void => undefined,
			write_drawn: (text: string): void => {
				if (text.includes(STEP_CELL)) steps.push(clock.now_ms - START)
			},
			sleep: async (ms: number): Promise<void> => {
				clock.now_ms += ms
				await Promise.resolve()
			},
		}
		const turning: Turning = {
			spots: [],
			typing: SEEN,
			lamps: LAMPS,
			panel: draw_of(stepping(true)),
		}

		await run_board_spin.spin_to_second(turning, ports)

		expect(steps).toStrictEqual(
			Array.from({ length: 1000 / PANEL_TICK_MS }, (_, index) => index * PANEL_TICK_MS),
		)
	})
})

// joshuafolkken/kit#8677: the painter's cells lit as the jump or the arrival lights the board, before
// they are diffed.

// A painter drawing one 24-bit cell and one in a palette color on the area's top row.
const SHADED: PanelPainter = {
	is_idle: true,
	is_ticking: true,
	cells: (area) => [
		{ row: area.top, column: area.end, text: '●', fg: SHADE },
		{ row: area.top, column: area.end - 1, text: '●', fg: 'red' },
	],
}

describe('run_board_panel_draw.looked', () => {
	it('leaves the painter’s cells as they are outside a jump and an arrival', () => {
		const draw = draw_of(SHADED)

		expect(looked(draw, AT)).toStrictEqual(SHADED.cells(draw.area, AT))
	})

	it('lights only the 24-bit cells as the arrival does, the first beat dark', () => {
		const draw = draw_of(SHADED)
		const [shaded, named] = looked(draw, { ...AT, arrive_ms: AT.ms })

		expect(shaded?.fg).not.toStrictEqual(SHADE)
		expect(named?.fg).toBe('red')
	})
})
