import { describe, expect, it } from 'vitest'
import type { PairFinding, PairLine } from './review-pair-log'
import { review_pair_stats } from './review-pair-stats'

// joshuafolkken/kit#8759: `review:pair --stats` measures how many Opus high and medium findings the
// paired Sonnet reviewer raised at the same place, and each reviewer's mean cost per run.

function finding(severity: string, place: string): PairFinding {
	return { severity, line: `bug-risks:${severity}:${place} — a finding.` }
}

function pair(
	opus: ReadonlyArray<PairFinding>,
	sonnet: ReadonlyArray<PairFinding>,
	usd: { opus?: number; sonnet?: number } = {},
): PairLine {
	return {
		at: '2026-11-23T00:00:00.000Z',
		issue: 8759,
		opus: { agent: 'o', usd: usd.opus, findings: [...opus] },
		sonnet: { agent: 's', usd: usd.sonnet, findings: [...sonnet] },
	}
}

function recall_of(line: PairLine): ReadonlyArray<number> {
	return review_pair_stats.stats([line]).severities.map((row) => row.recalled)
}

describe('review_pair_stats.stats', () => {
	it('recalls a finding Sonnet names in the same file within ten lines, at any severity', () => {
		const line = pair([finding('high', 'a.ts:10')], [finding('low', 'a.ts:20')])

		expect(recall_of(line)).toStrictEqual([1, 0])
	})

	it('misses a finding Sonnet places in another file or further than ten lines away', () => {
		const far = pair([finding('medium', 'a.ts:10')], [finding('medium', 'a.ts:21')])
		const other = pair([finding('medium', 'a.ts:10')], [finding('medium', 'b.ts:10')])

		expect(recall_of(far)).toStrictEqual([0, 0])
		expect(recall_of(other)).toStrictEqual([0, 0])
	})

	it('matches on the file alone when either side has no line number', () => {
		const line = pair([finding('medium', 'a.ts:10')], [finding('low', 'a.ts')])

		expect(recall_of(line)).toStrictEqual([0, 1])
	})

	it('counts high and medium apart, leaves low out, and averages each priced cost', () => {
		const lines = [
			pair([finding('high', 'a.ts:1'), finding('low', 'b.ts:1')], [], { opus: 1, sonnet: 0.2 }),
			pair([finding('medium', 'c.ts:1')], [finding('medium', 'c.ts:1')], { opus: 0.5 }),
		]

		expect(review_pair_stats.stats(lines)).toStrictEqual({
			runs: 2,
			severities: [
				{ severity: 'high', opus: 1, recalled: 0 },
				{ severity: 'medium', opus: 1, recalled: 1 },
			],
			opus_usd: 0.75,
			sonnet_usd: 0.2,
		})
	})
})

describe('review_pair_stats.verdict', () => {
	it('is comparable at 80% recall, short below it, and no data without a grave finding', () => {
		const hit = pair([finding('high', 'a.ts:1')], [finding('high', 'a.ts:1')])
		const miss = pair([finding('medium', 'b.ts:1')], [])
		const quiet = pair([finding('low', 'a.ts:1')], [])
		const { VERDICT } = review_pair_stats

		expect(review_pair_stats.verdict(review_pair_stats.stats([hit, hit, hit, hit, miss]))).toBe(
			VERDICT.COMPARABLE,
		)
		expect(review_pair_stats.verdict(review_pair_stats.stats([hit, miss]))).toBe(VERDICT.SHORT)
		expect(review_pair_stats.verdict(review_pair_stats.stats([quiet]))).toBe(VERDICT.NO_DATA)
	})
})

describe('review_pair_stats.report', () => {
	it('prints each severity, the combined recall, the cost per run and the verdict', () => {
		const line = pair([finding('medium', 'a.ts:1')], [], { opus: 0.6, sonnet: 0.1 })

		expect(review_pair_stats.report(review_pair_stats.stats([line]))).toStrictEqual([
			'review:pair stats — 1 runs',
			'high: opus 0 · sonnet recalled 0 · recall —',
			'medium: opus 1 · sonnet recalled 0 · recall 0%',
			'high+medium: opus 1 · sonnet recalled 0 · recall 0%',
			'cost per run: opus $0.60 · sonnet $0.10',
			'verdict: short (comparable at 80% of high+medium, same file within 10 lines)',
		])
	})
})
