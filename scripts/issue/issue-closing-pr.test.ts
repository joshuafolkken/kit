import { FULL_PAGE_QUERY, git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_closing_pr } from './issue-closing-pr'

vi.mock('#scripts/gh/git-gh-exec', () => ({ git_gh_exec: { exec_gh_api: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-repo', () => ({
	git_gh_repo: { repo_get_canonical_name_with_owner: vi.fn() },
}))

const exec_gh_api = vi.mocked(git_gh_exec.exec_gh_api)
const canonical_name = vi.mocked(git_gh_repo.repo_get_canonical_name_with_owner)
// The timeline's first page, answered through the ETag layer (joshuafolkken/kit#7619).
const read_conditional = vi.spyOn(git_gh_conditional, 'read_conditional')
const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/other'
const OTHER_URL = 'https://github.com/joshuafolkken/other/pull/45'
const ISSUE = '2761'
const CLOSING_URL = 'https://github.com/joshuafolkken/kit/pull/2768'
const MENTION_BODY = 'follows #2761'
const MENTION_URL = 'https://github.com/joshuafolkken/kit/pull/2770'
const MERGED_AT = '2026-11-15T00:00:00Z'
const REOPENED = { event: 'reopened' }
const UNREADABLE: ConditionalRead = { kind: 'unreadable' }

// One `cross-referenced` timeline event from a pull request, merged unless `is_merged` is false.
function line(url: string, body: string, repo: string = REPO, is_merged = true): object {
	const issue = {
		html_url: url,
		repository: { full_name: repo },
		body,
		pull_request: { merged_at: is_merged ? MERGED_AT : undefined },
	}

	return { event: 'cross-referenced', source: { issue } }
}

function page(...events: Array<object>): ConditionalRead {
	return { kind: 'changed', etag: undefined, body: JSON.stringify(events) }
}

function serve(...answers: Array<ConditionalRead>): void {
	for (const answer of answers) read_conditional.mockResolvedValueOnce(answer)
}

beforeEach(() => {
	shared_cache_fixture.keep_in_memory()
	read_conditional.mockReset().mockResolvedValue(page())
	exec_gh_api.mockReset()
	canonical_name.mockReset().mockResolvedValue(REPO)
})

// joshuafolkken/kit#2769: only a merged pull request whose `closes #N` names the issue makes an OPEN
// child a merged one — a merged pull request that merely mentions it must not close unfinished work.
describe('issue_closing_pr.read_closing_pr', () => {
	it('answers the merged pull request whose body closes the issue', async () => {
		serve(
			page(line(MENTION_URL, MENTION_BODY), line(CLOSING_URL, `closes #${ISSUE}\n\n## Summary`)),
		)

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
	})

	it('answers undefined when the merged pull requests only mention it or close another issue', async () => {
		serve(page(line(MENTION_URL, MENTION_BODY), line(CLOSING_URL, 'closes #27610')))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers undefined for an unmerged pull request even when its body closes the issue', async () => {
		serve(page(line(CLOSING_URL, `closes #${ISSUE}`, REPO, false)))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers undefined when there is no merged reference at all', async () => {
		serve(page({ event: 'labeled' }))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers undefined when the timeline cannot be read, so nothing is closed on a guess', async () => {
		serve(UNREADABLE)

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})
})

describe('issue_closing_pr.read_closing_number', () => {
	it('answers the closing pull request by its number, and undefined without one', async () => {
		serve(page(line(CLOSING_URL, `closes #${ISSUE}`)), page())

		expect(await issue_closing_pr.read_closing_number(Number(ISSUE))).toBe(2768)
		expect(await issue_closing_pr.read_closing_number(Number(ISSUE))).toBeUndefined()
	})
})

describe('issue_closing_pr.read_closing_number_result', () => {
	it('distinguishes a missing reference from a failed lookup', async () => {
		serve(page(), UNREADABLE)

		await expect(issue_closing_pr.read_closing_number_result(Number(ISSUE))).resolves.toEqual({
			kind: 'read',
			number: undefined,
		})
		await expect(issue_closing_pr.read_closing_number_result(Number(ISSUE))).resolves.toEqual({
			kind: 'unreadable',
		})
	})

	it('reports an unavailable repository and preserves legacy failure behavior', async () => {
		canonical_name.mockResolvedValue(undefined)
		read_conditional.mockResolvedValue(page(line(CLOSING_URL, `closes #${ISSUE}`)))

		await expect(issue_closing_pr.read_closing_number_result(Number(ISSUE))).resolves.toEqual({
			kind: 'unreadable',
		})
		await expect(issue_closing_pr.read_closing_number(Number(ISSUE))).resolves.toBeUndefined()
	})
})

// A reopened issue still carries its earlier attempt's merged reference; only a later one closes it.
describe('issue_closing_pr.read_closing_pr — a reopened issue', () => {
	it('ignores a closing pull request merged before the issue was reopened', async () => {
		serve(page(line(CLOSING_URL, `closes #${ISSUE}`), REOPENED))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers a closing pull request merged after the issue was reopened', async () => {
		serve(page(REOPENED, line(CLOSING_URL, `closes #${ISSUE}`)))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
	})
})

// A bare `closes #N` names an issue in the pull request's own repository, so another repository's
// merged pull request closing the same number closes a different issue.
describe('issue_closing_pr.read_closing_pr — another repository', () => {
	it('ignores a merged pull request in another repository whose closes #N carries the same number', async () => {
		serve(page(line(OTHER_URL, `closes #${ISSUE}`, OTHER_REPO)))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})

	it('answers the pull request in this repository past one in another', async () => {
		serve(
			page(line(OTHER_URL, `closes #${ISSUE}`, OTHER_REPO), line(CLOSING_URL, `closes #${ISSUE}`)),
		)

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
	})

	it('answers undefined when this repository cannot be named, so nothing is closed on a guess', async () => {
		canonical_name.mockResolvedValue(undefined)
		serve(page(line(CLOSING_URL, `closes #${ISSUE}`)))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBeUndefined()
	})
})

// joshuafolkken/kit#7619: the first timeline page goes through the ETag layer, and a full one falls
// back to a paginated read parsed the same way.
describe('issue_closing_pr.read_closing_pr — the ETag layer', () => {
	it('answers the same closing pull request from the kept page on a 304', async () => {
		const etag = 'W/"timeline"'
		const body = JSON.stringify([line(CLOSING_URL, `closes #${ISSUE}`)])

		serve({ kind: 'changed', etag, body }, { kind: 'unchanged' })

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
		expect(read_conditional.mock.calls[1]?.[1]).toBe(etag)
	})

	it('reads every page with --paginate when the first page is full', async () => {
		const full = Array.from({ length: git_gh_api_path.FULL_PAGE_SIZE }, () => ({
			event: 'labeled',
		}))

		serve(page(...full))
		exec_gh_api.mockResolvedValue(JSON.stringify([...full, line(CLOSING_URL, `closes #${ISSUE}`)]))

		expect(await issue_closing_pr.read_closing_pr(ISSUE)).toBe(CLOSING_URL)
		expect(exec_gh_api).toHaveBeenCalledWith({
			path: `${git_gh_api_path.issue_api_path(ISSUE)}/timeline${FULL_PAGE_QUERY}`,
			should_paginate: true,
		})
	})
})
