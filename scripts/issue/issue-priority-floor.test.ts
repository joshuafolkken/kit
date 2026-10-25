import { describe, expect, it } from 'vitest'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#4910: the filing floor stands apart from the high band — now only the bands
// `overrun:mechanisms` judges a mechanism's summed share by. joshuafolkken/kit#4928: an Issue's filing
// reads no share, so a run-time-shortening Issue beside a causing lane is filed at any.

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

	it.each([['1.9%'], ['2.5%'], ['3%']])(
		'files a %s reduction beside a causing lane at normal (joshuafolkken/kit#4928)',
		(percent) => {
			const filed = shortening(percent)

			expect(issue_priority.problem(filed, [])).toBeUndefined()
			expect(issue_priority.with_label(BASE, filed)).toStrictEqual(BASE)
		},
	)

	it('files a defect beside a causing lane with no reduction percentage', () => {
		const defect = `## 背景\n\n- 種別: 不具合\n${LANE_LINE}\n## 期待効果\n\n`

		expect(issue_priority.problem(defect, [])).toBeUndefined()
	})
})
