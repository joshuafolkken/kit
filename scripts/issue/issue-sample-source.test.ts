import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_closing_pr } from './issue-closing-pr'
import { issue_sample_gate } from './issue-sample-gate'
import { issue_sample_source } from './issue-sample-source'

// joshuafolkken/kit#4460: a start condition citing an issue number reads as a pull request that is
// never found, so the issue waits forever. The filing reads what the number names and refuses an issue.

const CITED = 4442
const CLOSING = 4448
const MERGED_AT = '2026-10-21T17:57:37Z'
const THERE = 'joshuafolkken/app-kit'
const PLAIN_HINT = 'whose merge it waits on'
const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const closing_pr = vi.spyOn(issue_closing_pr, 'read_closing_number')

function body_with(line: string): string {
	return `## 背景\n\n- 種別: 非不具合\n${line}\n\n## 現象\n`
}

const GATED_BODY = body_with(`- 実施可能条件: #${String(CITED)} のマージ後 30 マージ`)

function cited_as(rest: object): void {
	exec_gh_api.mockResolvedValue(JSON.stringify(rest))
}

afterEach(() => {
	vi.clearAllMocks()
})

describe('issue_sample_source.problem — an issue number', () => {
	it('refuses it and cites the pull request that closed it', async () => {
		cited_as({ number: CITED })
		closing_pr.mockResolvedValue(CLOSING)

		const problem = await issue_sample_source.problem(GATED_BODY)

		expect(problem).toContain(`#${String(CLOSING)}`)
		expect(problem).toContain('not a pull request')
		expect(exec_gh_api).toHaveBeenCalledWith({
			path: git_gh_api_path.issue_api_path(String(CITED)),
		})
		expect(closing_pr).toHaveBeenCalledWith(CITED)
	})

	it('reads another repository’s number there, with no closing pull request looked up', async () => {
		cited_as({ number: CITED })

		const problem = await issue_sample_source.problem(GATED_BODY, THERE)

		expect(problem).toContain(`${THERE}/issues/${String(CITED)}`)
		expect(problem).toContain(PLAIN_HINT)
		expect(exec_gh_api).toHaveBeenCalledWith({
			path: git_gh_api_path.issue_api_path(String(CITED), THERE),
		})
		expect(closing_pr).not.toHaveBeenCalled()
	})

	it('refuses it with no closing pull request to cite, pointing at the issue form', async () => {
		cited_as({ number: CITED })
		closing_pr.mockResolvedValue(undefined)

		const problem = await issue_sample_source.problem(GATED_BODY)

		expect(problem).toContain(PLAIN_HINT)
		expect(problem).toContain(issue_sample_gate.CLOSING_FORMAT)
	})
})

// joshuafolkken/kit#5051: a lane files its follow-up before the pull request that closes its issue exists.
describe('issue_sample_source.problem — the issue form', () => {
	it('passes it unread, as it cites the issue whose closing pull request it waits on', async () => {
		const body = body_with(`- 実施可能条件: #${String(CITED)} を閉じる PR のマージ後 10 マージ`)

		expect(await issue_sample_source.problem(body)).toBeUndefined()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

describe('issue_sample_source.problem — what passes', () => {
	it.each([
		['a merged pull request', MERGED_AT],
		['an unmerged pull request', undefined],
	])('passes %s', async (_label, merged_at) => {
		cited_as({ number: CITED, pull_request: { merged_at } })

		expect(await issue_sample_source.problem(GATED_BODY)).toBeUndefined()
		expect(closing_pr).not.toHaveBeenCalled()
	})

	it('passes a number that cannot be read', async () => {
		exec_gh_api.mockRejectedValue(new Error('HTTP 404'))

		expect(await issue_sample_source.problem(GATED_BODY)).toBeUndefined()
	})

	it('reads nothing for a body with no start condition', async () => {
		expect(await issue_sample_source.problem(body_with('- 人の判断: 不要'))).toBeUndefined()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})
