import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_bolts } from './run-board-theme-flux-bolts'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the BTTF theme's bolts, born from fixed dice, draw only where they may.

const { bolt_of, draw_bolt, draw_swarm, place_in, stroke_of } = run_board_theme_flux_bolts

function blank_grid(): Grid {
	return Array.from({ length: 10 }, () => Array.from({ length: 20 }, () => [' ', 'body']))
}

function drawn(grid: Grid): number {
	return grid.flat().filter(([ch]) => ch !== ' ').length
}

describe('run_board_theme_flux_bolts', () => {
	it('gives a bolt 2 to 5 cells, the same for the same dice', () => {
		const bolt = bolt_of(7, 2, false, { x: 5, y: 1 })

		expect(bolt).toStrictEqual(bolt_of(7, 2, false, { x: 5, y: 1 }))
		expect(bolt.length).toBeGreaterThanOrEqual(2)
		expect(bolt.length).toBeLessThanOrEqual(5)
		expect(stroke_of(bolt, 0)).toStrictEqual(stroke_of(bolt, 0))
	})

	it('draws a bolt only where it may', () => {
		const free = blank_grid()
		const barred = blank_grid()
		const bolt = { ...bolt_of(7, 2, false, { x: 10, y: 2 }), length: 4 }

		draw_bolt(free, bolt, () => true)
		draw_bolt(barred, bolt, () => false)

		expect(drawn(free)).toBeGreaterThan(0)
		expect(drawn(barred)).toBe(0)
	})
})

describe('run_board_theme_flux_bolts — swarms', () => {
	it('places a swarm’s bolts inside its box', () => {
		const place = place_in({ left: 3, top: 4, w: 5, h: 1 })

		for (let index = 0; index < 20; index++) {
			const at = place(11, index)

			expect(at.y).toBe(4)
			expect(at.x).toBeGreaterThanOrEqual(3)
			expect(at.x).toBeLessThan(8)
		}
	})

	it('draws a swarm born this tick and the tick before', () => {
		const grid = blank_grid()

		draw_swarm(grid, {
			now: 50,
			count: () => 4,
			seed: (born) => born,
			place: place_in({ left: 0, top: 0, w: 20, h: 10 }),
			can_draw: () => true,
		})

		expect(drawn(grid)).toBeGreaterThan(0)
	})
})
