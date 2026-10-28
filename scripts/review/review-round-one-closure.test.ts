import { describe, expect, it } from 'vitest'
import { review_finding_ledger } from './review-finding-ledger'
import { review_round_one_closure } from './review-round-one-closure'

// joshuafolkken/kit#5286: round 1's closure, read from the issue's own ledger lines.

const ISSUE = 5286
const DATE = '2026-10-28'

function line(severity: string, disposition?: string, issue: number = ISSUE): string {
	const fields = ['bug-risks', severity, 'a.ts:3', DATE, `#${String(issue)}`]

	return `- rf:${[...fields, ...(disposition === undefined ? [] : [disposition])].join(' | ')}`
}

function closure_of(
	...lines: ReadonlyArray<string>
): ReturnType<typeof review_round_one_closure.of_content> {
	return review_round_one_closure.of_content(lines.join('\n'), ISSUE)
}

describe('review_round_one_closure.of_content', () => {
	it('reads an issue with no recorded round as open', () => {
		expect(closure_of(line('medium', 'fixed', 1))).toStrictEqual({
			is_closed: false,
			reason: review_round_one_closure.NO_RECORD_REASON,
		})
	})

	it('reads an unreadable ledger as open', () => {
		expect(review_round_one_closure.of_content(undefined, ISSUE).is_closed).toBe(false)
	})

	it('reads a fixed High and a false-positive Medium as closed', () => {
		expect(closure_of(line('high', 'fixed'), line('medium', 'false-positive'))).toStrictEqual({
			is_closed: true,
			reason: '',
		})
	})

	it.each(['filed:#12', 'deferred:#34', undefined])(
		'reads a Medium with a %s disposition as open, naming it in the reason',
		(disposition) => {
			const closure = closure_of(line('high', 'fixed'), line('medium', disposition))

			expect(closure.is_closed).toBe(false)
			expect(closure.reason).toContain(review_round_one_closure.OPEN_REASON_PREFIX)
			expect(closure.reason).toContain(disposition ?? 'no disposition')
		},
	)

	it('reads a Low left without a disposition as closed', () => {
		expect(closure_of(line('low')).is_closed).toBe(true)
	})

	it('reads a zero-finding round as closed', () => {
		expect(closure_of(`- rf:none | none | - | ${DATE} | #${String(ISSUE)}`).is_closed).toBe(true)
	})

	it('ignores another issue’s open finding', () => {
		expect(closure_of(line('medium', 'fixed'), line('medium', undefined, 1)).is_closed).toBe(true)
	})
})

// joshuafolkken/kit#5359: only the issue's latest code round is read.
describe('review_round_one_closure.of_content — the latest round', () => {
	const boundary = review_finding_ledger.round_line(DATE, ISSUE)
	const zero_round = `- rf:none | none | - | ${DATE} | #${String(ISSUE)}`

	it('reads a clean re-run after an earlier round’s unfixed Medium as closed', () => {
		expect(closure_of(boundary, line('medium'), boundary, zero_round).is_closed).toBe(true)
	})

	it('reads a Medium the latest round left open as open', () => {
		expect(closure_of(boundary, zero_round, boundary, line('medium')).is_closed).toBe(false)
	})

	it('ignores another issue’s boundary', () => {
		const other = review_finding_ledger.round_line(DATE, 1)

		expect(closure_of(line('medium'), other, zero_round).is_closed).toBe(false)
	})
})

describe('review_round_one_closure.read', () => {
	it('reads a branch that names no issue as open', async () => {
		expect(await review_round_one_closure.read(undefined)).toStrictEqual({
			is_closed: false,
			reason: review_round_one_closure.NO_RECORD_REASON,
		})
	})
})
