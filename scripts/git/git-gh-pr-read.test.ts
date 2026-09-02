import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec } from './git-gh-exec'
import {
	EMPTY_LISTING,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	pr_conversation_comments_path,
	pr_detail_path,
	PR_HTML_URL,
	pr_lookup_path,
	PR_NUMBER,
	pr_review_comments_path,
	pr_routes,
	RATE_LIMITED,
	rest_pull,
	rest_pull_page,
} from './git-gh-pr-fixture'
import {
	forget_pr_numbers,
	git_gh_pr_read,
	UNREADABLE_PULL_REQUEST_MESSAGE,
} from './git-gh-pr-read'

// joshuafolkken/kit#1027: every read below went through `gh pr view`, which is GraphQL and answered
// 403 in a cloud session. `gh pr view` also accepted a branch name where REST is keyed by number, so
// the branch → number resolution these share is asserted here too.

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: { exec_gh_command: vi.fn(), exec_gh_api: vi.fn() },
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const PR_BODY = 'closes #1027'
const NO_PULL_REQUEST = { [pr_lookup_path()]: EMPTY_LISTING }

function stub(routes: Record<string, string>): void {
	mocked_api.mockImplementation(gh_api_routes(routes))
}

function lookup_calls(): number {
	return mocked_api.mock.calls.filter(([request]) => request.path === pr_lookup_path()).length
}

beforeEach(() => {
	vi.clearAllMocks()
	forget_pr_numbers()
})

describe('the branch to pull request number resolution', () => {
	it('asks gh for the pull requests whose head is that branch', async () => {
		stub(pr_routes())

		await expect(git_gh_pr_read.pr_get_number(PR_BRANCH)).resolves.toBe(PR_NUMBER)
		expect(mocked_api).toHaveBeenCalledWith({ path: pr_lookup_path() })
	})

	// The whole point of resolving in one place: six branch-keyed readers were one request each, and
	// a naive rewrite makes every one of them two.
	it('resolves a branch once and reuses the number', async () => {
		stub(pr_routes())

		await git_gh_pr_read.pr_get_number(PR_BRANCH)
		await git_gh_pr_read.pr_get_url(PR_BRANCH)
		await git_gh_pr_read.pr_get_body(PR_BRANCH)

		expect(lookup_calls()).toBe(1)
	})

	// A branch with no pull request is the case `pr_create` is about to change, so an absence is
	// never remembered.
	it('does not remember a branch that has no pull request', async () => {
		stub(NO_PULL_REQUEST)

		await git_gh_pr_read.pr_get_number(PR_BRANCH)
		await git_gh_pr_read.pr_get_number(PR_BRANCH)

		expect(lookup_calls()).toBe(2)
	})

	// A failed lookup is re-tried rather than remembered as an absence: caching it would keep every
	// later reader in the run answering from one rate-limited request (joshuafolkken/kit#1048).
	it('does not remember a lookup that failed', async () => {
		mocked_api.mockRejectedValue(gh_failure())

		await git_gh_pr_read.pr_get_number(PR_BRANCH)
		await git_gh_pr_read.pr_get_number(PR_BRANCH)

		expect(lookup_calls()).toBe(2)
	})

	// `git-pr.ts` opens a second pull request on a branch whose first one merged, so the memo has to
	// be dropped there or `pr_get_url` keeps answering with the merged one.
	it('re-resolves after the memo is cleared', async () => {
		stub(pr_routes())

		await git_gh_pr_read.pr_get_number(PR_BRANCH)
		forget_pr_numbers()
		await git_gh_pr_read.pr_get_number(PR_BRANCH)

		expect(lookup_calls()).toBe(2)
	})
})

// The two answers the *display* reads deliberately fold together, asserted side by side.
// `require_pr_number` and `pr_exists` tell them apart (joshuafolkken/kit#1048,
// joshuafolkken/kit#1043); every reader below answers its own empty value for both, which is the
// contract `gh pr view` had and the one `git-pr.ts` and the two comment readers are written
// against.
describe.each([
	{
		name: 'a branch with no pull request',
		arrange: (): void => {
			stub(NO_PULL_REQUEST)
		},
	},
	{
		name: 'a lookup that could not be read',
		arrange: (): void => {
			mocked_api.mockRejectedValue(gh_failure())
		},
	},
])('$name answers exactly what gh pr view answered', ({ arrange }) => {
	beforeEach(arrange)

	it('reports pr_get_number as undefined', async () => {
		await expect(git_gh_pr_read.pr_get_number(PR_BRANCH)).resolves.toBeUndefined()
	})

	it('reports pr_get_url as undefined', async () => {
		await expect(git_gh_pr_read.pr_get_url(PR_BRANCH)).resolves.toBeUndefined()
	})

	it('reports pr_get_body as undefined', async () => {
		await expect(git_gh_pr_read.pr_get_body(PR_BRANCH)).resolves.toBeUndefined()
	})

	it('reports pr_view as the empty string its readers check the length of', async () => {
		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).resolves.toBe('')
	})
})

// **`pr_exists` is the one reader that does not fold**, because `git-pr.ts` acts on `false` by
// *opening* a pull request: during a rate limit that used to mean creating a second one on a branch
// that already had it, caught only by `pr_create`'s 422 recovery (joshuafolkken/kit#1043).
describe('pr_exists tells an absent pull request from an unreadable lookup', () => {
	it('answers false only when the listing came back empty', async () => {
		stub(NO_PULL_REQUEST)

		await expect(git_gh_pr_read.pr_exists(PR_BRANCH)).resolves.toBe(false)
	})

	it('throws when the lookup itself failed', async () => {
		mocked_api.mockRejectedValue(gh_failure())

		await expect(git_gh_pr_read.pr_exists(PR_BRANCH)).rejects.toThrow(
			UNREADABLE_PULL_REQUEST_MESSAGE,
		)
	})

	// A 200 carrying an API message object rather than a listing is a failed read too —
	// `parse_rest_pulls` throws rather than degrading it into an empty listing.
	it('throws when gh answers something other than a listing', async () => {
		stub({ [pr_lookup_path()]: RATE_LIMITED })

		await expect(git_gh_pr_read.pr_exists(PR_BRANCH)).rejects.toThrow(
			UNREADABLE_PULL_REQUEST_MESSAGE,
		)
	})

	// gh's own reason is what makes the diagnosis actionable, so it travels rather than being
	// replaced by this file's message.
	it('carries gh’s own failure as the cause', async () => {
		const failure = gh_failure()

		mocked_api.mockRejectedValue(failure)

		await expect(git_gh_pr_read.pr_exists(PR_BRANCH)).rejects.toThrow(
			expect.objectContaining({ cause: failure }) as Error,
		)
	})
})

describe('the reads keyed by the resolved number', () => {
	it('finds a pull request the lookup resolved', async () => {
		stub(pr_routes())

		await expect(git_gh_pr_read.pr_exists(PR_BRANCH)).resolves.toBe(true)
	})

	// REST's own `url` is the API endpoint, which no reader of this value expects.
	it('answers the browser url rather than the API endpoint', async () => {
		stub(pr_routes())

		await expect(git_gh_pr_read.pr_get_url(PR_BRANCH)).resolves.toBe(PR_HTML_URL)
	})

	it('trims whitespace off the url, as the shared parser always did', async () => {
		stub(pr_routes({ html_url: `  ${PR_HTML_URL}\n` }))

		await expect(git_gh_pr_read.pr_get_url(PR_BRANCH)).resolves.toBe(PR_HTML_URL)
	})

	it('answers the pull request body', async () => {
		stub(pr_routes({ body: PR_BODY }))

		await expect(git_gh_pr_read.pr_get_body(PR_BRANCH)).resolves.toBe(PR_BODY)
	})

	it('answers undefined for a body REST reports as null', async () => {
		// eslint-disable-next-line unicorn/no-null -- REST sends null for a pull request with no body
		stub(pr_routes({ body: null }))

		await expect(git_gh_pr_read.pr_get_body(PR_BRANCH)).resolves.toBeUndefined()
	})

	it('answers the three fields pr_view answered with', async () => {
		stub(pr_routes({ mergeable: true, mergeable_state: 'clean' }))

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).resolves.toBe(
			JSON.stringify({ mergeable: true, mergeStateStatus: 'CLEAN', state: 'OPEN' }),
		)
	})

	it('reports pr_view as the empty string when the detail read fails', async () => {
		stub({ [pr_lookup_path()]: rest_pull_page([{}]) })

		await expect(git_gh_pr_read.pr_view(PR_BRANCH)).resolves.toBe('')
	})
})

describe('pr_head_reference', () => {
	// Already keyed by a number, so it needs no lookup at all.
	it('reads the head branch without resolving anything', async () => {
		stub({ [pr_detail_path()]: rest_pull() })

		await expect(git_gh_pr_read.pr_head_reference(PR_NUMBER)).resolves.toBe(PR_BRANCH)
		expect(mocked_api).toHaveBeenCalledTimes(1)
	})

	// It throws where the branch-keyed reads fold to an empty answer: `sync-dependabot-pins.ts`
	// checks out what it is handed, and a guessed branch pushes onto the wrong pull request.
	it('throws rather than answering a guessed branch', async () => {
		stub({ [pr_detail_path()]: JSON.stringify({ number: PR_NUMBER }) })

		await expect(git_gh_pr_read.pr_head_reference(PR_NUMBER)).rejects.toThrow()
	})
})

// joshuafolkken/kit#973: both readers turned every failure into the string `'[]'`, which the merge
// gate then read as "no reviewer left a finding". A rate limit reaching the gate as an answer is how
// a PR merged with the gate never actually read.
describe.each([
	{
		name: 'pr_get_comments',
		path: pr_conversation_comments_path(),
		read: git_gh_pr_read.pr_get_comments,
	},
	{
		name: 'pr_get_review_comments',
		path: pr_review_comments_path(),
		read: git_gh_pr_read.pr_get_review_comments,
	},
])('$name', ({ path, read }) => {
	it('returns the listing gh printed', async () => {
		stub(pr_routes({}, { [path]: EMPTY_LISTING }))

		await expect(read(PR_BRANCH)).resolves.toBe(EMPTY_LISTING)
	})

	// A full page, and every page of it. REST answers 30 rows by default and orders them oldest
	// first, so a truncated listing drops the newest reviewer finding — kit#973's failure in another
	// form, since the gate then has nothing to stop on.
	it('asks gh for that listing, a full page at a time and paged through', async () => {
		stub(pr_routes({}, { [path]: EMPTY_LISTING }))
		await read(PR_BRANCH)

		expect(path).toContain('per_page=100')
		expect(mocked_api).toHaveBeenCalledWith({ path, should_paginate: true })
	})

	it('reports a failed read rather than answering with an empty listing', async () => {
		stub(pr_routes())

		await expect(read(PR_BRANCH)).resolves.toBeUndefined()
	})

	it('reports a pull request number it could not resolve', async () => {
		stub(NO_PULL_REQUEST)

		await expect(read(PR_BRANCH)).resolves.toBeUndefined()
	})

	// The merge gate reads `undefined` as a standing blocker, so a lookup that never answered has to
	// arrive as one too rather than as "this branch has no pull request" (joshuafolkken/kit#1048).
	it('reports a lookup that could not be read', async () => {
		mocked_api.mockRejectedValue(gh_failure())

		await expect(read(PR_BRANCH)).resolves.toBeUndefined()
	})
})

// Only the conversation listing is remapped: `git-pr-coderabbit.ts` parses the review thread as REST
// serves it, while `git-pr-ai-review.ts` reads `author.login` and `url`.
describe('pr_get_comments maps the listing into the shape gh answered with', () => {
	const COMMENTS_PATH = pr_conversation_comments_path()

	it('renames user.login and html_url', async () => {
		const comment = { body: 'hi', html_url: PR_HTML_URL, user: { login: 'claude' } }

		stub(pr_routes({}, { [COMMENTS_PATH]: JSON.stringify([comment]) }))

		await expect(git_gh_pr_read.pr_get_comments(PR_BRANCH)).resolves.toBe(
			JSON.stringify([{ body: 'hi', url: PR_HTML_URL, author: { login: 'claude' } }]),
		)
	})

	it('reports a response that is not a listing as a failed read', async () => {
		stub(pr_routes({}, { [COMMENTS_PATH]: RATE_LIMITED }))

		await expect(git_gh_pr_read.pr_get_comments(PR_BRANCH)).resolves.toBeUndefined()
	})
})
