import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { describe, expect, it } from 'vitest'
import { review_finding_kind } from './review-finding-kind'
import { review_finding_ledger } from './review-finding-ledger'

const DATE = '2026-11-19'
const ISSUE = 7
const STALE_DOCS = 'stale-docs'
const EDGE_INPUT = 'edge-input'
const SPEC = 'tests:low:a.ts'

describe('review_finding_kind.split_kind', () => {
	it('splits a known leading kind from the spec', () => {
		expect(review_finding_kind.split_kind(`kind=${STALE_DOCS} ${SPEC}`)).toEqual({
			kind: STALE_DOCS,
			spec: SPEC,
		})
	})

	it('leaves a spec without a kind token unchanged', () => {
		expect(review_finding_kind.split_kind(SPEC)).toEqual({ kind: undefined, spec: SPEC })
	})

	it.each([`kind=typo ${SPEC}`, `kind= ${SPEC}`, `kind=${STALE_DOCS}`])(
		'refuses %s, whose kind is outside the list or has no spec after it',
		(text) => {
			expect(review_finding_kind.split_kind(text)).toBeUndefined()
		},
	)
})

describe('review_finding_ledger.finding_line with a kind', () => {
	it('writes the kind seventh, holding an absent disposition with a placeholder', () => {
		const finding = {
			category: 'tests',
			severity: 'low',
			file: 'a.ts',
			kind: EDGE_INPUT,
		} as const

		expect(review_finding_ledger.finding_line(finding, DATE, ISSUE)).toBe(
			'- rf:tests | low | a.ts | 2026-11-19 | #7 | - | edge-input',
		)
	})

	it('writes the disposition sixth and the kind seventh when both are given', () => {
		const finding = {
			category: 'tests',
			severity: 'low',
			file: 'a.ts',
			disposition: 'fixed',
			kind: EDGE_INPUT,
		} as const

		expect(review_finding_ledger.finding_line(finding, DATE, ISSUE)).toBe(
			'- rf:tests | low | a.ts | 2026-11-19 | #7 | fixed | edge-input',
		)
	})
})

describe('review_finding_ledger.issue_dispositions with a kind', () => {
	it('reads the placeholder as no disposition and keeps an old line readable', () => {
		const content = [
			'- rf:tests | medium | a.ts | 2026-11-19 | #7 | - | edge-input',
			'- rf:tests | high | b.ts | 2026-11-19 | #7 | fixed | stale-cache',
			'- rf:tests | low | c.ts | 2026-11-19 | #7',
		].join('\n')

		expect(review_finding_ledger.issue_dispositions(content, ISSUE)).toEqual([
			{ severity: 'medium', disposition: undefined },
			{ severity: 'high', disposition: 'fixed' },
			{ severity: 'low', disposition: undefined },
		])
	})
})

describe('review_finding_kind.kind_report', () => {
	const content = [
		'- rf:tests | low | a.ts | 2026-11-01 | #1 | - | edge-input',
		'- rf:tests | low | a.ts | 2026-11-10 | #1 | fixed | stale-docs',
		'- rf:tests | low | b.ts | 2026-11-10 | #1 | fixed | stale-docs',
		'- rf:tests | low | c.ts | 2026-11-10 | #1 | - | edge-input',
		'- rf:tests | low | d.ts | 2026-11-10 | #1 | fixed',
		'- rf:none | none | - | 2026-11-10 | #2',
		'- rf:tests | low | e.ts | 2026-11-10 | #1 | - | x | y',
	].join('\n')

	it('counts each kind, most frequent first, against every real finding', () => {
		expect(review_finding_kind.kind_report(content)).toEqual({
			counts: [
				{ kind: EDGE_INPUT, count: 2 },
				{ kind: STALE_DOCS, count: 2 },
			],
			with_kind: 4,
			total: 5,
		})
	})

	it('counts only the findings dated on or after since', () => {
		expect(review_finding_kind.kind_report(content, '2026-11-05')).toEqual({
			counts: [
				{ kind: STALE_DOCS, count: 2 },
				{ kind: EDGE_INPUT, count: 1 },
			],
			with_kind: 3,
			total: 4,
		})
	})
})

// The reviewer's submitted line carries the kind in the line it records, outside the spec it scores.
describe('run_ship_review.read_verdict with a kind', () => {
	it('reads a line with a known kind, keeping the kind for the record', () => {
		const line = `kind=${EDGE_INPUT} ${SPEC}`

		expect(run_ship_review.read_verdict(line)).toMatchObject({ kind: 'clean', report: [line] })
	})

	it('refuses a line whose kind is outside the list', () => {
		expect(run_ship_review.read_verdict(`kind=typo ${SPEC}`).kind).toBe('invalid')
	})
})
