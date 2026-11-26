import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_fixture } from './run-board-theme-flux-fixture'
import { run_board_theme_flux_jump } from './run-board-theme-flux-jump'

// joshuafolkken/kit#8917: the BTTF JUMP's flash, fire trails and thaw.

const { burn_trails, draw_jump, flame_of, stepped, thaw, tint_of, wash } = run_board_theme_flux_jump
const { CONTEXT, board_grid, moment_at } = run_board_theme_flux_fixture

describe('run_board_theme_flux_jump', () => {
	it('washes through the tints, then blue-white', () => {
		expect(tint_of(0)).toStrictEqual({ color: { r: 159, g: 216, b: 238 }, share: 0.6 })
		expect(tint_of(9).color).toStrictEqual({ r: 60, g: 160, b: 240 })
		expect(tint_of(10)).toStrictEqual({ color: { r: 200, g: 230, b: 255 }, share: 0.9 })
	})

	it('burns a white-hot head, then flames, then nothing', () => {
		expect(flame_of(-1, 0.5)).toBeUndefined()
		expect(flame_of(0, 0.5)?.[0]).toBe('█')
		expect(flame_of(30, 0)?.[0]).toBe('▂')
		expect(flame_of(58, 0.5)).toBeUndefined()
	})

	it('steps a thaw in quarters', () => {
		expect(stepped(0.3)).toBe(0.25)
		expect(stepped(-1)).toBe(0)
		expect(stepped(2)).toBe(1)
	})

	it('washes, thaws and burns over the board', () => {
		const grid = board_grid()

		wash(CONTEXT, grid, tint_of(0), [0])
		thaw(CONTEXT, grid, { since: 0, rows: [1], x_end: 20 })
		burn_trails(CONTEXT, grid, { t: 0, tick: 0, pace: 13 })

		expect(grid[0]).not.toStrictEqual(board_grid()[0])
		expect(grid[CONTEXT.trail_rows[0] ?? 0]?.[0]?.[0]).toBe('█')
	})

	it('draws nothing with no notice', () => {
		const grid = board_grid()

		draw_jump(CONTEXT, grid, moment_at('i', 100))

		expect(grid).toStrictEqual(board_grid())
	})
})
