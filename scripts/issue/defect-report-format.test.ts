import { describe, expect, it } from 'vitest'
import type { DefectReport } from './defect-report'
import { defect_report_format, type Period } from './defect-report-format'

const EMPTY: DefectReport = {
	by_pr: new Map(),
	by_kind: new Map(),
	by_area: new Map(),
	unknown: 0,
	undeclared: 0,
	added_within_week: new Map(),
}
const RUN_AREA = 'scripts/run'
const LANE_AREA = 'scripts/lane'
const PERIOD: Period = {
	days: 7,
	rates: [
		{ area: RUN_AREA, merges: 10, defects: 3, rate: 0.3 },
		{ area: LANE_AREA, merges: 4, defects: 0, rate: 0 },
	],
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
				[LANE_AREA, 1],
				[RUN_AREA, 3],
			]),
			unknown: 1,
			undeclared: 2,
			added_within_week: new Map([[4201, 1]]),
		})

		expect(printed).toContain(
			'traced to a pull request: 4 (57%) · 不明: 1 (14%) · no origin line: 2 (29%)',
		)
		expect(printed).toContain('by pull request:\n  #4201  3\n  #4150  1\n')
		expect(printed).toContain('by area:\n  scripts/run  3\n')
		expect(printed).toMatch(/within 7 days of the merge:\n {2}#4201 {2}1$/u)
		expect(printed).not.toContain('defect rate by area')
	})

	it('prints none for an empty grouping', () => {
		expect(defect_report_format.format(EMPTY)).toContain('by pull request:\n  (none)')
		expect(defect_report_format.format(EMPTY)).toContain('traced to a pull request: 0 (0%)')
	})

	it('adds the per-area rate section for a period', () => {
		const printed = defect_report_format.format(EMPTY, PERIOD)

		expect(printed).toMatch(
			/defect rate by area — defects \/ merges in the last 7 days:\n {2}scripts\/run {2}3 \/ 10 {2}30%\n {2}scripts\/lane {2}0 \/ 4 {2}0%$/u,
		)
	})
})

describe('defect:report rate section', () => {
	it('prints none when no area was merged in the period', () => {
		expect(defect_report_format.format(EMPTY, { days: 7, rates: [] })).toMatch(
			/merges in the last 7 days:\n {2}\(none\)$/u,
		)
	})
})

describe('defect:report retrospective digest', () => {
	it('prints the coverage and the areas with defects', () => {
		const lines = defect_report_format.digest({ ...EMPTY, unknown: 1 }, PERIOD)

		expect(lines).toEqual([
			'Defects (last 7 days): defects by origin — traced to a pull request: 0 (0%) · 不明: 1 (100%) · no origin line: 0 (0%)',
			'  scripts/run  3 / 10  30%',
		])
	})

	it('prints none when no area drew a defect', () => {
		expect(defect_report_format.digest(EMPTY, { days: 7, rates: [] })[1]).toBe('  (none)')
	})
})
