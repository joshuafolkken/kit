import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_face_cells } from './run-board-theme-codec-face-cells'
import { run_board_theme_codec_face_level } from './run-board-theme-codec-face-level'
import { run_board_theme_codec_face_shapes } from './run-board-theme-codec-face-shapes'

// joshuafolkken/kit#8917: one point of a codec portrait — the head over the clothes, the neck and
// the screen.

const { head_level, level_at, skin_level } = run_board_theme_codec_face_level
const { BUST } = run_board_theme_codec_face_cells
const { FACES, NONE } = run_board_theme_codec_face_shapes
const SHUT = { is_open: false, is_blink: false }
const STEPS = [-1, -0.6, -0.2, 0.2, 0.6, 1]

describe('run_board_theme_codec_face_level', () => {
	it.each(['commander', 'operative'] as const)(
		'lights every point of the %s’s view at a level of 0..1 or a little over',
		(name) => {
			const levels = STEPS.flatMap((x) =>
				STEPS.map((y) => level_at(FACES[name], { x, y }, SHUT, BUST)),
			)

			expect(levels.every((level) => level >= 0 && level < 2)).toBe(true)
		},
	)

	it('finds the head at the middle and none far outside it', () => {
		expect(head_level(FACES.commander, 0, 0, SHUT)).toBeGreaterThanOrEqual(0)
		expect(head_level(FACES.commander, 0.99, 0.95, SHUT)).toBe(NONE)
	})

	it('lights the skin on the near cheek above the far one', () => {
		const face = FACES.operative
		const spot = { face, x: -0.3, y: 0.1, ax: 0.3, nx: -0.6 }

		expect(skin_level(spot)).toBeGreaterThan(skin_level({ ...spot, x: 0.3, nx: 0.6 }))
	})
})
