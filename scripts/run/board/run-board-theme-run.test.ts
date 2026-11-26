import { describe, expect, it, vi } from 'vitest'
import { run_board_repaint } from './run-board-repaint'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import { run_board_theme_run } from './run-board-theme-run'
import type { TypingLine } from './run-board-type-rows'

const {
	end_part,
	enter_demo,
	is_drawn,
	is_own_level,
	is_value,
	leave_demo,
	next_tick_ms,
	observe,
	run_of,
	settle,
	take_keys,
	tick_at,
	timeline_at,
} = run_board_theme_run
const { TICKING, ticking_run } = run_board_theme_layer_fixture
const ORIGIN_MS = 3000

function now_line(start_ms: number): TypingLine {
	return { key: 'now:x', index: 0, row: 3, text: 'abc', prefix_columns: 0, start_ms }
}

describe('run_board_theme_run.run_of', () => {
	it('opens with the opening, on no timeline yet', () => {
		const run = run_of('wopr', () => TICKING)

		expect(run.part).toEqual({ name: 'opening', start_ms: undefined })
		expect(run.origin_ms).toBeUndefined()
		expect(is_drawn(run)).toBe(true)
	})

	it('draws nothing for none or a value the registry lacks', () => {
		expect(is_drawn(run_of('', () => TICKING))).toBe(false)
		expect(is_drawn(run_of('magi', () => undefined))).toBe(false)
		expect(is_value('magi')).toBe(true)
		expect(is_value('wargames')).toBe(false)
	})
})

// joshuafolkken/kit#8939: a demo-mode switch asks its redraw of the run's repaint, the one the keys ask.
describe('run_board_theme_run.switched', () => {
	it('asks a redraw of the run repaint on entering and leaving demo mode', () => {
		const run = run_of('wopr', () => TICKING)
		const is_current = run_board_repaint.current_of(run.repaint)

		enter_demo(run)
		expect(is_current?.()).toBe(false)

		const is_left_current = run_board_repaint.current_of(run.repaint)

		leave_demo(run)
		expect(is_left_current?.()).toBe(false)
	})
})

describe('run_board_theme_run ticks', () => {
	it('counts ticks from the first moment it is asked', () => {
		const run = run_of('wopr', () => TICKING)

		expect(tick_at(run, ORIGIN_MS)).toBe(0)
		expect(tick_at(run, ORIGIN_MS + 99)).toBe(1)
		expect(next_tick_ms(run, ORIGIN_MS + 99)).toBe(ORIGIN_MS + 100)
	})
})

describe('run_board_theme_run.observe', () => {
	it('puts the board events on its timeline, demo mode playing its own instead', () => {
		const run = ticking_run(ORIGIN_MS)

		observe(run, [now_line(ORIGIN_MS + 100)], ORIGIN_MS + 100)

		expect(timeline_at(run, 2).progress).toEqual([{ start: 2, text: 'abc' }])
		enter_demo(run)
		expect(timeline_at(run, 2).progress).toEqual([])
	})

	it('shows the real level outside an event, the theme own during one', () => {
		const run = ticking_run(ORIGIN_MS)

		run.level = 3
		observe(run, [now_line(ORIGIN_MS)], ORIGIN_MS)

		expect(is_own_level(run, 1)).toBe(true)
		expect(is_own_level(run, 10)).toBe(false)
	})
})

describe('run_board_theme_run parts and keys', () => {
	it('gives the keys back once the launch opening ends, or cannot play', () => {
		const run = run_of('wopr', () => TICKING)
		const release = vi.fn()

		take_keys(run, () => release, vi.fn())
		settle(run, true)
		expect(release).not.toHaveBeenCalled()
		settle(run, false)

		expect(run.part).toBeUndefined()
		expect(release).toHaveBeenCalledTimes(1)
	})

	it('keeps demo mode keys when its own opening ends', () => {
		const run = ticking_run(ORIGIN_MS)
		const release = vi.fn()

		enter_demo(run)
		take_keys(run, () => release, vi.fn())
		run.part = { name: 'opening', start_ms: ORIGIN_MS }
		end_part(run)

		expect(release).not.toHaveBeenCalled()
		expect(leave_demo(run)).toBeUndefined()
		expect(release).toHaveBeenCalledTimes(1)
	})
})
