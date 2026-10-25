import { describe, expect, it } from 'vitest'
import { PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4910: the filing floor a run-time-shortening Issue with a causing lane must reach
// stands apart from the high band, and a defect is filed with no floor at all.

const BASE = ['enhancement']
const LANE_LINE = '- 原因のレーン: 48 分（#4695）\n'

function shortening(percent: string): string {
	return `## 背景\n\n- 種別: 非不具合\n- 目的: 時間短縮\n${LANE_LINE}\n## 期待効果\n\n- 1 マージあたりの短縮: 1 分（レーン中央値 40 分 の ${percent}）\n`
}

describe('issue_priority filing floor (joshuafolkken/kit#4910)', () => {
	it('sits under the high band', () => {
		expect(issue_priority.FILING_FLOOR_PERCENT).toBe(2)
		expect(issue_priority.FILING_FLOOR_PERCENT).toBeLessThan(issue_priority.HIGH_PERCENT)
	})

	it('refuses a reduction under the floor', () => {
		expect(issue_priority.problem(shortening('1.9%'), [])).toContain('under 2%')
	})

	it('files a reduction between the floor and the high band at normal', () => {
		const filed = shortening('2.5%')

		expect(issue_priority.problem(filed, [])).toBeUndefined()
		expect(issue_priority.floor_of(filed)).toBe('normal')
		expect(issue_priority.with_label(BASE, filed)).toStrictEqual(BASE)
	})

	it('files a 3% reduction at high as before', () => {
		expect(issue_priority.with_label(BASE, shortening('3%'))).toStrictEqual([
			...BASE,
			PRIORITY_HIGH_LABEL,
		])
	})

	it('files a defect beside a causing lane with no reduction percentage', () => {
		const defect = `## 背景\n\n- 種別: 不具合\n${LANE_LINE}\n## 期待効果\n\n`

		expect(issue_priority.problem(defect, [])).toBeUndefined()
	})
})
