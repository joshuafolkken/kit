import { describe, expect, it } from 'vitest'
import { review_round2_cli } from './review-round2-cli'

// joshuafolkken/kit#1433. The parser is where a `skip` could be bought by accident, so it is the
// half with a suite of its own: the assertion flag has to be typed exactly, and anything else is a
// usage error rather than a silently-defaulted answer.

describe('review_round2_cli.parse_options', () => {
	it('defaults to no round-1 assertion, which answers required', () => {
		expect(review_round2_cli.parse_options([])).toStrictEqual({
			is_round_one_closed: false,
			is_json: false,
		})
	})

	it('reads the round-1 assertion flag', () => {
		expect(review_round2_cli.parse_options([review_round2_cli.CLOSED_FLAG])).toStrictEqual({
			is_round_one_closed: true,
			is_json: false,
		})
	})

	it('reads the two flags together in either order', () => {
		expect(
			review_round2_cli.parse_options(['--json', review_round2_cli.CLOSED_FLAG]),
		).toStrictEqual({ is_round_one_closed: true, is_json: true })
	})

	// A near-miss must not read as the assertion, and must not read as an absent one either: silently
	// answering `required` would hide the typo until the day the flag mattered.
	it('refuses a misspelling of the assertion flag', () => {
		expect(review_round2_cli.parse_options(['--round1-closed'])).toBeUndefined()
	})

	it('refuses an unknown flag', () => {
		expect(review_round2_cli.parse_options(['--staged'])).toBeUndefined()
	})

	it('refuses a bare argument', () => {
		expect(review_round2_cli.parse_options(['2'])).toBeUndefined()
	})
})

describe('review_round2_cli.run', () => {
	it('exits non-zero on an unreadable invocation', async () => {
		expect(await review_round2_cli.run(['--nope'])).toBe(1)
	})
})
