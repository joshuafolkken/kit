import { describe, expect, it } from 'vitest'
import { run_board_header_trace } from './run-board-header-trace'
import type { Paint } from './run-board-labels'
import { run_board_rain_gradient } from './run-board-rain-gradient'

const { is_flicker, paint_at } = run_board_rain_gradient
const { SHADES } = run_board_header_trace

// The approved demo's scene 4 `GLINT` (joshuafolkken/kit#8742).
const DEMO_HEAD = ['225;255;225', '124;255;153', '45;255;97']
const SEVEN = 7
const LONG = 43

function rgb_of(paint: Paint | undefined): unknown {
	return typeof paint === 'object' && 'rgb' in paint ? paint.rgb : paint
}

describe('run_board_rain_gradient head', () => {
	it.each([0, 1, 2])('paints head cell %i the demo’s white-to-green', (distance) => {
		expect(rgb_of(paint_at(distance, SEVEN))).toBe(DEMO_HEAD[distance])
		expect(rgb_of(paint_at(distance, LONG, true))).toBe(DEMO_HEAD[distance])
	})

	it('flickers the two lead cells only', () => {
		expect([-1, 0, 1, 2, 3].map((distance) => is_flicker(distance))).toEqual([
			false,
			true,
			true,
			false,
			false,
		])
	})
})

describe('run_board_rain_gradient tail', () => {
	it('eases the tail from bright green at its first cell to an ember at its last', () => {
		expect([3, 5, 7].map((distance) => rgb_of(paint_at(distance, SEVEN)))).toEqual([
			'0;255;65',
			'0;89;22',
			'0;22;5',
		])
	})

	it('paints a color a cell over a long tail, dimming every step', () => {
		const greens = Array.from({ length: LONG - 2 }, (_cell, index) => {
			const rgb = String(rgb_of(paint_at(index + 3, LONG)))

			return Number(rgb.split(';', 2)[1])
		})

		expect(new Set(greens).size).toBeGreaterThan(SEVEN)
		expect(greens).toEqual(greens.toSorted((left, right) => right - left))
	})

	it('paints nothing below the head or past the tail', () => {
		expect(paint_at(-1, SEVEN)).toBeUndefined()
		expect(paint_at(SEVEN + 1, SEVEN)).toBeUndefined()
	})
})

describe('run_board_rain_gradient glint', () => {
	it('flares a rerolled tail cell ×1.7 for its frame, each channel capped at 255', () => {
		expect(rgb_of(paint_at(5, SEVEN, true))).toBe('0;151;37')
		const flared = String(rgb_of(paint_at(3, SEVEN, true)))

		expect(flared.split(';').slice(0, 2)).toEqual(['0', '255'])
		expect(rgb_of(paint_at(5, SEVEN, false))).toBe('0;89;22')
	})
})

describe('run_board_rain_gradient named', () => {
	it('falls back to the trace’s named green for every computed color', () => {
		const paints = Array.from({ length: LONG + 1 }, (_cell, distance) => [
			paint_at(distance, LONG),
			paint_at(distance, LONG, true),
		]).flat()

		expect(paints.every((paint) => typeof paint === 'object' && 'named' in paint)).toBe(true)
		expect(paints).toContainEqual(expect.objectContaining({ named: SHADES.head.named }))
		expect(paints).toContainEqual(expect.objectContaining({ named: SHADES.bright.named }))
	})
})
