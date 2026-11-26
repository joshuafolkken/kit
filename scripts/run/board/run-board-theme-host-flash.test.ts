import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeState } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the NOTICE's beats — the trace's three bars from the peak, the start's
// three flashes and the peak's two sparks — on the confirmed demo's timing (notice at tick 10).

const { HOST } = run_board_theme_host_fixture
const { notice_trace, peak_flash, start_flash, trace_on } = run_board_theme_host_flash
const { state_of } = run_board_theme_host_state
const PEAK = 89

function notice_at(tick: number): ThemeState {
	return state_of(HOST.layout, HOST.events.n, tick)
}

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

function flashed(grid: Grid): boolean {
	return grid.every((row) => row.every(([, style]) => style === 'X'))
}

describe('run_board_theme_host_flash.trace_on', () => {
	it('lights for twenty ticks three times, forty apart, from the peak', () => {
		const lit = [88, 89, 108, 109, 128, 129, 148, 149, 168, 169, 188, 189].map((tick) =>
			trace_on(notice_at(tick)),
		)

		expect(lit).toStrictEqual([
			false,
			true,
			true,
			false,
			false,
			true,
			true,
			false,
			false,
			true,
			true,
			false,
		])
	})

	it('is off for an event with no notice', () => {
		expect(trace_on(state_of(HOST.layout, HOST.events.p, PEAK))).toBe(false)
	})
})

describe('run_board_theme_host_flash.notice_trace', () => {
	it('lays the bar over the notice text and the cell before it, only while lit', () => {
		const state = notice_at(PEAK)
		const { span, total } = state.notice_text
		const grid = board_copy()
		const unlit = board_copy()

		notice_trace(grid, state, '1;2;3')
		notice_trace(unlit, notice_at(PEAK - 1), '1;2;3')
		const barred = (grid[span.y] ?? []).map(([, style]) => style.includes('48;2;1;2;3'))

		expect(barred.indexOf(true)).toBe(span.x - 1)
		expect(barred.lastIndexOf(true)).toBe(span.x + total)
		expect(unlit).toStrictEqual(HOST.board)
	})
})

function start_at(tick: number): boolean {
	const grid = board_copy()

	start_flash(grid, notice_at(tick), tick, 'X')

	return flashed(grid)
}

function peak_at(tick: number): boolean {
	const grid = board_copy()

	peak_flash(grid, notice_at(tick), 'X')

	return flashed(grid)
}

describe('run_board_theme_host_flash whole-screen flashes', () => {
	it('flashes on every other tick of the notice’s first six', () => {
		expect([9, 10, 11, 12, 14, 16].map((tick) => start_at(tick))).toStrictEqual([
			false,
			true,
			false,
			true,
			true,
			false,
		])
	})

	it('sparks twice from the peak', () => {
		expect(
			[PEAK - 1, PEAK, PEAK + 1, PEAK + 2, PEAK + 4].map((tick) => peak_at(tick)),
		).toStrictEqual([false, true, false, true, false])
	})
})
