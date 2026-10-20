import { describe, expect, it } from 'vitest'
import type { DefectReport } from './defect-report'
import { defect_report_format } from './defect-report-format'

const EMPTY: DefectReport = {
	by_pr: new Map(),
	by_kind: new Map(),
	by_area: new Map(),
	unknown: 0,
	undeclared: 0,
	added_within_week: new Map(),
}

describe('defect:report output', () => {
	it('prints every grouping, largest first', () => {
		const printed = defect_report_format.format({
			by_pr: new Map([
				[4150, 1],
				[4201, 3],
			]),
			by_kind: new Map([['add', 3]]),
			by_area: new Map([
				['scripts/lane', 1],
				['scripts/run', 3],
			]),
			unknown: 1,
			undeclared: 2,
			added_within_week: new Map([[4201, 1]]),
		})

		expect(printed).toContain('traced to a pull request: 4 · 不明: 1 · no origin line: 2')
		expect(printed).toContain('by pull request:\n  #4201  3\n  #4150  1\n')
		expect(printed).toContain('by area:\n  scripts/run  3\n')
		expect(printed).toMatch(/within 7 days of the merge:\n {2}#4201 {2}1$/u)
	})

	it('prints none for an empty grouping', () => {
		expect(defect_report_format.format(EMPTY)).toContain('by pull request:\n  (none)')
	})
})
