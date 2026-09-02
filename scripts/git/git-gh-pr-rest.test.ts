import { describe, expect, it } from 'vitest'
import { git_gh_pr_rest } from './git-gh-pr-rest'
import { ai_review_pull_comment_schema, pr_info_schema } from './schemas'

// joshuafolkken/kit#1027: `gh pr view` answered three states and REST answers two, reporting the
// third as a separate field. Everything below is the recomposition and the field renames that keep
// the callers reading what they already read.

const OPEN_PULL = { number: 1, state: 'open', merged: false }
const CLOSED_PULL = { number: 2, state: 'closed', merged: false }
const MERGED_PULL = { number: 3, state: 'closed', merged: true }

function state_of(pull: Record<string, unknown>): string | undefined {
	return git_gh_pr_rest.to_pr_state(git_gh_pr_rest.parse_rest_pull(JSON.stringify(pull)))
}

describe('to_pr_state', () => {
	it('reports an open pull request as OPEN', () => {
		expect(state_of(OPEN_PULL)).toBe('OPEN')
	})

	it('reports a closed pull request as CLOSED', () => {
		expect(state_of(CLOSED_PULL)).toBe('CLOSED')
	})

	// `git-pr.ts` opens a fresh pull request only when it reads MERGED, so folding this into CLOSED
	// would leave the branch waiting on checks that never run again.
	it('recomposes MERGED from the separate merged field', () => {
		expect(state_of(MERGED_PULL)).toBe('MERGED')
	})

	// The listing endpoint carries `merged_at` and no `merged`.
	it('recomposes MERGED from merged_at alone', () => {
		expect(state_of({ number: 4, state: 'closed', merged_at: '2026-08-30T00:00:00Z' })).toBe(
			'MERGED',
		)
	})
})

function info_of(pull: Record<string, unknown>): Record<string, unknown> {
	return git_gh_pr_rest.to_pr_info(git_gh_pr_rest.parse_rest_pull(JSON.stringify(pull)))
}

describe('to_pr_info', () => {
	const PULL = { number: 5, state: 'open', mergeable: false, mergeable_state: 'dirty' }

	// `mergeStateStatus` is upper-cased because `git-pr-checks-eval.ts` compares strictly against the
	// spelling `gh` used; `mergeable` is REST's nullable boolean, which `pr_info_schema` accepts and
	// passes through as it arrives (joshuafolkken/kit#1232 left it with no reader — see `to_pr_info`).
	it('answers the three fields under the names gh gave them', () => {
		expect(info_of(PULL)).toStrictEqual({
			mergeable: false,
			mergeStateStatus: 'DIRTY',
			state: 'OPEN',
		})
	})

	it('leaves mergeable out while GitHub has not computed it', () => {
		expect(info_of({ number: 6, state: 'open' })).toStrictEqual({
			mergeable: undefined,
			mergeStateStatus: undefined,
			state: 'OPEN',
		})
	})

	it('parses as the pr_info_schema its readers use', () => {
		expect(pr_info_schema.safeParse(info_of(PULL)).success).toBe(true)
	})
})

describe('select_pull', () => {
	it('prefers the open pull request over an older merged one', () => {
		const pulls = git_gh_pr_rest.parse_rest_pulls(JSON.stringify([MERGED_PULL, OPEN_PULL]))

		expect(git_gh_pr_rest.select_pull(pulls)?.number).toBe(OPEN_PULL.number)
	})

	it('falls back to the newest row when none is open', () => {
		const pulls = git_gh_pr_rest.parse_rest_pulls(JSON.stringify([MERGED_PULL, CLOSED_PULL]))

		expect(git_gh_pr_rest.select_pull(pulls)?.number).toBe(MERGED_PULL.number)
	})

	it('answers nothing for a branch with no pull request', () => {
		expect(git_gh_pr_rest.select_pull(git_gh_pr_rest.parse_rest_pulls('[]'))).toBeUndefined()
	})
})

const REST_COMMENT = {
	body: 'Actionable comments posted: 2',
	html_url: 'https://github.com/joshuafolkken/kit/pull/1#issuecomment-1',
	user: { login: 'coderabbitai[bot]' },
}

function mapped(comment: Record<string, unknown>): Record<string, unknown> | undefined {
	return git_gh_pr_rest.to_pr_comments(JSON.stringify([comment]))[0]
}

describe('to_pr_comments', () => {
	// `git-pr-ai-review.ts` reads `author.login` and `url`, which REST spells `user.login` and
	// `html_url` — its own `url` being the API endpoint.
	it('renames user.login and html_url to the names the merge gate reads', () => {
		expect(mapped(REST_COMMENT)).toStrictEqual({
			body: REST_COMMENT.body,
			url: REST_COMMENT.html_url,
			author: { login: REST_COMMENT.user.login },
		})
	})

	it('parses as the ai_review_pull_comment_schema the merge gate uses', () => {
		expect(ai_review_pull_comment_schema.safeParse(mapped(REST_COMMENT)).success).toBe(true)
	})

	it('answers an empty body for a comment REST reports as null', () => {
		// eslint-disable-next-line unicorn/no-null -- REST sends null for a comment with no body
		expect(mapped({ body: null })).toStrictEqual({
			body: '',
			url: undefined,
			author: { login: undefined },
		})
	})
})

// A response that is not what was asked for must never degrade into an empty answer: an empty
// listing reads as "no reviewer left a finding" and merges (joshuafolkken/kit#973), and an empty
// pull listing reads as "this branch has no pull request".
describe('a response that is not what was asked for', () => {
	const RATE_LIMITED = '{"message":"API rate limit exceeded"}'

	it('throws rather than answering an empty pull request listing', () => {
		expect(() => git_gh_pr_rest.parse_rest_pulls(RATE_LIMITED)).toThrow()
	})

	it('throws rather than answering an empty comment listing', () => {
		expect(() => git_gh_pr_rest.to_pr_comments(RATE_LIMITED)).toThrow()
	})

	it('throws rather than answering a pull request with every field missing', () => {
		expect(() => git_gh_pr_rest.parse_rest_pull('not json at all')).toThrow()
	})
})
