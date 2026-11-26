import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_clocks } from './run-board-theme-flux-clocks'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'

// joshuafolkken/kit#8917: the BTTF theme's time circuits light, check and roll as the demo's did.

const { char_color, checked_of, clock_chars, draw_circuits, is_dark_at } =
	run_board_theme_flux_clocks
const { CONTEXT, HOST, board_grid, moment_at, row_text, state_at } = run_board_theme_flux_fixture
const { scaled } = run_board_theme_flux_paint
const RED = { r: 255, g: 70, b: 50 }

describe('run_board_theme_flux_clocks', () => {
	it('shows the header’s own times when nothing rolls', () => {
		const chars = clock_chars(CONTEXT, moment_at('i', 30), 0)

		expect(chars.map(({ ch }) => ch).join('')).toBe(CONTEXT.clocks[0]?.text)
		expect(chars.some(({ is_spinning }) => is_spinning)).toBe(false)
	})

	it('rolls the destination to the next estimate after the jump, stopping left to right', () => {
		const rolling = clock_chars(CONTEXT, moment_at('n', 90 + 12), 0)
		const stopped = clock_chars(CONTEXT, moment_at('n', 90 + 40), 0)

		expect(rolling.map(({ is_spinning }) => is_spinning).slice(0, 4)).toStrictEqual([
			true,
			true,
			false,
			true,
		])
		expect(rolling.at(-1)?.is_spinning).toBe(false)
		expect(stopped.map(({ ch }) => ch).join('')).toBe(CONTEXT.circuits.next)
	})
})

describe('run_board_theme_flux_clocks — painting', () => {
	it('paints a spinning digit white and a dark colon dim', () => {
		const white = { r: 255, g: 255, b: 255 }

		expect(char_color({ ch: '1', is_spinning: true }, RED, false)).toStrictEqual(white)
		expect(char_color({ ch: ':', is_spinning: false }, RED, true)).toStrictEqual(scaled(RED, 0.3))
		expect(char_color({ ch: ':', is_spinning: false }, RED, false)).toBe(RED)
		expect(is_dark_at(10)).toBe(true)
	})

	it('checks a circuit on odd ticks of the check’s first six only', () => {
		expect(checked_of(state_at('i', 0), 1)).toBeGreaterThanOrEqual(0)
		expect(checked_of(state_at('i', 0), 2)).toBe(-1)
		expect(checked_of(state_at('i', 0), 7)).toBe(-1)
	})

	it('labels the three circuits on the panel', () => {
		const grid = board_grid()

		draw_circuits(CONTEXT, grid, moment_at('i', 30))

		expect(row_text(grid, HOST.layout.area_top + 1)).toContain('DESTINATION TIME')
		expect(row_text(grid, HOST.layout.area_top + 5)).toContain('LAST TIME DEPARTED')
	})
})
