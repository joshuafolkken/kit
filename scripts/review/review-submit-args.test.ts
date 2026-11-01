import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { review_submit_args } from './review-submit-args'

// joshuafolkken/kit#5627: `--review <file>` names the review the submit lints, and `--round` the
// rubric shape it is linted against.

const REVIEW_PATH = path.join(tmpdir(), 'review.md')

describe('review_submit_args.submission_of', () => {
	it('reads the slot and --none with no review to lint', () => {
		expect(review_submit_args.submission_of(['--interaction', '--none'])).toEqual({
			slot: 'interaction',
			is_none: true,
			review: undefined,
		})
	})

	it.each([
		[[], 1],
		[['--round', '2'], 2],
	])('lints the --review file at round %j → %i', (round_argv, round) => {
		expect(review_submit_args.submission_of(['--review', REVIEW_PATH, ...round_argv])).toEqual({
			slot: 'code',
			is_none: false,
			review: { path: REVIEW_PATH, round },
		})
	})

	it.each([
		[['--round', '2']],
		[['--review']],
		[['--review', REVIEW_PATH, '--round', '3']],
		[['--review', REVIEW_PATH, '--review', REVIEW_PATH]],
		[['positional']],
		// josh runs from the package root, so a relative path would not be the reviewer's file.
		[['--review', 'review.md']],
	])('refuses %j', (argv) => {
		expect(review_submit_args.submission_of(argv)).toBeUndefined()
	})
})
