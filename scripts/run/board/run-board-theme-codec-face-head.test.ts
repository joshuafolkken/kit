import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_face_head } from './run-board-theme-codec-face-head'
import { run_board_theme_codec_face_shapes } from './run-board-theme-codec-face-shapes'

// joshuafolkken/kit#8917: the codec portraits' head parts — eyes, mouth, brows and the lit skin.

const { BROW, brow_line, eye_level, mouth_level, within } = run_board_theme_codec_face_head
const { FACES, NONE } = run_board_theme_codec_face_shapes
const SHUT = { is_open: false, is_blink: false }
const FACE = FACES.commander
// A point inside the near eye, and one inside the open mouth.
const EYE = { ax: 0.24, y: -0.075 }
const MOUTH = { ax: 0, y: 0.4 }

describe('run_board_theme_codec_face_head parts', () => {
	it('takes a value strictly between its bounds as within', () => {
		expect(within(0.5, 0, 1)).toBe(true)
		expect(within(0, 0, 1)).toBe(false)
		expect(within(1, 0, 1)).toBe(false)
	})

	it('slopes the brow from its inner end', () => {
		expect(brow_line(BROW.from)).toBe(BROW.y)
		expect(brow_line(BROW.from + BROW.run)).toBeCloseTo(BROW.y - BROW.slope)
	})

	it('draws an open eye, and only its lid’s line in a blink', () => {
		const open = eye_level(FACE, EYE.ax, EYE.y, SHUT)
		const blink = eye_level(FACE, EYE.ax, EYE.y, { ...SHUT, is_blink: true })

		expect(open).toBeGreaterThanOrEqual(0)
		expect(blink).toBe(NONE)
		expect(eye_level(FACE, 1, EYE.y, SHUT)).toBe(NONE)
	})

	it('opens the mouth dark only while it is open', () => {
		const shut = mouth_level(MOUTH.ax, MOUTH.y, SHUT)
		const open = mouth_level(MOUTH.ax, MOUTH.y, { ...SHUT, is_open: true })

		expect(open).toBeGreaterThanOrEqual(0)
		expect(open).not.toBe(shut)
	})
})
