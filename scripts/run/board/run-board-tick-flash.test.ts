import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_change_flash } from './run-board-change-flash'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import type { BoardState } from './run-board-state'
import { run_board_theme } from './run-board-theme'
import { run_board_tick } from './run-board-tick'
import type { DrawPorts } from './run-board-tick-draw'
import { run_board_tick_flash } from './run-board-tick-flash'

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const CPU_PERCENT = 42
const DISABLED: Array<[string, Partial<DrawPorts>]> = [
	['once', { opened_ms: undefined }],
	['chat', { form: 'chat', opened_ms: undefined }],
	['every', { is_tty: false, opened_ms: undefined }],
	['noTTY', { is_tty: false }],
	['wargames', { theme: 'wargames' }],
	['default', { theme: undefined }],
	['noColor', {}],
]

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
}

function flash_over(state: BoardState, overrides: Partial<DrawPorts> = {}): BoardState {
	const { ports } = harness(LOCAL, [])
	const live = { ...ports, theme: 'matrix' as const, is_tty: true, opened_ms: START, ...overrides }
	const themed = run_board_theme.themed(live, live.theme)

	return drawn_from(state, LOCAL, { ports: themed, now_ms: START }, layout_for(state, LOCAL, START))
}

function changed_gauge(state: BoardState): BoardState {
	return {
		...state,
		gauges: {
			cpu_percent: CPU_PERCENT,
			memory_percent: 1,
			swap_mb_per_s: 0,
			memory_pressure: undefined,
		},
	}
}

function row(number: number, title = 'a'): BoardRow {
	return { number, title, state: 'running', kind: undefined, status: undefined, waits: [] }
}

function flash_rows(state: BoardState, rows: Array<BoardRow>): BoardState {
	const { ports } = harness(LOCAL, [])
	const live = run_board_theme.themed({ ...ports, types_rows: false, opened_ms: START }, 'matrix')
	const layout = { ...layout_for(state, LOCAL, START), active: rows }

	return drawn_from(state, LOCAL, { ports: live, now_ms: START }, layout)
}

afterEach(() => vi.unstubAllEnvs())

describe('run_board_tick_flash.flash_of through a matrix redraw', () => {
	it('ac-713cb5e6 keys matrix rows without typing and flashes only a changed issue value', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		vi.stubEnv('NO_COLOR', undefined)
		const base = flash_rows(planned(), [row(1), row(2)])
		const moved = flash_rows(base, [row(2), row(1)])
		const changed = flash_rows(moved, [row(2), row(1, 'b')])

		expect(moved.flash?.cells).toStrictEqual([])
		expect(changed.flash?.cells.length).toBeGreaterThan(0)
		expect(changed.flash?.cells.every((cell) => cell.key === 'lanes:1')).toBe(true)
		expect(changed.typing.lines).toStrictEqual([])
	})

	it('ac-5a732c47 flashes live matrix gauge changes only', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		vi.stubEnv('NO_COLOR', undefined)
		const base = flash_over(planned())
		const write = vi.fn()
		const changed = flash_over(changed_gauge(base), { write })

		expect(base.flash?.cells).toStrictEqual([])
		expect(changed.flash?.cells.length).toBeGreaterThan(0)
		expect(write).toHaveBeenCalledTimes(2)
		expect(write.mock.calls[1]?.[0]).toContain(run_board_change_flash.HEAD)
	})

	it('ac-f47d6b16 writes no overlay for an identical redraw', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		vi.stubEnv('NO_COLOR', undefined)
		const base = flash_over(planned())
		const write = vi.fn()
		const drawn = flash_over(base, { write })

		expect(drawn.flash?.cells).toStrictEqual([])
		expect(write).toHaveBeenCalledTimes(1)
	})
})

describe('run_board_tick_flash.flash_of over a lamp', () => {
	it('never flashes a lamp’s cell, which the lamps write themselves', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		vi.stubEnv('NO_COLOR', undefined)
		const { ports } = harness(LOCAL, [])
		const redraw = {
			ports: { ...ports, theme: 'matrix' as const, is_tty: true, opened_ms: START },
			now_ms: START,
		}
		const lamp = { row: 1, column: 2, panel_row: 0, group: 0, lamp: 0 }
		const drawn = { lines: ['12'], keyed: [], spots: [], lamps: [lamp] }
		const base = run_board_tick_flash.flash_of(undefined, drawn, redraw, FRESH_STATE.typing)
		const changed = { ...drawn, lines: ['34'] }
		const flash = run_board_tick_flash.flash_of(base, changed, redraw, FRESH_STATE.typing)

		expect(flash?.cells.map((cell) => cell.column)).toStrictEqual([1])
	})
})

describe('run_board_tick_flash.flash_of disabled', () => {
	it.each(DISABLED)('ac-5a732c47 disables flash in %s', (mode, overrides) => {
		vi.stubEnv('FORCE_COLOR', mode === 'noColor' ? '0' : '3')
		vi.stubEnv('NO_COLOR', mode === 'noColor' ? '1' : undefined)
		const base = flash_over(planned(), overrides)
		const write = vi.fn()
		const drawn = flash_over(changed_gauge(base), { ...overrides, write })

		expect(drawn.flash).toBeUndefined()
		expect(write).toHaveBeenCalledTimes(1)
		expect(write.mock.calls[0]?.[0]).not.toContain(run_board_change_flash.HEAD)
	})
})
