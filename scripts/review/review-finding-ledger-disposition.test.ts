import { describe, expect, it } from 'vitest'
import { review_finding_ledger } from './review-finding-ledger'

// joshuafolkken/kit#5286: what became of a finding, as an optional sixth ledger field.

const DATE = '2026-10-28'
const ISSUE = 5286
const FILE = 'src/foo.ts:42'
const SPEC = 'bug-risks:medium:src/foo.ts:42'
const FIVE_FIELD = '- rf:bug-risks | medium | src/foo.ts:42 | 2026-10-28 | #5286'
const FILED = 'filed:#12'
const DEFERRED = 'deferred:#34'
const FALSE_POSITIVE = 'false-positive'
const DISPOSITIONS = ['fixed', FALSE_POSITIVE, FILED, DEFERRED]

function line_with(disposition: string | undefined): string {
	return review_finding_ledger.finding_line(
		{
			category: 'bug-risks',
			severity: 'medium',
			file: FILE,
			...(disposition !== undefined && { disposition }),
		},
		DATE,
		ISSUE,
	)
}

describe('review_finding_ledger — the disposition field', () => {
	it.each(DISPOSITIONS)('writes a %s disposition as the sixth field', (disposition) => {
		expect(line_with(disposition)).toBe(`${FIVE_FIELD} | ${disposition}`)
	})

	it('writes a finding with no disposition as the five fields it always had', () => {
		expect(line_with(undefined)).toBe(FIVE_FIELD)
	})

	it('still counts a five-field line as the issue’s record, with no disposition', () => {
		expect(review_finding_ledger.has_issue_record(FIVE_FIELD, ISSUE)).toBe(true)
		expect(review_finding_ledger.issue_dispositions(FIVE_FIELD, ISSUE)).toStrictEqual([
			{ severity: 'medium', disposition: undefined },
		])
	})

	it('reads each line’s severity and disposition for the issue alone', () => {
		const content = [line_with('fixed'), '- rf:tests | low | a.ts | 2026-10-28 | #1 | fixed'].join(
			'\n',
		)

		expect(review_finding_ledger.issue_dispositions(content, ISSUE)).toStrictEqual([
			{ severity: 'medium', disposition: 'fixed' },
		])
	})

	it('counts a six-field line toward the category aggregate', () => {
		expect(review_finding_ledger.category_counts(line_with('fixed'))).toStrictEqual([
			{ category: 'bug-risks', count: 1 },
		])
	})
})

describe('review_finding_ledger — split_disposition', () => {
	it.each(DISPOSITIONS)('splits a leading %s from the spec it marks', (disposition) => {
		expect(review_finding_ledger.split_disposition(`${disposition} ${SPEC}`)).toStrictEqual({
			disposition,
			spec: SPEC,
		})
	})

	it.each(['filed:#0', 'wontfix', 'deferred:12', 'Fixed'])(
		'leaves a %s token in the spec rather than reading it as a disposition',
		(token) => {
			const positional = `${token} ${SPEC}`

			expect(review_finding_ledger.split_disposition(positional)).toStrictEqual({
				disposition: undefined,
				spec: positional,
			})
		},
	)

	it('leaves a bare spec as it is', () => {
		expect(review_finding_ledger.split_disposition(SPEC)).toStrictEqual({
			disposition: undefined,
			spec: SPEC,
		})
	})
})

describe('review_finding_ledger — is_closing', () => {
	it.each([
		['fixed', true],
		[FALSE_POSITIVE, true],
		[FILED, false],
		[DEFERRED, false],
		[undefined, false],
	] as const)('reads %s as closing: %s', (disposition, is_closing) => {
		expect(review_finding_ledger.is_closing(disposition)).toBe(is_closing)
	})
})
