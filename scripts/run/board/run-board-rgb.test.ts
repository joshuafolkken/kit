import { describe, expect, it } from 'vitest'
import { run_board_rgb } from './run-board-rgb'

// joshuafolkken/kit#8674: a 24-bit color's channels read from a shade, scaled, mixed, written back as a
// shade, and two colors' contrast as WCAG measures it.

const { contrast, mixed, parsed, scaled, shade_of } = run_board_rgb
const WHITE = [255, 255, 255] as const
const BLACK = [0, 0, 0] as const

describe('run_board_rgb channels', () => {
	it('reads a shade into its three channels, a missing one as 0', () => {
		expect(parsed('255;80;60')).toStrictEqual([255, 80, 60])
		expect(parsed('12')).toStrictEqual([12, 0, 0])
	})

	it('scales each channel to a share of it, rounded', () => {
		expect(scaled([255, 80, 60], 0.3)).toStrictEqual([77, 24, 18])
		expect(scaled(WHITE, 0)).toStrictEqual([0, 0, 0])
	})

	it('moves a color a share of the way to another', () => {
		expect(mixed(BLACK, WHITE, 0.5)).toStrictEqual([128, 128, 128])
		expect(mixed([10, 20, 30], [110, 120, 130], 1)).toStrictEqual([110, 120, 130])
	})

	it('writes a color back as a shade with its palette fallback', () => {
		expect(shade_of([1, 2, 3], 'red')).toStrictEqual({ rgb: '1;2;3', named: 'red' })
	})
})

describe('run_board_rgb.contrast', () => {
	it('measures white on black at 21 either way round, and a color on itself at 1', () => {
		expect(contrast(WHITE, BLACK)).toBeCloseTo(21)
		expect(contrast(BLACK, WHITE)).toBeCloseTo(21)
		expect(contrast([50, 235, 90], [50, 235, 90])).toBe(1)
	})
})
