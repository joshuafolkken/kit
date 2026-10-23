import { describe, expect, it } from 'vitest'
import { defect_origin_line } from './defect-origin-line'

const BODY = '## 背景\n\n'
const BUG = '- 種別: 不具合'
const ORIGIN = '- 原因: #4201'

describe('defect origin line', () => {
	it('refuses a bug body that names no origin', () => {
		expect(defect_origin_line.problem(`${BODY}${BUG}\n`)).toBe(defect_origin_line.MISSING_ORIGIN)
	})

	it.each([ORIGIN, '- 原因: 不明（コミットをたどっても特定できない）'])(
		'accepts a bug body declaring %s',
		(origin) => {
			expect(defect_origin_line.problem(`${BODY}${BUG}\n${origin}\n`)).toBeUndefined()
		},
	)

	it.each([
		'- 原因: 不明',
		'- 原因: 不明（ ）',
		'- 原因: #',
		'- 原因: 4201',
		'- 原因: #4201 と #4202',
	])('refuses the malformed origin %s', (origin) => {
		expect(defect_origin_line.problem(`${BODY}${BUG}\n${origin}\n`)).toBe(
			defect_origin_line.MALFORMED_ORIGIN,
		)
	})

	it('asks no origin of a non-bug body', () => {
		expect(defect_origin_line.problem(`${BODY}- 種別: 非不具合\n`)).toBeUndefined()
	})

	it('reads the declared origin', () => {
		expect(defect_origin_line.parse(`${BODY}${BUG}\n${ORIGIN}\n`)).toEqual({ kind: 'pr', pr: 4201 })
		expect(defect_origin_line.parse(`${BODY}${BUG}\n- 原因: 不明（追えない）\n`)).toEqual({
			kind: 'unknown',
			reason: '追えない',
		})
		expect(defect_origin_line.parse(`${BODY}${BUG}\n`)).toBeUndefined()
	})
})
