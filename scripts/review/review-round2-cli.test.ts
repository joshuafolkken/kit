import { afterEach, describe, expect, it, vi } from 'vitest'
import { review_code_tree } from './review-code-tree'
import { review_round2_cli } from './review-round2-cli'
import { review_stamps } from './review-stamps'

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

const SOURCE = 'scripts/review/review-round2.ts'
const BASE = '0123456789abcdef0123456789abcdef01234567'

function plant_record(digest: string): void {
	vi.spyOn(review_stamps.round_one_code_stamp, 'read').mockReturnValue({
		taken_at: '',
		files: { [SOURCE]: digest },
		base: BASE,
	})
}

// joshuafolkken/kit#3826: the code record is re-read against this checkout's own files, so a file
// whose comment-free digest still matches is named comment-only and one whose digest moved is not.
describe('review_round2_cli.read_comment_only', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('names a file whose code is as the record took it', async () => {
		const current = await review_code_tree.read([SOURCE])

		plant_record(current[SOURCE] ?? '')

		expect(await review_round2_cli.read_comment_only(BASE)).toStrictEqual([SOURCE])
	})

	it('names nothing when the code moved since the record', async () => {
		plant_record('an-older-digest')

		expect(await review_round2_cli.read_comment_only(BASE)).toStrictEqual([])
	})
})

describe('review_round2_cli.run', () => {
	it('exits non-zero on an unreadable invocation', async () => {
		expect(await review_round2_cli.run(['--nope'])).toBe(1)
	})
})
