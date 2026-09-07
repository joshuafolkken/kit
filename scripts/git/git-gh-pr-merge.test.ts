import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { git_gh_pr, MERGE_REQUEST_TIMEOUT_MS, MERGE_UNCONFIRMED_MESSAGE } from './git-gh-pr'
import {
	find_request,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	pr_detail_path,
	PR_NUMBER,
	pr_routes,
	rest_pull,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import { forget_pr_numbers } from './git-gh-pr-read'

// joshuafolkken/kit#1077. `PUT pulls/{N}/merge` is the least idempotent write in this layer, and a
// request that fails *after* the server has merged used to end `followup` before its completion
// notification and the epic auto-close — with a re-run then answering 405 on a pull request that was
// already merged. The recovery is to re-read the pull request and let its own state settle it.
//
// **The read is the whole point, so the merge and the detail are answered separately.** "The write
// failed and the pull request is merged" needs two different *outcomes* on two paths, which is why
// the shared `gh_api_routes` was widened to take a thunk beside a body rather than copied here.
vi.mock('./git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_command: vi.fn(),
		exec_gh_command_with_stdin: vi.fn(),
		exec_gh_api: vi.fn(),
	},
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)

const REPO_PATH = 'repos/{owner}/{repo}'
const PR_MERGE_PATH = `${REPO_PATH}/pulls/${String(PR_NUMBER)}/merge`
const MERGED_RESPONSE = '{"sha":"b0d386c","merged":true}'
// What GitHub answers a merge request aimed at a pull request that is already merged — the failure a
// re-run of `followup` used to die on.
const ALREADY_MERGED = 'gh: Pull Request is not mergeable (HTTP 405)'
// `merged_at` alone is the listing's spelling of a merge; the single-pull endpoint carries `merged`.
// Both have to settle the question, so both are exercised.
const MERGED_AT = '2026-09-07T01:23:45Z'
const DETAIL_READ_FAILURE = 'detail read exploded'

function fails_with(error: Error): GhApiAnswer {
	async function answer(): Promise<string> {
		throw error
	}

	return answer
}

// A path that fails its first read and answers from then on — the dropped connection the read-back
// retry exists for.
function fails_once_then(json: string): GhApiAnswer {
	const answers: ReadonlyArray<GhApiAnswer> = [fails_with(new Error(DETAIL_READ_FAILURE))]
	let index = 0

	async function answer(): Promise<string> {
		const next = answers[index] ?? json

		index += 1

		return typeof next === 'string' ? next : await next()
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
		vi.clearAllMocks()
		forget_pr_numbers()
	})

	it('sends the merge with a budget of its own rather than the shared request timeout', async () => {
		arrange(MERGED_RESPONSE, rest_pull())

		await git_gh_pr.pr_merge(PR_BRANCH)

		expect(merge_request().timeout_ms).toBe(MERGE_REQUEST_TIMEOUT_MS)
	})

	it('rethrows the original failure when the merge did not land', async () => {
		arrange(fails_with(gh_failure()), rest_pull())

		await expect(git_gh_pr.pr_merge(PR_BRANCH)).rejects.toThrow(gh_failure().message)
	})
})

// The recovery itself: a request that failed *after* its effect landed.
describe('pr_merge — a merge request that failed after the merge landed', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		forget_pr_numbers()
	})

	it('returns normally when the request failed but the merge had already landed', async () => {
		arrange(fails_with(gh_failure()), rest_pull({ merged: true }))

		await expect(git_gh_pr.pr_merge(PR_BRANCH)).resolves.toBeUndefined()
	})

	it('recovers from the 405 a re-run gets on a pull request that is already merged', async () => {
		const merged = rest_pull({ state: 'closed', merged_at: MERGED_AT })

		arrange(fails_with(new Error(ALREADY_MERGED)), merged)

		await expect(git_gh_pr.pr_merge(PR_BRANCH)).resolves.toBeUndefined()
	})

	// The outage that killed the merge request is the one most likely to kill the read that follows it,
	// so an unretried read-back would fail hardest in exactly the case this recovery is for.
	it('retries the read-back rather than giving up on its first failure', async () => {
		arrange(fails_with(gh_failure()), fails_once_then(rest_pull({ merged: true })))

		await expect(git_gh_pr.pr_merge(PR_BRANCH)).resolves.toBeUndefined()
	})

	// What could not be read is not an answer: reporting "not merged" here would send a run back to a
	// merge it may already have made.
	it('reports an unconfirmed merge when the pull request could not be read back', async () => {
		arrange(fails_with(gh_failure()), fails_with(new Error(DETAIL_READ_FAILURE)))

		await expect(git_gh_pr.pr_merge(PR_BRANCH)).rejects.toThrow(MERGE_UNCONFIRMED_MESSAGE)
	})

	it('carries the merge failure as the cause of an unconfirmed merge', async () => {
		arrange(fails_with(gh_failure()), fails_with(new Error(DETAIL_READ_FAILURE)))

		await expect(git_gh_pr.pr_merge(PR_BRANCH)).rejects.toHaveProperty(
			'cause.message',
			gh_failure().message,
		)
	})
})
