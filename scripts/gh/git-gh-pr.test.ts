import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'
import { git_gh_pr } from './git-gh-pr'
import {
	EMPTY_LISTING,
	find_request,
	gh_api_routes,
	gh_failure,
	PR_BRANCH,
	pr_lookup_path,
	PR_NUMBER,
	pr_routes,
	request_body,
	type GhApiAnswer,
} from './git-gh-pr-fixture'
import {
	forget_pr_numbers,
	NO_PULL_REQUEST_MESSAGE,
	UNREADABLE_PULL_REQUEST_MESSAGE,
} from './git-gh-pr-read'

vi.mock('./git-gh-exec', () => ({
	git_gh_exec: {
		exec_gh_command: vi.fn(),
		exec_gh_command_with_stdin: vi.fn(),
		exec_gh_api: vi.fn(),
	},
	has_stderr_field: (): boolean => false,
	BODY_FROM_STDIN: '-',
}))

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		get_default_branch: vi.fn(),
		branch: vi.fn(),
	},
}))

const mocked_command = vi.mocked(git_gh_exec.exec_gh_command)
const mocked_api = vi.mocked(git_gh_exec.exec_gh_api)
const mocked_git = vi.mocked(git_command)

const REPO_PATH = 'repos/{owner}/{repo}'
const PULLS_PATH = `${REPO_PATH}/pulls`
const PR_COMMENTS_PATH = `${REPO_PATH}/issues/${String(PR_NUMBER)}/comments`
const PR_PATH = `${PULLS_PATH}/${String(PR_NUMBER)}`
const PR_MERGE_PATH = `${PR_PATH}/merge`
const HTML_URL_FILTER = '.html_url'
const DEFAULT_BRANCH = 'main'
const CREATED_URL = 'https://github.com/joshuafolkken/kit/pull/1045'
const COMMENT_URL = `${CREATED_URL}#issuecomment-5464738049`
const TITLE = 'Write pull requests through REST #1029'
const BODY = 'closes #1029\n\n- one\n- two'
const BUGFIX = 'bugfix'
const PR_LABELS_PATH = `${REPO_PATH}/issues/1045/labels`
const EXISTING_PR_LABELS_PATH = `${REPO_PATH}/issues/${String(PR_NUMBER)}/labels`
const CHOOSE_ERROR = 'Choose one release classification'
const RATE_LIMITED_MESSAGE = 'rate limited'

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

function write_extra(): Record<string, string> {
	return {
		[PULLS_PATH]: CREATED_URL,
		[PR_LABELS_PATH]: '[]',
		[PR_COMMENTS_PATH]: COMMENT_URL,
		[PR_MERGE_PATH]: '{"sha":"b0d386c","merged":true}',
	}
}

function write_routes(): Record<string, GhApiAnswer> {
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

describe('pr_create classification', () => {
	it('adds exactly one release label before reporting the created pull request', async () => {
		await git_gh_pr.pr_create(TITLE, BODY, BUGFIX)

		expect(parsed_body(PR_LABELS_PATH)).toStrictEqual({ labels: [BUGFIX] })
		expect(request_to(PR_LABELS_PATH).path).toBe(PR_LABELS_PATH)
	})

	it('reports a failed label write instead of reporting a classified pull request', async () => {
		mocked_api.mockImplementation(
			gh_api_routes({
				...write_routes(),
				[PR_LABELS_PATH]: async () => {
					throw new Error(RATE_LIMITED_MESSAGE)
				},
			}),
		)

		await expect(git_gh_pr.pr_create(TITLE, BODY, BUGFIX)).rejects.toThrow(RATE_LIMITED_MESSAGE)
	})

	it('refuses an unrecognized classification before posting the pull request', async () => {
		await expect(git_gh_pr.pr_create(TITLE, BODY, 'bug' as never)).rejects.toThrow(CHOOSE_ERROR)

		expect(requests()).not.toContainEqual(expect.objectContaining({ path: PULLS_PATH }))
	})
})

describe('existing pull request classification', () => {
	it('adds a missing classification to the existing pull request', async () => {
		mocked_api.mockImplementation(
			gh_api_routes({ ...write_routes(), [EXISTING_PR_LABELS_PATH]: '[]' }),
		)

		await git_gh_pr.pr_ensure_classification(PR_BRANCH, BUGFIX)

		const write = requests().find(
			(request) => request.path === EXISTING_PR_LABELS_PATH && request.body !== undefined,
		)

		expect(write?.body).toBe(JSON.stringify({ labels: [BUGFIX] }))
	})

	it('reuses an existing classification without writing another label', async () => {
		mocked_api.mockImplementation(
			gh_api_routes({
				...write_routes(),
				[EXISTING_PR_LABELS_PATH]: JSON.stringify([{ name: BUGFIX }]),
			}),
		)

		await git_gh_pr.pr_ensure_classification(PR_BRANCH, BUGFIX)

		expect(requests().filter((request) => request.path === EXISTING_PR_LABELS_PATH)).toHaveLength(1)
	})

	it('recognizes an existing classification regardless of case', async () => {
		const uppercase_label = BUGFIX.toUpperCase()

		mocked_api.mockImplementation(
			gh_api_routes({
				...write_routes(),
				[EXISTING_PR_LABELS_PATH]: JSON.stringify([{ name: uppercase_label }]),
			}),
		)

		await expect(git_gh_pr.pr_get_classification(PR_BRANCH)).resolves.toBe(BUGFIX)
	})
})

describe('pr_create', () => {
	it('posts the pull request collection through gh api', async () => {
		await git_gh_pr.pr_create(TITLE, BODY, BUGFIX)

		expect(request_to(PULLS_PATH).method).toBeUndefined()
		expect(request_to(PULLS_PATH).jq_filter).toBe(HTML_URL_FILTER)
	})

	// `gh pr create` inferred the head from the current branch and REST does not: a request without
	// it is a 422, so the branch is read from git and sent.
	it('sends the current branch as head and the default branch as base', async () => {
		await git_gh_pr.pr_create(TITLE, BODY, BUGFIX)

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
		await expect(git_gh_pr.pr_create(TITLE, BODY, BUGFIX)).resolves.toBe(CREATED_URL)
	})

	// The branch → number memo the reads share is sound because a pull request's number never changes
	// — except here, where `git-pr.ts` opens a second pull request on a branch whose first one merged.
	// A memo left standing would keep answering with the merged one (joshuafolkken/kit#1027).
	it('re-resolves the branch afterwards, dropping the branch to number memo', async () => {
		await git_gh_pr.pr_get_number(PR_BRANCH)
		await git_gh_pr.pr_create(TITLE, BODY, BUGFIX)
		await git_gh_pr.pr_get_number(PR_BRANCH)

		expect(lookup_calls()).toBe(2)
	})

	// The trap the conversion had to clear: the wording moved from gh's stderr to the 422 body, and
	// `git-pr.ts` recovers from `PR_ALREADY_EXISTS` by reporting the existing pull request instead of
	// dying.
	it('reports PR_ALREADY_EXISTS for the REST 422 on a duplicate head', async () => {
		mocked_api.mockRejectedValueOnce(new Error(DUPLICATE_MESSAGE))

		await expect(git_gh_pr.pr_create(TITLE, BODY, BUGFIX)).rejects.toThrow(PR_ALREADY_EXISTS)
	})

	it('rethrows any other failure unchanged', async () => {
		mocked_api.mockRejectedValueOnce(new Error(NOT_FOUND))

		await expect(git_gh_pr.pr_create(TITLE, BODY, BUGFIX)).rejects.toThrow(NOT_FOUND)
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
})

describe('pr_update_body', () => {
	it('patches the body of the resolved pull request', async () => {
		await git_gh_pr.pr_update_body(PR_BRANCH, BODY)

		expect(request_to(PR_PATH).method).toBe('PATCH')
		expect(parsed_body(PR_PATH)).toStrictEqual({ body: BODY })
	})

	// joshuafolkken/kit#3263: the detail read is remembered for the command, so a body read before
	// the write would otherwise keep answering the old body after it.
	it('reads the pull request again after writing its body', async () => {
		await git_gh_pr.pr_get_body(PR_BRANCH)
		await git_gh_pr.pr_update_body(PR_BRANCH, BODY)
		await git_gh_pr.pr_get_body(PR_BRANCH)

		const detail_reads = requests().filter(
			(request) => request.path === PR_PATH && request.method === undefined,
		)

		expect(detail_reads).toHaveLength(2)
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
})

// `gh pr comment <branch>` and `gh pr merge <branch>` both failed for a branch with no pull request
// and the callers let that surface — folding it into a silent success would lose a CodeRabbit ignore
// reason, or merge nothing while reporting a merge.
//
// joshuafolkken/kit#1048: what they could not say is *why*. A rate-limited or unauthenticated lookup
// answered the same `undefined` as an empty listing, so a run reported a pull request that plainly
// exists as missing and the diagnosis started in the wrong place. Both writes resolve through
// `require_pr_number`, so both said it and both are asserted here.
describe.each([
	{
		name: 'pr_comment',
		write: async (): Promise<void> => {
			await git_gh_pr.pr_comment(PR_BRANCH, BODY)
		},
	},
	{
		name: 'pr_merge',
		write: async (): Promise<void> => {
			await git_gh_pr.pr_merge(PR_BRANCH)
		},
	},
])('$name when the branch resolves to no number', ({ write }) => {
	it('throws when the branch has no pull request', async () => {
		mocked_api.mockImplementation(gh_api_routes({ [pr_lookup_path()]: EMPTY_LISTING }))

		await expect(write()).rejects.toThrow(NO_PULL_REQUEST_MESSAGE)
	})

	it('throws a different message when the lookup itself failed', async () => {
		mocked_api.mockRejectedValue(gh_failure())

		await expect(write()).rejects.toThrow(UNREADABLE_PULL_REQUEST_MESSAGE)
	})

	// The reason travels as the cause, which is what `git_error.handle` prints under 💡 Details.
	it('carries the failure gh reported as the cause', async () => {
		const failure = gh_failure()

		mocked_api.mockRejectedValue(failure)

		await expect(write()).rejects.toHaveProperty('cause', failure)
	})
})

describe('git_gh_pr', () => {
	// The reads and the writes share one branch → number memo, which is what makes it one memo rather
	// than one per import site.
	it('exposes the REST reads alongside the writes', () => {
		expect(typeof git_gh_pr.pr_get_review_comments).toBe('function')
	})
})
