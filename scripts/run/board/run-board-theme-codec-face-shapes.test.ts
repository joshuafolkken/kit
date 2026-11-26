import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_face_shapes } from './run-board-theme-codec-face-shapes'

// joshuafolkken/kit#8917: the codec theme's two original portraits as formulas over -1..1.

const { FACES, NONE, clamp, half_width, smooth } = run_board_theme_codec_face_shapes
const NAMES = ['commander', 'operative'] as const
// Heights from the brow to the chin, inside every head.
const HEIGHTS = [-0.4, -0.2, 0, 0.2, 0.4]

describe('run_board_theme_codec_face_shapes helpers', () => {
	it('clamps a level to 0..1', () => {
		expect(clamp(-0.5)).toBe(0)
		expect(clamp(0.25)).toBe(0.25)
		expect(clamp(2)).toBe(1)
	})

	it('steps smoothly from 0 at the start to 1 at the end, halfway at the middle', () => {
		expect(smooth(0, 1, -1)).toBe(0)
		expect(smooth(0, 1, 0.5)).toBeCloseTo(0.5)
		expect(smooth(0, 1, 2)).toBe(1)
	})

	it('marks a point no shape reaches with a negative level', () => {
		expect(NONE).toBeLessThan(0)
	})
})

describe('run_board_theme_codec_face_shapes.FACES', () => {
	it.each(NAMES)('gives the %s a head of positive width at every height', (name) => {
		const face = FACES[name]

		expect(HEIGHTS.every((y) => half_width(face, y) > 0)).toBe(true)
		expect(half_width(face, 0)).toBeLessThan(1)
	})

	it.each(NAMES)('lays the %s clothes as levels in 0..1 or none', (name) => {
		const { clothes } = FACES[name]
		const levels = HEIGHTS.flatMap((x) => HEIGHTS.map((y) => clothes(x, y)))

		expect(levels.every((level) => level === NONE || (level >= 0 && level <= 1))).toBe(true)
	})

	it('tells the two faces apart', () => {
		expect(FACES.commander).not.toStrictEqual(FACES.operative)
		expect(FACES.commander.stubble).not.toBe(FACES.operative.stubble)
	})
})
