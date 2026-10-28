import { describe, expect, it } from 'vitest'
import { review_record_cli } from './review-record-cli'

// joshuafolkken/kit#5286: a positional's leading disposition rides into the ledger as the sixth field.

const DATE = '2026-10-28'
const ISSUE = 5286

function lines_of(positionals: ReadonlyArray<string>): ReadonlyArray<string> {
	const findings = positionals.flatMap((positional) => {
		const parsed = review_record_cli.parse_positional(positional)

		return parsed === undefined ? [] : [parsed.finding]
	})

	return review_record_cli.build_lines({ issue: ISSUE, findings }, DATE)
}

describe('review_record_cli.parse_positional — the disposition', () => {
	it('writes a `fixed <spec>` positional as a six-field line, beside a bare one', () => {
		expect(lines_of(['fixed tests:medium:a.ts', 'security:low:b.ts'])).toStrictEqual([
			'- rf:tests | medium | a.ts | 2026-10-28 | #5286 | fixed',
			'- rf:security | low | b.ts | 2026-10-28 | #5286',
		])
	})

	it('splits the description before the disposition', () => {
		expect(
			review_record_cli.parse_positional('filed:#12 tests:medium:a.ts:3 — the guard misses a glob'),
		).toStrictEqual({
			finding: { category: 'tests', severity: 'medium', file: 'a.ts:3', disposition: 'filed:#12' },
			description: 'the guard misses a glob',
		})
	})

	it('refuses a token outside the disposition grammar rather than dropping it', () => {
		expect(review_record_cli.parse_positional('wontfix tests:medium:a.ts')).toBeUndefined()
	})
})

describe('review_record_cli.usage_text — the disposition', () => {
	it('names the optional leading disposition in the grammar line', () => {
		expect(review_record_cli.usage_text()).toContain(
			'[[<disposition> ]<category>:<severity>:<file>[ — <reason>] ...]',
		)
	})
})
