import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_face_cells } from './run-board-theme-codec-face-cells'

// joshuafolkken/kit#8917: the codec portraits sampled to an image of sub-pixel levels.

const { BUST, RAMP, RAMP_DIM, cached_image, quantized } = run_board_theme_codec_face_cells
const LEVELS = 14
const SHUT = { is_open: false, is_blink: false }
const SUB = { columns: 2, rows: 4 }

function brightness(rgb: string): number {
	return rgb.split(';').reduce((sum, channel) => sum + Number(channel), 0)
}

describe('run_board_theme_codec_face_cells ramps', () => {
	it('runs fifteen greens dark to bright, the dim ramp darker at the top', () => {
		const sums = RAMP.map((rgb) => brightness(rgb))

		expect(RAMP).toHaveLength(LEVELS + 1)
		expect(RAMP_DIM).toHaveLength(LEVELS + 1)
		expect(sums.every((sum, index) => index === 0 || sum >= (sums[index - 1] ?? 0))).toBe(true)
		expect(brightness(RAMP_DIM.at(-1) ?? '')).toBeLessThan(brightness(RAMP.at(-1) ?? ''))
	})

	it('quantizes a level to a ramp step, clamped', () => {
		expect(quantized(-1)).toBe(0)
		expect(quantized(0.5)).toBe(LEVELS / 2)
		expect(quantized(3)).toBe(LEVELS)
	})
})

describe('run_board_theme_codec_face_cells.cached_image', () => {
	it('samples the bust at two sub-pixels a column and four a row', () => {
		const image = cached_image('commander', SHUT, BUST)

		expect(image).toHaveLength(BUST.rows * SUB.rows)
		expect(image.every((row) => row.length === BUST.columns * SUB.columns)).toBe(true)
	})

	it('makes an image once per face, mouth and eyes', () => {
		const first = cached_image('operative', SHUT, BUST)

		expect(cached_image('operative', SHUT, BUST)).toBe(first)
		expect(cached_image('operative', { ...SHUT, is_open: true }, BUST)).not.toBe(first)
		expect(cached_image('commander', SHUT, BUST)).not.toStrictEqual(first)
	})

	it('changes only the mouth’s rows when the mouth opens', () => {
		const shut = cached_image('commander', SHUT, BUST)
		const open = cached_image('commander', { ...SHUT, is_open: true }, BUST)
		const rows = [...shut.keys()].filter((y) => shut[y]?.join(',') !== open[y]?.join(','))

		expect(rows.length).toBeGreaterThan(0)
		expect(Math.min(...rows)).toBeGreaterThan(shut.length / 2)
	})
})
