import { describe, expect, it } from 'vitest'
import { run_board_layer } from './run-board-layer'

// joshuafolkken/kit#8826: a layer's next change, on the boundary of its interval.

const { boundary_after } = run_board_layer
const STEP_MS = 80

describe('run_board_layer.boundary_after', () => {
	it('is the next multiple of the interval, never now', () => {
		expect(boundary_after(0, STEP_MS)).toBe(STEP_MS)
		expect(boundary_after(STEP_MS - 1, STEP_MS)).toBe(STEP_MS)
		expect(boundary_after(STEP_MS, STEP_MS)).toBe(STEP_MS * 2)
	})
})
