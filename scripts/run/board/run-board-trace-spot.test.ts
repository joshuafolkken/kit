import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_spin } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import { run_board_tick } from './run-board-tick'
import { run_board_trace_spot } from './run-board-trace-spot'
import { run_board_type_rows } from './run-board-type-rows'

const { field_of, boundary_after } = run_board_header_trace
const { traces_in, write_traces } = run_board_trace_spot
const CSI = '\u{1B}['
const RED = `${CSI}38;2;255;69;58m`
const DARK = `${CSI}38;2;0;55;12m`
const WORST = 1
const CALM = 5
const WIDE = { rows: 24, columns: 80 }
const SPOT = { row: 1, column: 1, style: '' }
const ALERT_TEXT = 'TRACE ■■■■■'

afterEach(() => vi.unstubAllEnvs())

describe('run_board_trace_spot', () => {
	it.each([
		[0, RED],
		[349, RED],
		[350, DARK],
		[559, DARK],
		[560, RED],
	])('recolors the whole worst field at %i ms', (at_ms, color) => {
		vi.stubEnv('FORCE_COLOR', '3')
		const write_drawn = vi.fn()
		const write = vi.fn()

		write_traces([SPOT], { write, write_drawn }, at_ms, undefined)

		expect(write_drawn).toHaveBeenCalledExactlyOnceWith(
			`${CSI}?2026h${CSI}1;1H${color}TRACE ■■■■■${CSI}39m${CSI}?2026l`,
		)
		expect(write).not.toHaveBeenCalled()
	})
})

describe('run_board_trace_spot positions and fallback', () => {
	it.each([
		[349, 0],
		[559, 350],
		[560, 0],
	])('skips an unchanged color at %i since %i', (at_ms, since) => {
		const write = vi.fn()

		write_traces([SPOT], { write }, at_ms, since)

		expect(write).not.toHaveBeenCalled()
	})

	it('finds only worst fields and records their fitted screen position', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const lines = ['123456', `ab${field_of(WORST)}`, field_of(CALM)]

		expect(traces_in(lines, [1, 3, 6], 5)).toStrictEqual([{ row: 3, column: 3, style: '' }])
		expect(traces_in([field_of(CALM)], [1], 80)).toStrictEqual([])
		const write = vi.fn()

		write_traces([], { write }, 350, undefined)
		expect(write).not.toHaveBeenCalled()
	})

	it.each([
		[0, '31'],
		[350, '32'],
	])('falls back to named colors at %i ms', (at_ms, color) => {
		vi.stubEnv('FORCE_COLOR', '1')
		const write = vi.fn()

		write_traces([SPOT], { write }, at_ms, undefined)

		expect(write).toHaveBeenCalledWith(expect.stringContaining(`${CSI}${color}mTRACE ■■■■■`))
	})
})

describe('run_board_trace_spot boundaries', () => {
	it.each([
		[0, 350],
		[349, 350],
		[350, 560],
		[559, 560],
		[560, 910],
	])('wakes on the next color boundary after %i', (at_ms, next_ms) => {
		expect(boundary_after(at_ms)).toBe(next_ms)
	})
})

describe('run_board_spin TRACE integration', () => {
	it('restores the initial, retains visible spots and drops clipped ones', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const frame = run_board_spin.spun([field_of(WORST), field_of(WORST)], '', {
			rows: 1,
			columns: 80,
		})

		expect(frame.lines).toStrictEqual([ALERT_TEXT, ALERT_TEXT])
		expect(frame.traces).toStrictEqual([SPOT])
		expect(frame.lines.join('')).not.toContain(run_board_spot.TRACE)
	})

	it('blinks a matrix frame without typed rows exactly on color boundaries', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const clock = { ms: 0 }
		const writes: Array<{ ms: number; text: string }> = []
		const frame = run_board_spin.spun([field_of(WORST)], '', WIDE)
		const ports = {
			now: () => clock.ms,
			sleep: async (ms: number) => {
				clock.ms += ms
			},
			write: (text: string) => {
				if (text.includes('TRACE')) writes.push({ ms: clock.ms, text })
			},
		}

		await run_board_spin.spin_to_second({ ...frame, typing: run_board_type_rows.NO_TYPING }, ports)

		expect(writes.map(({ ms }) => ms)).toStrictEqual([0, 350, 560, 910])
		expect(writes.map(({ text }) => text.includes(RED))).toStrictEqual([true, false, true, false])
	})
})

describe('run_board_tick_draw TRACE integration', () => {
	it.each([
		['matrix', true, 1],
		['matrix', false, 0],
		[undefined, true, 0],
	] as const)('carries the rendered field for theme %s and alert %s', (theme, is_alert, count) => {
		vi.stubEnv('FORCE_COLOR', '0')
		const { LOCAL, START, drawn_from, harness } = run_board_fixture
		const { ports, frames } = harness(LOCAL, [])
		const state = { ...run_board_tick.FRESH_STATE, read_failed_ms: is_alert ? START : undefined }
		const layout = run_board_tick.layout_for(state, LOCAL, START)
		const redraw = { ports: { ...ports, theme }, now_ms: START }
		const drawn = drawn_from(state, LOCAL, redraw, layout)

		expect(drawn.traces).toHaveLength(count)
		expect(frames.join('').includes(ALERT_TEXT)).toBe(count > 0)
		expect(frames.join('')).not.toContain(run_board_spot.TRACE)
	})
})
