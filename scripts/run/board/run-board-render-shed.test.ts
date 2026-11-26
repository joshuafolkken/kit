import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_render_shed } from './run-board-render-shed'

// joshuafolkken/kit#8990: a lane row past the pane gives up its tail's cells in order until it fits.

const { SHED_ORDER, is_shed, shed_fitted } = run_board_render_shed
const { width_of } = run_board_fit
const COLUMNS = 20
const FULL = '#1 PR 1 ✓3 🐰 ⏳ 🎯 18:46 +35′'
// The row's line as it draws after giving up `shed` cells, one word shorter each time.
const DRAWS = ['#1 PR 1 ✓3 🐰 ⏳ 🎯 18:46', '#1 PR 1 ✓3 🐰 ⏳', '#1 PR 1 ✓3', '#1 PR 1']
const FITTING_SHED = 2

function draw(shed: number): string {
	return DRAWS[shed - 1] ?? ''
}

function wide_draw(shed: number): string {
	return `\u{1B}[2m${'x'.repeat(COLUMNS + shed)}\u{1B}[0m`
}

describe('run_board_render_shed.is_shed', () => {
	it('gives up the cells in order: drift, finish, review, counts', () => {
		expect(SHED_ORDER).toStrictEqual(['drift', 'finish', 'review', 'counts'])
		expect(is_shed('drift', 1)).toBe(true)
		expect(is_shed('finish', 1)).toBe(false)
		expect(is_shed('counts', SHED_ORDER.length)).toBe(true)
	})

	it('gives up nothing at shed 0', () => {
		expect(SHED_ORDER.some((cell) => is_shed(cell, 0))).toBe(false)
	})
})

describe('run_board_render_shed.shed_fitted', () => {
	it('keeps a line that fits the pane', () => {
		expect(shed_fitted('#1 PR 1', COLUMNS, draw)).toBe('#1 PR 1')
	})

	it('keeps a line when the pane has no known width', () => {
		expect(shed_fitted(FULL, undefined, draw)).toBe(FULL)
	})

	it('draws the first shed level that fits', () => {
		const line = shed_fitted(FULL, COLUMNS, draw)

		expect(line).toBe(draw(FITTING_SHED))
		expect(width_of(line)).toBeLessThanOrEqual(COLUMNS)
	})

	it('cuts the plain last draw on an ellipsis when no shed level fits', () => {
		const line = shed_fitted(wide_draw(1), COLUMNS, wide_draw)

		expect(line.endsWith('…')).toBe(true)
		expect(line).not.toContain('\u{1B}')
		expect(width_of(line)).toBeLessThanOrEqual(COLUMNS)
	})
})
