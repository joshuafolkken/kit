import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_closing_pr } from './issue-closing-pr'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-repo', () => ({
	git_gh_repo: { repo_get_name_with_owner: vi.fn() },
}))

const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const repo_get_name_with_owner = vi.mocked(git_gh_repo.repo_get_name_with_owner)
const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/other'
const OTHER_URL = 'https://github.com/joshuafolkken/other/pull/45'
const ISSUE = '2761'
const CLOSING_URL = 'https://github.com/joshuafolkken/kit/pull/2768'
const MENTION_BODY = 'follows #2761'
const MENTION_URL = 'https://github.com/joshuafolkken/kit/pull/2770'

function line(url: string, body: string, repo: string = REPO): string {
	return JSON.stringify({ url, repo, body })
}

beforeEach(() => {
	exec_gh_api.mockReset()
	repo_get_name_with_owner.mockReset().mockResolvedValue(REPO)
})

// joshuafolkken/kit#2769: only a merged pull request whose `closes #N` names the issue makes an OPEN
// child a merged one — a merged pull request that merely mentions it must not close unfinished work.
describe('issue_closing_pr.read_closing_pr', () => {
	it('answers the merged pull request whose body closes the issue', async () => {
		exec_gh_api.mockResolvedValue(
			[line(MENTION_URL, MENTION_BODY), line(CLOSING_URL, `closes #${ISSUE}\n\n## Summary`)].join(
				'\n',
			),
		)

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
	})

	it('answers undefined when the merged pull requests only mention it or close another issue', async () => {
		exec_gh_api.mockResolvedValue(
			[line(MENTION_URL, MENTION_BODY), line(CLOSING_URL, 'closes #27610')].join('\n'),
		)

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers undefined when there is no merged reference at all', async () => {
		exec_gh_api.mockResolvedValue('')

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers undefined when the timeline cannot be read, so nothing is closed on a guess', async () => {
		exec_gh_api.mockRejectedValue(new Error('gh failed'))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})
})

// A reopened issue still carries its earlier attempt's merged reference; only a later one closes it.
describe('issue_closing_pr.read_closing_pr — a reopened issue', () => {
	const REOPENED = JSON.stringify({ reopened: true })

	it('ignores a closing pull request merged before the issue was reopened', async () => {
		exec_gh_api.mockResolvedValue([line(CLOSING_URL, `closes #${ISSUE}`), REOPENED].join('\n'))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers a closing pull request merged after the issue was reopened', async () => {
		exec_gh_api.mockResolvedValue([REOPENED, line(CLOSING_URL, `closes #${ISSUE}`), ''].join('\n'))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
	})
})

// A bare `closes #N` names an issue in the pull request's own repository, so another repository's
// merged pull request closing the same number closes a different issue.
describe('issue_closing_pr.read_closing_pr — another repository', () => {
	it('ignores a merged pull request in another repository whose closes #N carries the same number', async () => {
		exec_gh_api.mockResolvedValue(line(OTHER_URL, `closes #${ISSUE}`, OTHER_REPO))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers the pull request in this repository past one in another', async () => {
		exec_gh_api.mockResolvedValue(
			[line(OTHER_URL, `closes #${ISSUE}`, OTHER_REPO), line(CLOSING_URL, `closes #${ISSUE}`)].join(
				'\n',
			),
		)

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
	})

	it('answers undefined when this repository cannot be named, so nothing is closed on a guess', async () => {
		repo_get_name_with_owner.mockResolvedValue(undefined)
		exec_gh_api.mockResolvedValue(line(CLOSING_URL, `closes #${ISSUE}`))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})
})
