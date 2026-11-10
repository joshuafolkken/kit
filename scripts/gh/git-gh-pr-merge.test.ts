import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { gh_failure as git_gh_failure } from './git-gh-failure'
import {
	git_gh_pr,
	MERGE_IN_PROGRESS_ATTEMPTS,
	MERGE_REQUEST_TIMEOUT_MS,
	MERGE_UNCONFIRMED_MESSAGE,
} from './git-gh-pr'
import {
	find_request,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	pr_detail_path,
	pr_lookup_path,
	PR_NUMBER,
	pr_routes,
	rest_pull,
	rest_pull_page,
	too_many_files_failure,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import { forget_pr_numbers } from './git-gh-pr-read'
import { gh_retry } from './git-gh-retry'

// A failed `PUT pulls/{N}/merge` may still have merged on the server. Re-reading the pull request
// settles whether completion and epic auto-close can proceed without repeating the write
// (joshuafolkken/kit#1077).
//
// **The read is the whole point, so the merge and the detail are answered separately.** "The write
// failed and the pull request is merged" needs two different *outcomes* on two paths, which is why
// the shared `gh_api_routes` accepts a thunk beside a body instead of requiring a copied fixture.
vi.mock('./git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_command: vi.fn(),
		exec_gh_command_with_stdin: vi.fn(),
		exec_gh_api: vi.fn(),
	},
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))
// `with_retry` waits through `node:timers/promises`, which fake timers do not reach.
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO_PATH = 'repos/{owner}/{repo}'
const PR_MERGE_PATH = `${REPO_PATH}/pulls/${String(PR_NUMBER)}/merge`
const MERGED_RESPONSE = '{"sha":"b0d386c","merged":true}'
// GitHub's answer for an already-merged pull request must remain recoverable on a re-run.
const ALREADY_MERGED = 'gh: Pull Request is not mergeable (HTTP 405)'
// `merged_at` alone is the listing's spelling of a merge; the single-pull endpoint carries `merged`.
// Both have to settle the question, so both are exercised.
const MERGED_AT = '2026-09-07T01:23:45Z'
const DETAIL_READ_FAILURE = 'detail read exploded'
const HEAD_SHA = 'c0ffee1'
const HEAD_MOVED_STATUS = 409
const UNPROCESSABLE_STATUS = 422
const BAD_GATEWAY = 'gh: Server Error (HTTP 502)'
const GATEWAY_TIMEOUT = "gh: We couldn't respond to your request in time. (HTTP 504)"
const MERGE_IN_PROGRESS =
	'gh: Merge already in progress (HTTP 405)\n{"message":"Merge already in progress","status":"405"}'
const METHOD_NOT_ALLOWED_STATUS = 405

function transient_merge_failure(): Error {
	return git_gh_failure.attach(new Error(BAD_GATEWAY), { status: undefined })
}

function timed_out_merge_failure(): Error {
	return git_gh_failure.attach(new Error(GATEWAY_TIMEOUT), { status: undefined })
}

function merge_in_progress_failure(): Error {
	return git_gh_failure.attach(new Error(MERGE_IN_PROGRESS), { status: METHOD_NOT_ALLOWED_STATUS })
}

function merge_requests(): Array<GhApiRequest> {
	return mocked_api.mock.calls
		.map(([request]) => request)
		.filter(({ path }) => path === PR_MERGE_PATH)
}

function fails_with(error: Error): GhApiAnswer {
	async function answer(): Promise<string> {
		throw error
	}

	return answer
}

// A failure carrying the status GitHub's error document reported, as `exec_gh_api` throws it.
function status_failure(status: number): Error {
	return git_gh_failure.attach(new Error(`gh: HTTP ${String(status)}`), { status })
}

// A path that fails its first read and answers from then on — the dropped connection the read-back
// retry exists for.
function fails_once_then(json: string): GhApiAnswer {
	const answers: ReadonlyArray<GhApiAnswer> = [fails_with(new Error(DETAIL_READ_FAILURE))]
	let index = 0

	async function answer(request: GhApiRequest): Promise<string> {
		const next = answers[index] ?? json

		index += 1

		return typeof next === 'string' ? next : await next(request)
	}

	return answer
}

// The branch lookup every branch-keyed write resolves through, plus the detail read the recovery
// asks for and the merge itself.
function arrange(merge: GhApiAnswer, detail: GhApiAnswer): void {
	const routes = pr_routes({}, { [pr_detail_path()]: detail, [PR_MERGE_PATH]: merge })

	mocked_api.mockImplementation(gh_api_routes(routes))
}

function merge_request(): GhApiRequest {
	return find_request(
		mocked_api.mock.calls.map(([request]) => request),
		PR_MERGE_PATH,
	)
}

describe('pr_merge', () => {
	beforeEach(() => {
		forget_pr_numbers()
	})

	it('sends the merge with a budget of its own rather than the shared request timeout', async () => {
		arrange(MERGED_RESPONSE, rest_pull())

		await git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)
		expect(merge_request().should_retry).toBe(false)

		expect(merge_request().timeout_ms).toBe(MERGE_REQUEST_TIMEOUT_MS)
	})

	// #4036: a 409 must reach the caller unchanged, since that caller re-waits on the new head.
	it('rethrows the 409 a moved head answers, since the merge did not land', async () => {
		const moved = status_failure(HEAD_MOVED_STATUS)

		arrange(fails_with(moved), rest_pull())

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).rejects.toBe(moved)
	})

	it('rethrows the original failure when the merge did not land', async () => {
		arrange(fails_with(gh_failure()), rest_pull())

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).rejects.toThrow(gh_failure().message)
	})
})

describe('pr_merge — transient merge failures', () => {
	beforeEach(() => {
		forget_pr_numbers()
	})

	it('retries a 502 only after reading back that the merge did not land', async () => {
		const merge = vi
			.fn()
			.mockRejectedValueOnce(transient_merge_failure())
			.mockResolvedValue(MERGED_RESPONSE)
		const detail = vi.fn().mockResolvedValue(rest_pull())

		arrange(merge, detail)
		await git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)

		expect(merge).toHaveBeenCalledTimes(2)
		expect(detail.mock.invocationCallOrder[0]).toBeLessThan(merge.mock.invocationCallOrder[1] ?? 0)
		expect(merge_requests().map(({ body }) => body)).toEqual([
			JSON.stringify({ merge_method: 'merge', sha: HEAD_SHA }),
			JSON.stringify({ merge_method: 'merge', sha: HEAD_SHA }),
		])
	})

	it('stops after the shared retry budget when every merge answers 502', async () => {
		const failure = transient_merge_failure()

		arrange(fails_with(failure), rest_pull())
		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).rejects.toBe(failure)
		expect(merge_requests()).toHaveLength(gh_retry.MAX_ATTEMPTS)
	})

	it('does not retry a 502 when its read-back remains unreadable', async () => {
		arrange(fails_with(transient_merge_failure()), fails_with(new Error(DETAIL_READ_FAILURE)))

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).rejects.toThrow(MERGE_UNCONFIRMED_MESSAGE)
		expect(merge_requests()).toHaveLength(1)
	})
})

describe('is_head_moved', () => {
	it.each([
		{ error: status_failure(HEAD_MOVED_STATUS), expected: true },
		{ error: status_failure(UNPROCESSABLE_STATUS), expected: false },
		{ error: gh_failure(), expected: false },
	])('answers $expected for $error.message', ({ error, expected }) => {
		expect(git_gh_pr.is_head_moved(error)).toBe(expected)
	})
})

// The recovery itself: a request that failed *after* its effect landed.
describe('pr_merge — a merge request that failed after the merge landed', () => {
	beforeEach(() => {
		forget_pr_numbers()
	})

	it('returns normally when the request failed but the merge had already landed', async () => {
		arrange(fails_with(gh_failure()), rest_pull({ merged: true }))

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).resolves.toBeUndefined()
	})

	it('recovers from the 405 a re-run gets on a pull request that is already merged', async () => {
		const merged = rest_pull({ state: 'closed', merged_at: MERGED_AT })

		arrange(fails_with(new Error(ALREADY_MERGED)), merged)

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).resolves.toBeUndefined()
	})

	// The outage that killed the merge request is the one most likely to kill the read that follows it,
	// so an unretried read-back would fail hardest in exactly the case this recovery is for.
	it('retries the read-back rather than giving up on its first failure', async () => {
		arrange(fails_with(gh_failure()), fails_once_then(rest_pull({ merged: true })))

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).resolves.toBeUndefined()
	})

	// What could not be read is not an answer: reporting "not merged" here would send a run back to a
	// merge it may already have made.
	it('reports an unconfirmed merge when the pull request could not be read back', async () => {
		arrange(fails_with(gh_failure()), fails_with(new Error(DETAIL_READ_FAILURE)))

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).rejects.toThrow(MERGE_UNCONFIRMED_MESSAGE)
	})

	it('carries the merge failure as the cause of an unconfirmed merge', async () => {
		arrange(fails_with(gh_failure()), fails_with(new Error(DETAIL_READ_FAILURE)))

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).rejects.toHaveProperty(
			'cause.message',
			gh_failure().message,
		)
	})
})

// joshuafolkken/kit#7171: a 504 whose merge was still running server-side, so the resent request
// answered 405 "Merge already in progress" while the read-back still saw the pull request open.
describe('pr_merge — a merge GitHub reports as already in progress', () => {
	beforeEach(() => {
		forget_pr_numbers()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('waits for the in-progress merge to land after a 504', async () => {
		const merge = vi
			.fn()
			.mockRejectedValueOnce(timed_out_merge_failure())
			.mockRejectedValue(merge_in_progress_failure())
		const detail = vi
			.fn()
			.mockResolvedValueOnce(rest_pull())
			.mockResolvedValueOnce(rest_pull())
			.mockResolvedValue(rest_pull({ merged: true }))

		arrange(merge, detail)
		const outcome = expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).resolves.toBeUndefined()

		await vi.runAllTimersAsync()
		await outcome
		expect(merge).toHaveBeenCalledTimes(2)
	})

	it('fails with the 405 when the merge has not landed within the bound', async () => {
		const in_progress = merge_in_progress_failure()
		const detail = vi.fn().mockResolvedValue(rest_pull())

		arrange(fails_with(in_progress), detail)
		const outcome = expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).rejects.toBe(in_progress)

		await vi.runAllTimersAsync()
		await outcome
		expect(detail).toHaveBeenCalledTimes(MERGE_IN_PROGRESS_ATTEMPTS)
		expect(merge_requests()).toHaveLength(1)
	})
})

// joshuafolkken/kit#5229: the listing row stands in for a detail refused as too many files changed.
describe('pr_merge — a read-back whose detail is too large', () => {
	beforeEach(() => {
		forget_pr_numbers()
	})

	it('reads the merge back from the listing row', async () => {
		const merged_row = rest_pull_page([{ state: 'closed', merged_at: MERGED_AT }])
		const routes = pr_routes(
			{},
			{
				[pr_lookup_path()]: merged_row,
				[pr_detail_path()]: fails_with(too_many_files_failure()),
				[PR_MERGE_PATH]: fails_with(gh_failure()),
			},
		)

		mocked_api.mockImplementation(gh_api_routes(routes))

		await expect(git_gh_pr.pr_merge(PR_BRANCH, HEAD_SHA)).resolves.toBeUndefined()
	})
})
