import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_release_cli, NONE } from '#scripts/issue/issue-release-cli'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { release_request } from './release-request'

const TARGET = 'joshuafolkken/kit'
const RELEASE_ISSUE = 4321

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_request.request_of', () => {
	it('cites the open release Issue in the request line', () => {
		const request = release_request.request_of(RELEASE_ISSUE, TARGET)

		expect(request.release_issue).toBe(
			issue_cite.reference(TARGET, String(RELEASE_ISSUE), undefined),
		)
		expect(request.request).toContain(release_request.RELEASE_COMMAND)
		expect(request.request).toContain(request.release_issue)
	})

	it('reports none and names the release command alone when no release Issue is open', () => {
		expect(release_request.request_of(NONE, TARGET)).toEqual({
			release_issue: NONE,
			request: `request: ${release_request.RELEASE_COMMAND}`,
		})
	})

	it('reports unknown, never none, when the listing is unreadable', () => {
		expect(release_request.request_of(undefined, TARGET).release_issue).toBe(
			release_request.UNKNOWN,
		)
	})
})

describe('release_request.read', () => {
	it('looks the release Issue up through issue_release_cli.find_open for this repository', async () => {
		vi.spyOn(git_gh_repo, 'repo_get_name_with_owner').mockResolvedValue(TARGET)
		const find_open = vi.spyOn(issue_release_cli, 'find_open').mockResolvedValue(RELEASE_ISSUE)

		const request = await release_request.read()

		expect(request.release_issue).toContain(`${TARGET}/issues/${String(RELEASE_ISSUE)}`)
		expect(find_open).toHaveBeenCalledWith(TARGET)
	})

	it('reports unknown without a lookup when the repository is unreadable', async () => {
		vi.spyOn(git_gh_repo, 'repo_get_name_with_owner').mockResolvedValue(undefined)
		const find_open = vi.spyOn(issue_release_cli, 'find_open')

		await expect(release_request.read()).resolves.toMatchObject({
			release_issue: release_request.UNKNOWN,
		})
		expect(find_open).not.toHaveBeenCalled()
	})
})
