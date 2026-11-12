import { lane_stage_budget } from '#scripts/lane/lane-stage-budget'
import { describe, expect, it } from 'vitest'
import { split_assess } from './split-assess'

const BUDGET_MINUTES = lane_stage_budget.BUDGET_MINUTES.implement
const MEASURED = { median: 3.7, lanes: 1 }
const GUIDE = split_assess.guide_for(BUDGET_MINUTES, MEASURED)
const SMALL_GUIDE = { files: 2, lines: 50, cap: { files: 3, lines: 75 } }
const SMALL_GUIDE_TEXT = 'guide 2 files / 50 lines'

describe('guide_for', () => {
	it.each([6, 17.7, 24])('floors a measured guide at the fallback for rate %s', (median) => {
		expect(split_assess.guide_for(BUDGET_MINUTES, { median, lanes: 1 })).toEqual(
			split_assess.guide_for(BUDGET_MINUTES),
		)
	})

	it('derives both axes and caps from the measured implement budget (ac-b4d39f6d)', () => {
		expect(GUIDE.lines).toBeCloseTo((BUDGET_MINUTES * 100) / 3.7)
		expect(GUIDE.files).toBeCloseTo(((BUDGET_MINUTES * 100) / 3.7) * (8 / 200))
		expect(GUIDE.cap.lines).toBeCloseTo(GUIDE.lines * 1.5)
		expect(GUIDE.cap.files).toBeCloseTo(GUIDE.files * 1.5)
	})

	it('keeps the legacy guide and caps when no rate is measured (ac-42e0410d)', () => {
		expect(split_assess.guide_for(BUDGET_MINUTES)).toEqual({
			files: 8,
			lines: 200,
			cap: { files: 12, lines: 300 },
		})
	})

	it.each([0, -1, NaN, Infinity, -Infinity])(
		'falls back to the legacy guide for an invalid rate %s (ac-52930f37)',
		(median) => {
			expect(split_assess.guide_for(BUDGET_MINUTES, { median, lanes: 1 })).toEqual(
				split_assess.guide_for(BUDGET_MINUTES),
			)
		},
	)
})

describe('a shared derived guide', () => {
	it('judges each axis against the supplied guide and cap with strict boundaries', () => {
		expect(split_assess.verdict_for(GUIDE.files, GUIDE.lines, GUIDE)).toBe('single')
		expect(split_assess.verdict_for(GUIDE.files + 1, 0, GUIDE)).toBe('split')
		expect(split_assess.verdict_for(0, GUIDE.lines + 1, GUIDE)).toBe('split')
		expect(split_assess.is_over_cap(GUIDE.cap.files, GUIDE.cap.lines, GUIDE)).toBe(false)
		expect(split_assess.is_over_cap(GUIDE.cap.files + 1, 0, GUIDE)).toBe(true)
		expect(split_assess.is_over_cap(0, GUIDE.cap.lines + 1, GUIDE)).toBe(true)
	})

	it('uses the supplied guide for assessment, reasons and notices (ac-1c2e6b58)', () => {
		const raw = '51\t0\tscripts/a.ts\n500\t0\tscripts/a.test.ts'
		const measured = split_assess.assess(raw, SMALL_GUIDE)

		expect(measured).toEqual({ files: 1, lines: 51, verdict: 'split', guide: SMALL_GUIDE })
		expect(split_assess.assess(raw).verdict).toBe('single')
		expect(split_assess.reason(measured, SMALL_GUIDE)).toContain(SMALL_GUIDE_TEXT)
		expect(split_assess.reason(measured, SMALL_GUIDE)).toContain('over the guide')
		expect(split_assess.notice(measured, undefined, SMALL_GUIDE)).toContain(SMALL_GUIDE_TEXT)
	})

	it('defaults to the attached guide while explicit arguments take precedence (ac-9e07d12c)', () => {
		const measured = split_assess.assess('51\t0\tscripts/a.ts', SMALL_GUIDE)

		expect(split_assess.reason(measured)).toContain(SMALL_GUIDE_TEXT)
		expect(split_assess.notice(measured)).toContain(SMALL_GUIDE_TEXT)
		expect(split_assess.notice(measured, undefined, GUIDE)).toBeUndefined()
		expect(split_assess.reason(measured, GUIDE)).not.toContain(SMALL_GUIDE_TEXT)
	})
})

describe('notices with a derived guide', () => {
	it('prints no notice at the supplied guide and caps grown declarations at it', () => {
		const measured = { files: 2, lines: 50, verdict: 'single' } as const

		expect(split_assess.notice(measured, undefined, SMALL_GUIDE)).toBeUndefined()
		expect(
			split_assess.notice({ ...measured, lines: 51 }, { files: 8, lines: 200 }, SMALL_GUIDE),
		).toContain(SMALL_GUIDE_TEXT)
	})

	it('keeps a smaller grown declaration on either axis under the supplied guide', () => {
		const measured = { files: 1, lines: 41, verdict: 'single' } as const

		expect(split_assess.notice(measured, { files: 2, lines: 20 }, SMALL_GUIDE)).toContain(
			'declared 2 files / 20 lines; growth files × 2 (fallback) / lines × 2 (fallback), capped at the guide = 2 files / 40 lines',
		)
		expect(split_assess.notice(measured, { files: 0, lines: 0 }, SMALL_GUIDE)).toBeUndefined()
	})
})
