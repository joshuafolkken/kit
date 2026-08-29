import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { git_gh_pr } from './git-gh-pr'
import {
	EMPTY_LISTING,
	find_request,
	FORK_REPO,
	gh_api_routes,
	PR_BRANCH,
	pr_lookup_path,
	PR_NUMBER,
	pr_routes,
	request_body,
} from './git-gh-pr-fixture'
import { forget_pr_numbers, FORK_HEAD_MESSAGE, NO_PULL_REQUEST_MESSAGE } from './git-gh-pr-read'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_command: vi.fn(),
		exec_gh_command_with_stdin: vi.fn(),
		exec_gh_api: vi.fn(),
	},
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

vi.mock('./git-command', () => ({
	git_command: {
		get_default_branch: vi.fn(),
		branch: vi.fn(),
		fetch_branch: vi.fn(),
		checkout: vi.fn(),
		merge_fast_forward: vi.fn(),
	},
}))

const mocked_command = vi.mocked(git_gh_exec.exec_gh_command)
const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_git = vi.mocked(git_command)

const REPO_PATH = 'repos/{owner}/{repo}'
const PULLS_PATH = `${REPO_PATH}/pulls`
const PR_COMMENTS_PATH = `${REPO_PATH}/issues/${String(PR_NUMBER)}/comments`
const PR_MERGE_PATH = `${PULLS_PATH}/${String(PR_NUMBER)}/merge`
const HTML_URL_FILTER = '.html_url'
const DEFAULT_BRANCH = 'main'
const CREATED_URL = 'https://github.com/joshuafolkken/kit/pull/1045'
const COMMENT_URL = `${CREATED_URL}#issuecomment-5464738049`
const TITLE = 'Write pull requests through REST #1029'
const BODY = 'closes #1029\n\n- one\n- two'

// The duplicate-head answer, exactly as the live API gave it on the throwaway pull request: `gh`
// writes this JSON to **stdout** and only `gh: Validation Failed (HTTP 422)` to stderr, and
// `to_gh_error` appends the body so that the reason survives into the thrown Error
// (joshuafolkken/kit#1029).
const DUPLICATE_STDERR = 'gh: Validation Failed (HTTP 422)'
const DUPLICATE_BODY =
	'{"message":"Validation Failed","errors":[{"resource":"PullRequest","code":"custom",' +
	'"message":"A pull request already exists for joshuafolkken:tmp-1029-head."}],' +
	'"documentation_url":"https://docs.github.com/rest/pulls/pulls#create-a-pull-request",' +
	'"status":"422"}'
const DUPLICATE_MESSAGE = `${DUPLICATE_STDERR}\n${DUPLICATE_BODY}`
const PR_ALREADY_EXISTS = 'PR_ALREADY_EXISTS'
const NOT_FOUND = 'gh: Not Found (HTTP 404)'
const NO_PR_CASE = 'throws when the branch has no pull request'

function write_extra(): Record<string, string> {
	return {
		[PULLS_PATH]: CREATED_URL,
		[PR_COMMENTS_PATH]: COMMENT_URL,
		[PR_MERGE_PATH]: '{"sha":"b0d386c","merged":true}',
	}
}

function write_routes(): Record<string, string> {
	return pr_routes({}, write_extra())
}

function requests(): Array<GhApiRequest> {
	return mocked_api.mock.calls.map(([request]) => request)
}

function request_to(path: string): GhApiRequest {
	return find_request(requests(), path)
}

function parsed_body(path: string): Record<string, unknown> {
	return request_body(request_to(path))
}

function lookup_calls(): number {
	return requests().filter((request) => request.path === pr_lookup_path()).length
}

beforeEach(() => {
	vi.clearAllMocks()
	forget_pr_numbers()
	mocked_api.mockImplementation(gh_api_routes(write_routes()))
	mocked_command.mockResolvedValue('')
	mocked_git.get_default_branch.mockResolvedValue(DEFAULT_BRANCH)
	mocked_git.branch.mockResolvedValue(PR_BRANCH)
})

describe('pr_create', () => {
	it('posts the pull request collection through gh api', async () => {
		await git_gh_pr.pr_create(TITLE, BODY)

		expect(request_to(PULLS_PATH).method).toBeUndefined()
		expect(request_to(PULLS_PATH).jq_filter).toBe(HTML_URL_FILTER)
	})

	// `gh pr create` inferred the head from the current branch and REST does not: a request without
	// it is a 422, so the branch is read from git and sent.
	it('sends the current branch as head and the default branch as base', async () => {
		await git_gh_pr.pr_create(TITLE, BODY)

		expect(parsed_body(PULLS_PATH)).toStrictEqual({
			title: TITLE,
			body: BODY,
			head: PR_BRANCH,
			base: DEFAULT_BRANCH,
		})
	})

	// `git-pr.ts` displays what this returns, so the shape `gh pr create` printed is rebuilt from the
	// response's `html_url`.
	it('answers the browser URL of the created pull request', async () => {
		await expect(git_gh_pr.pr_create(TITLE, BODY)).resolves.toBe(CREATED_URL)
	})

	// The branch → number memo the reads share is sound because a pull request's number never changes
	// — except here, where `git-pr.ts` opens a second pull request on a branch whose first one merged.
	// A memo left standing would keep answering with the merged one (joshuafolkken/kit#1027).
	it('re-resolves the branch afterwards, dropping the branch to number memo', async () => {
		await git_gh_pr.pr_get_number(PR_BRANCH)
		await git_gh_pr.pr_create(TITLE, BODY)
		await git_gh_pr.pr_get_number(PR_BRANCH)

		expect(lookup_calls()).toBe(2)
	})

	// The trap the conversion had to clear: the wording moved from gh's stderr to the 422 body, and
	// `git-pr.ts` recovers from `PR_ALREADY_EXISTS` by reporting the existing pull request instead of
	// dying.
	it('reports PR_ALREADY_EXISTS for the REST 422 on a duplicate head', async () => {
		mocked_api.mockRejectedValueOnce(new Error(DUPLICATE_MESSAGE))

		await expect(git_gh_pr.pr_create(TITLE, BODY)).rejects.toThrow(PR_ALREADY_EXISTS)
	})

	it('rethrows any other failure unchanged', async () => {
		mocked_api.mockRejectedValueOnce(new Error(NOT_FOUND))

		await expect(git_gh_pr.pr_create(TITLE, BODY)).rejects.toThrow(NOT_FOUND)
	})
})

// A pull request's conversation comment is an issue comment; `pulls/{N}/comments` is the review
// thread, which is a different listing entirely.
describe('pr_comment', () => {
	it('posts to the issue comment endpoint of the resolved number', async () => {
		await git_gh_pr.pr_comment(PR_BRANCH, BODY)

		expect(parsed_body(PR_COMMENTS_PATH)).toStrictEqual({ body: BODY })
		expect(request_to(PR_COMMENTS_PATH).jq_filter).toBe(HTML_URL_FILTER)
	})

	it('answers the comment URL', async () => {
		await expect(git_gh_pr.pr_comment(PR_BRANCH, BODY)).resolves.toBe(COMMENT_URL)
	})

	// `gh pr comment <branch>` failed for a branch with no pull request, and the callers let that
	// surface. Folding it into a silent success would lose a CodeRabbit ignore reason.
	it(NO_PR_CASE, async () => {
		mocked_api.mockImplementation(gh_api_routes({ [pr_lookup_path()]: EMPTY_LISTING }))

		await expect(git_gh_pr.pr_comment(PR_BRANCH, BODY)).rejects.toThrow(NO_PULL_REQUEST_MESSAGE)
	})
})

describe('pr_merge', () => {
	// `--merge` produced a merge commit and this repository allows nothing else, so the method is
	// named rather than left to the endpoint's default.
	it('puts the merge endpoint with an explicit merge_method', async () => {
		await git_gh_pr.pr_merge(PR_BRANCH)

		expect(request_to(PR_MERGE_PATH).method).toBe('PUT')
		expect(parsed_body(PR_MERGE_PATH)).toStrictEqual({ merge_method: 'merge' })
	})

	it(NO_PR_CASE, async () => {
		mocked_api.mockImplementation(gh_api_routes({ [pr_lookup_path()]: EMPTY_LISTING }))

		await expect(git_gh_pr.pr_merge(PR_BRANCH)).rejects.toThrow(NO_PULL_REQUEST_MESSAGE)
	})
})

// `gh pr checkout` was measured with `GH_DEBUG=api` and does issue one `POST /graphql` to resolve the
// pull request; everything after it is git. Only the resolution moved (joshuafolkken/kit#1029).
describe('pr_checkout', () => {
	it('fetches and checks out the head branch the REST read answered', async () => {
		await git_gh_pr.pr_checkout(PR_NUMBER)

		expect(mocked_git.fetch_branch).toHaveBeenCalledWith(PR_BRANCH)
		expect(mocked_git.checkout).toHaveBeenCalledWith(PR_BRANCH)
	})

	it('runs no gh subcommand, so nothing reaches GraphQL', async () => {
		await git_gh_pr.pr_checkout(PR_NUMBER)

		expect(mocked_command).not.toHaveBeenCalled()
	})

	// The third thing the CLI did, and the one a fetch-and-checkout pair silently drops: a branch that
	// is already local is otherwise checked out at whatever commit the previous run left it on.
	it('fast-forwards the branch after checking it out', async () => {
		await git_gh_pr.pr_checkout(PR_NUMBER)

		expect(mocked_git.merge_fast_forward).toHaveBeenCalledWith(PR_BRANCH)
	})

	// A fork's head is not on `origin` under this name, and `origin` may carry a different branch that
	// answers to it — which would be checked out silently.
	it('refuses a head branch that lives in another repository', async () => {
		const fork_routes = pr_routes(
			{ head: { ref: PR_BRANCH, repo: { full_name: FORK_REPO } } },
			write_extra(),
		)

		mocked_api.mockImplementation(gh_api_routes(fork_routes))

		await expect(git_gh_pr.pr_checkout(PR_NUMBER)).rejects.toThrow(FORK_HEAD_MESSAGE)
		expect(mocked_git.fetch_branch).not.toHaveBeenCalled()
	})

	// `pr_head_reference` throws rather than guessing, and `sync-dependabot-pins.ts` depends on that:
	// a guessed branch would push template pins onto the wrong pull request.
	it('does not check anything out when the head branch cannot be read', async () => {
		mocked_api.mockImplementation(gh_api_routes({}))

		await expect(git_gh_pr.pr_checkout(PR_NUMBER)).rejects.toThrow()
		expect(mocked_git.checkout).not.toHaveBeenCalled()
	})
})

describe('git_gh_pr', () => {
	// The reads and the writes share one branch → number memo, which is what makes it one memo rather
	// than one per import site.
	it('exposes the REST reads alongside the writes', () => {
		expect(typeof git_gh_pr.pr_get_review_comments).toBe('function')
	})
})
