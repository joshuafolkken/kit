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

// joshuafolkken/kit#4276: the interaction review's round is its own `- ri:` line, in the same grammar.
describe('review_finding_ledger — the interaction kind', () => {
	const INTERACTION = 'interaction'
	const finding = { category: 'bug-risks', severity: 'high', file: FILE } as const

	it('writes a finding and a zero-finding round as `- ri:` lines', () => {
		expect(review_finding_ledger.finding_line(finding, DATE, ISSUE, INTERACTION)).toBe(
			'- ri:bug-risks | high | src/foo.ts:42 | 2026-09-22 | #2325',
		)
		expect(review_finding_ledger.zero_round_line(DATE, ISSUE, INTERACTION)).toBe(
			'- ri:none | none | - | 2026-09-22 | #2325',
		)
	})

	it('keeps the two kinds apart in has_issue_record', () => {
		const code_only = review_finding_ledger.zero_round_line(DATE, ISSUE)
		const interaction_only = review_finding_ledger.zero_round_line(DATE, ISSUE, INTERACTION)

		expect(review_finding_ledger.has_issue_record(code_only, ISSUE, INTERACTION)).toBe(false)
		expect(review_finding_ledger.has_issue_record(interaction_only, ISSUE)).toBe(false)
		expect(review_finding_ledger.has_issue_record(interaction_only, ISSUE, INTERACTION)).toBe(true)
	})

	it('counts no `- ri:` line in the code-review aggregation', () => {
		const line = review_finding_ledger.finding_line(finding, DATE, ISSUE, INTERACTION)

		expect(review_finding_ledger.category_counts(line)).toEqual([])
	})
})

// joshuafolkken/kit#5359: a code round's boundary line, and the latest round read after it.
describe('review_finding_ledger — the round boundary', () => {
	const boundary = review_finding_ledger.round_line(DATE, ISSUE)
	const stale = review_finding_ledger.finding_line(
		{ category: 'tests', severity: 'medium', file: FILE },
		DATE,
		ISSUE,
	)
	const clean = review_finding_ledger.zero_round_line(DATE, ISSUE)

	it('writes the boundary as a `- rb:` line', () => {
		expect(boundary).toBe('- rb:2026-09-22 | #2325')
	})

	it('reads only the lines after the issue’s last boundary', () => {
		const content = [boundary, stale, boundary, clean].join('\n')

		expect(review_finding_ledger.latest_round(content, ISSUE)).toBe(clean)
	})

	it('reads the whole content when the issue has no boundary', () => {
		const content = [stale, review_finding_ledger.round_line(DATE, 1), clean].join('\n')

		expect(review_finding_ledger.latest_round(content, ISSUE)).toBe(content)
	})

	it('leaves category_counts and has_issue_record unchanged', () => {
		const content = [boundary, stale].join('\n')

		expect(review_finding_ledger.category_counts(content)).toEqual([
			{ category: 'tests', count: 1 },
		])
		expect(review_finding_ledger.has_issue_record(boundary, ISSUE)).toBe(false)
	})
})

const SINCE = '2026-11-03'
// Out of period, five- and six-field lines, zero rounds on both sides of the boundary, and three
// lines no reader counts: a missing issue field, an unknown severity, the interaction prefix.
const PERIOD_LEDGER = [
	'- rf:tests | low | a.ts | 2026-11-02 | #1',
	'- rf:tests | high | a.ts | 2026-11-03 | #1',
	'- rf:comments | low | b.ts | 2026-11-04 | #2',
	'- rf:comments | low | b.ts | 2026-11-05 | #2 | fixed',
	'- rf:bug-risks | medium | c.ts | 2026-11-06 | #3 | filed:#9',
	'- rf:bug-risks | medium | c.ts | 2026-11-06 | #3',
	'- rf:none | none | - | 2026-11-07 | #4',
	'- rf:none | none | - | 2026-11-01 | #5',
	'- rf:tests | high | a.ts | 2026-11-08',
	'- rf:tests | urgent | a.ts | 2026-11-08 | #6',
	'- ri:tests | high | a.ts | 2026-11-08 | #7',
].join('\n')
const TIED_LEDGER = ['tests', 'comments', 'assumptions', 'assumptions']
	.map((category, index) => `- rf:${category} | low | t.ts | 2026-11-09 | #${String(index)}`)
	.join('\n')

// joshuafolkken/kit#7130: the period reader counts by severity, from the boundary day on.
describe('review_finding_ledger — severity_counts over a period', () => {
	const content = PERIOD_LEDGER

	it('counts each severity of the in-period lines, medium and up first', () => {
		expect(review_finding_ledger.severity_counts(content, SINCE)).toEqual([
			{ category: 'bug-risks', high: 0, medium: 2, low: 0 },
			{ category: 'tests', high: 1, medium: 0, low: 0 },
			{ category: 'comments', high: 0, medium: 0, low: 2 },
		])
	})

	it('ranks by low and then by name when the medium-and-up totals tie', () => {
		expect(
			review_finding_ledger.severity_counts(TIED_LEDGER, SINCE).map((entry) => entry.category),
		).toEqual(['assumptions', 'comments', 'tests'])
	})

	it('counts only the zero rounds dated on or after the boundary', () => {
		expect(review_finding_ledger.zero_round_count(content, SINCE)).toBe(1)
		expect(review_finding_ledger.zero_round_count(content)).toBe(2)
	})

	it('finds nothing when every line predates the boundary', () => {
		expect(review_finding_ledger.severity_counts(content, '2026-12-01')).toEqual([])
	})
})
