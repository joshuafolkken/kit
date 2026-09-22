import { describe, expect, it } from 'vitest'
import { review_finding_ledger } from './review-finding-ledger'

const DATE = '2026-09-22'
const ISSUE = 2325
const FILE = 'src/foo.ts:42'

describe('review_finding_ledger — line format', () => {
	it('formats a finding as a distinct `- rf:` line with five fields', () => {
		const line = review_finding_ledger.finding_line(
			{ category: 'bug-risks', severity: 'medium', file: FILE },
			DATE,
			ISSUE,
		)

		expect(line).toBe('- rf:bug-risks | medium | src/foo.ts:42 | 2026-09-22 | #2325')
	})

	it('formats a zero-finding round with the `none` sentinel', () => {
		expect(review_finding_ledger.zero_round_line(DATE, ISSUE)).toBe(
			'- rf:none | none | - | 2026-09-22 | #2325',
		)
	})

	it('does not collide with the `- k:` observation grammar', () => {
		expect(review_finding_ledger.is_finding_line('- k:example | d1 | 2026-09-22 | x | y')).toBe(
			false,
		)
		expect(review_finding_ledger.is_finding_line('- rf:tests | low | a.ts | 2026-09-22 | #1')).toBe(
			true,
		)
	})
})

describe('review_finding_ledger — vocabulary', () => {
	it('accepts every rubric category and rejects free text', () => {
		expect(review_finding_ledger.is_category('project-conventions')).toBe(true)
		expect(review_finding_ledger.is_category('made-up')).toBe(false)
	})

	it('accepts the three severities and rejects others', () => {
		expect(review_finding_ledger.is_severity('high')).toBe(true)
		expect(review_finding_ledger.is_severity('critical')).toBe(false)
	})

	it('rejects an empty file field or one carrying the field separator', () => {
		expect(review_finding_ledger.is_valid_file(FILE)).toBe(true)
		expect(review_finding_ledger.is_valid_file('')).toBe(false)
		expect(review_finding_ledger.is_valid_file('a.ts | b.ts')).toBe(false)
	})
})

describe('review_finding_ledger — aggregation', () => {
	const content = [
		'## Ledger',
		'- k:unrelated | d1 | 2026-09-22 | where | what',
		'- rf:bug-risks | medium | a.ts | 2026-09-22 | #1',
		'- rf:bug-risks | low | b.ts | 2026-09-22 | #2',
		'- rf:tests | medium | c.ts | 2026-09-22 | #2',
		'- rf:none | none | - | 2026-09-22 | #3',
	].join('\n')

	it('counts findings by category, most frequent first, ignoring observation lines', () => {
		expect(review_finding_ledger.category_counts(content)).toEqual([
			{ category: 'bug-risks', count: 2 },
			{ category: 'tests', count: 1 },
		])
	})

	it('counts zero-finding rounds separately from categories', () => {
		expect(review_finding_ledger.zero_round_count(content)).toBe(1)
	})

	it('reports no counts for a ledger with no finding lines', () => {
		expect(review_finding_ledger.category_counts('- k:x | d1 | 2026-09-22 | w | h')).toEqual([])
		expect(review_finding_ledger.zero_round_count('')).toBe(0)
	})
})

describe('review_finding_ledger — has_issue_record', () => {
	const content = [
		review_finding_ledger.finding_line(
			{ category: 'bug-risks', severity: 'medium', file: 'a.ts' },
			DATE,
			1,
		),
		review_finding_ledger.zero_round_line(DATE, 3),
	].join('\n')

	it('finds a real finding line for the issue', () => {
		expect(review_finding_ledger.has_issue_record(content, 1)).toBe(true)
	})

	it('counts a zero-finding `none` line as a record', () => {
		expect(review_finding_ledger.has_issue_record(content, 3)).toBe(true)
	})

	it('reports no record for an issue with no line, and ignores observation lines', () => {
		expect(review_finding_ledger.has_issue_record(content, 2)).toBe(false)
		expect(review_finding_ledger.has_issue_record('- k:x | d1 | obs | w | h', 1)).toBe(false)
	})
})
