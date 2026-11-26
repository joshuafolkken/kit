import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the BTTF theme mixes, paints and reads back colors as the demo did.

const { chance, is_blank, look_of, mix, noise, paint, recolor, scaled } = run_board_theme_flux_paint
const RED = { r: 255, g: 70, b: 50 }

describe('run_board_theme_flux_paint', () => {
	it('mixes two colors, the share kept to 0..1 and each part rounded', () => {
		expect(mix(RED, { r: 0, g: 0, b: 0 }, 0.5)).toStrictEqual({ r: 128, g: 35, b: 25 })
		expect(mix(RED, { r: 0, g: 0, b: 0 }, 2)).toStrictEqual({ r: 0, g: 0, b: 0 })
		expect(scaled(RED, -1)).toStrictEqual({ r: 0, g: 0, b: 0 })
	})

	it('paints a foreground, and a ground when one is given', () => {
		expect(paint(RED)).toBe('\u{1B}[38;2;255;70;50m')
		expect(paint(RED, RED)).toBe('\u{1B}[38;2;255;70;50m\u{1B}[48;2;255;70;50m')
	})

	it('reads a cell’s look back from a raw style or a role', () => {
		expect(look_of(paint(RED, { r: 1, g: 2, b: 3 }))).toStrictEqual({
			f: RED,
			b: { r: 1, g: 2, b: 3 },
		})
		expect(look_of('red')).toStrictEqual({ f: RED, b: undefined })
		expect(look_of('red:dim').f).toStrictEqual(scaled(RED, 0.55))
		expect(look_of('unknown').f).toStrictEqual({ r: 190, g: 198, b: 206 })
	})
})

describe('run_board_theme_flux_paint — cells and dice', () => {
	it('counts a space blank unless it has a ground', () => {
		expect(is_blank([' ', 'body'])).toBe(true)
		expect(is_blank([' ', paint(RED, RED)])).toBe(false)
		expect(is_blank(['x', 'body'])).toBe(false)
	})

	it('recolors a cell on the grid and leaves a place off it alone', () => {
		const grid: Grid = [[['a', 'red']]]

		recolor(grid, { y: 0, x: 0 }, (look) => ({ f: look.f, b: RED }))
		recolor(grid, { y: 3, x: 0 }, (look) => look)

		expect(grid).toStrictEqual([[['a', paint(RED, RED)]]])
	})

	it('rolls the same dice for the same arguments', () => {
		expect(noise(1, 2, 3)).toBe(noise(1, 2, 3))
		expect(noise(1, 2)).not.toBe(noise(1, 2, 1))
		expect(chance(5, 1, 2)).toBeGreaterThanOrEqual(0)
		expect(chance(5, 1, 2)).toBeLessThan(1)
	})
})
