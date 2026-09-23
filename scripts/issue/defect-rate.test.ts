import { describe, expect, it } from 'vitest'
import { defect_rate, type DefectRate, type RateIssue } from './defect-rate'

const DEFECT_BODY = '## 背景\n\n- 種別: 不具合\n\nbroken'
const BEHAVIOR_BODY = '## 背景\n\n- 種別: 振る舞い変更\n\nnew rule'
const CODE_ONLY_BODY = '## 背景\n\n- 種別: コードのみ\n'
const NOW_MS = Date.parse('2026-09-23T14:00:00Z')
const DAYS = 14
const SINCE = '2026-09-09'
const LOWER_BOUNDS = 'lower bounds'

function issue(body: string, labels: ReadonlyArray<string> = []): RateIssue {
	return { body, labels }
}

function result(defects: number, behavior_changes: number, is_capped = false): DefectRate {
	return { days: DAYS, since: SINCE, defects, behavior_changes, is_capped }
}

describe('defect_rate.window_start', () => {
	it('returns the first day of the window as YYYY-MM-DD', () => {
		expect(defect_rate.window_start(NOW_MS, DAYS)).toBe(SINCE)
	})
})

describe('defect_rate queries', () => {
	it('searches issues filed since the window start', () => {
		expect(defect_rate.filed_query('o/r', SINCE)).toBe('repo:o/r is:issue created:>=2026-09-09')
	})

	it('searches issues closed as completed since the window start', () => {
		expect(defect_rate.completed_query('o/r', SINCE)).toBe(
			'repo:o/r is:issue is:closed reason:completed closed:>=2026-09-09',
		)
	})
})

describe('defect_rate.is_defect', () => {
	it('counts a body declaring a defect', () => {
		expect(defect_rate.is_defect(issue(DEFECT_BODY))).toBe(true)
	})

	it('counts a route:interrupt label whatever the casing', () => {
		expect(defect_rate.is_defect(issue(BEHAVIOR_BODY, ['Route:Interrupt']))).toBe(true)
	})

	it('does not count a declaration mentioned inside a sentence', () => {
		expect(defect_rate.is_defect(issue('see `- 種別: 不具合` in the template'))).toBe(false)
	})

	it('does not count a behavior change without the label', () => {
		expect(defect_rate.is_defect(issue(BEHAVIOR_BODY, ['route:split']))).toBe(false)
	})
})

describe('defect_rate.measure', () => {
	it('counts defects among filed issues and behavior changes among completed ones', () => {
		const measured = defect_rate.measure({
			days: DAYS,
			since: SINCE,
			filed: [issue(DEFECT_BODY), issue(CODE_ONLY_BODY, ['route:interrupt']), issue(BEHAVIOR_BODY)],
			completed: [issue(BEHAVIOR_BODY), issue(BEHAVIOR_BODY), issue(CODE_ONLY_BODY), issue('')],
			is_capped: false,
		})

		expect(measured).toStrictEqual(result(2, 2))
		expect(defect_rate.rate_of(measured)).toBe(1)
	})

	it('has no rate when no behavior change completed', () => {
		expect(defect_rate.rate_of(result(3, 0))).toBeUndefined()
	})
})

describe('defect_rate.format', () => {
	it('prints the rate with both counts', () => {
		expect(defect_rate.format(result(20, 48))[0]).toBe(
			'Defect rate over the last 14 days (since 2026-09-09): 0.42 (20 / 48)',
		)
	})

	it('prints n/a rather than a number when the denominator is zero', () => {
		expect(defect_rate.format(result(1, 0))[0]).toContain('n/a')
	})

	it('warns that the counts are lower bounds when the search was capped', () => {
		expect(defect_rate.format(result(1, 2, true)).at(-1)).toContain(LOWER_BOUNDS)
		expect(defect_rate.format(result(1, 2)).join('\n')).not.toContain(LOWER_BOUNDS)
	})
})
