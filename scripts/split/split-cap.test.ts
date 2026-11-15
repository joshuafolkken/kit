import { describe, expect, it } from 'vitest'
import { split_cap } from './split-cap'

const { FILE_CAP, LINE_CAP } = split_cap

describe('split_cap.is_over', () => {
	it('keeps the default cap itself as one Issue', () => {
		expect(split_cap.is_over(FILE_CAP, LINE_CAP)).toBe(false)
	})

	it('answers over past the default cap on either axis', () => {
		expect(split_cap.is_over(FILE_CAP + 1, 0)).toBe(true)
		expect(split_cap.is_over(0, LINE_CAP + 1)).toBe(true)
	})

	it('compares with the cap it is given', () => {
		const cap = { files: FILE_CAP * 2, lines: LINE_CAP * 2 }

		expect(split_cap.is_over(FILE_CAP + 1, LINE_CAP + 1, cap)).toBe(false)
	})

	it('derives the default cap from the guide times the cap factor', () => {
		expect(split_cap.DEFAULT_CAP).toStrictEqual({
			files: split_cap.FILE_GUIDE * split_cap.CAP_FACTOR,
			lines: split_cap.LINE_GUIDE * split_cap.CAP_FACTOR,
		})
	})
})
