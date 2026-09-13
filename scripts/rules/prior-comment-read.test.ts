import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { prior_comment_read } from './prior-comment-read'

// The stand-down that keeps the `issue-comments` rule from refusing a body read the run already earned
// (joshuafolkken/kit#1905). The delivery path is exercised end to end in `delivered-rules.test.ts`;
// this suite pins the tail scan and the two classifiers it rests on.

const { BRANCH } = time_transcript_fixture
const VIEW = 'gh issue view 1319'
const API = 'gh api repos/joshuafolkken/kit/issues/1319'
const COMMENTS = 'gh api repos/joshuafolkken/kit/issues/1319/comments'
const ISSUE_READ = 'pnpm josh issue:read 1319'
const GATE = 'pnpm josh gate'

// A tail whose Bash calls are the given commands, one per turn — the shape the guard reads at delivery.
function tail_of(...commands: ReadonlyArray<string>): string {
	return commands
		.map((command, index) => time_transcript_fixture.josh_call_line(index, BRANCH, command))
		.join('\n')
}

function numbers_of(command: string): ReadonlyArray<number> {
	return [...prior_comment_read.issue_numbers_of(command)].toSorted(
		(first, second) => first - second,
	)
}

describe('issue_numbers_of', () => {
	it.each([
		[VIEW, [1319]],
		['gh issue view 1319 --repo joshuafolkken/kit', [1319]],
		[API, [1319]],
		[COMMENTS, [1319]],
		['pnpm josh issue:read 1876 1900', [1876, 1900]],
		[GATE, []],
	])('reads %j as %j', (command, expected) => {
		expect(numbers_of(command)).toEqual(expected)
	})
})

describe('fetches_comments', () => {
	it.each([COMMENTS, 'gh issue view 1319 --comments', ISSUE_READ])(
		'reads %j as a comment fetch',
		(command) => {
			expect(prior_comment_read.fetches_comments(command)).toBe(true)
		},
	)

	it.each([VIEW, API, GATE])('leaves %j alone', (command) => {
		expect(prior_comment_read.fetches_comments(command)).toBe(false)
	})
})

describe('already_read_comments_for', () => {
	it('is true when the tail read the same Issue comments with issue:read', () => {
		expect(prior_comment_read.already_read_comments_for(tail_of(ISSUE_READ), VIEW)).toBe(true)
	})

	it('is true across the gh comment-endpoint spelling', () => {
		expect(prior_comment_read.already_read_comments_for(tail_of(COMMENTS), API)).toBe(true)
	})

	it('is false when the earlier read was a different Issue', () => {
		const tail = tail_of('pnpm josh issue:read 1900')

		expect(prior_comment_read.already_read_comments_for(tail, VIEW)).toBe(false)
	})

	it('is false on an empty tail', () => {
		expect(prior_comment_read.already_read_comments_for('', VIEW)).toBe(false)
	})

	it('is false when the body read names no Issue', () => {
		expect(prior_comment_read.already_read_comments_for(tail_of(ISSUE_READ), GATE)).toBe(false)
	})
})
