import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_release_cli, NONE } from '#scripts/issue/issue-release-cli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { release_issue_close } from './release-issue-close'

// joshuafolkken/kit#3825: a published release closes its open release Issue, with the version, and
// carries the blockers it did not publish to the next one.

const REPO = 'joshuafolkken/kit'
const RELEASE_ISSUE = 3709
const VERSION = '1.1435.0'
const MERGED_BLOCKER = 3800
const OPEN_BLOCKER = 3801
const SECOND_OPEN_BLOCKER = 3802

type OpenAnswer = Awaited<ReturnType<typeof issue_release_cli.find_open>>

function relations_json(open_blockers: ReadonlyArray<number>): string {
	const open_nodes = open_blockers.map((number) => ({ number, state: 'OPEN' }))
	const nodes = [{ number: MERGED_BLOCKER, state: 'CLOSED' }, ...open_nodes]

	return JSON.stringify({ state: 'OPEN', blockedBy: { nodes, totalCount: nodes.length } })
}

function given(repo: string | undefined, open: OpenAnswer): void {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(repo)
	vi.spyOn(issue_release_cli, 'find_open').mockResolvedValue(open)
}

function given_relations(json: string | undefined): void {
	vi.mocked(git_gh_command.issue_get_state_and_relations).mockResolvedValue(json)
}

beforeEach(() => {
	vi.spyOn(git_gh_command, 'issue_close').mockResolvedValue(true)
	vi.spyOn(git_gh_command, 'issue_get_state_and_relations').mockResolvedValue(relations_json([]))
	vi.spyOn(issue_release_cli, 'link').mockResolvedValue(true)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_issue_close.close_published', () => {
	it('closes the open release Issue with a comment naming the published version', async () => {
		given(REPO, RELEASE_ISSUE)
		await release_issue_close.close_published(VERSION)

		expect(issue_release_cli.find_open).toHaveBeenCalledWith(REPO)
		expect(git_gh_command.issue_close).toHaveBeenCalledWith(
			String(RELEASE_ISSUE),
			expect.stringContaining(`v${VERSION}`),
		)
		expect(issue_release_cli.link).not.toHaveBeenCalled()
	})

	it('closes nothing when no release Issue is open', async () => {
		given(REPO, NONE)
		await release_issue_close.close_published(VERSION)

		expect(git_gh_command.issue_close).not.toHaveBeenCalled()
	})

	it('closes nothing and warns when the listing is unreadable', async () => {
		given(REPO, undefined)
		await release_issue_close.close_published(VERSION)

		expect(git_gh_command.issue_close).not.toHaveBeenCalled()
		expect(console.warn).toHaveBeenCalledOnce()
	})

	it('closes nothing and warns when the repository is unreadable', async () => {
		given(undefined, RELEASE_ISSUE)
		await release_issue_close.close_published(VERSION)

		expect(issue_release_cli.find_open).not.toHaveBeenCalled()
		expect(git_gh_command.issue_close).not.toHaveBeenCalled()
		expect(console.warn).toHaveBeenCalledOnce()
	})
})

// A blocker still open at publish has not merged, so the release did not carry it.
describe('release_issue_close.close_published — the unmerged blockers', () => {
	it('links each unmerged blocker to the next release Issue once the published one closes', async () => {
		given(REPO, RELEASE_ISSUE)
		given_relations(relations_json([OPEN_BLOCKER, SECOND_OPEN_BLOCKER]))
		await release_issue_close.close_published(VERSION)

		expect(git_gh_command.issue_close).toHaveBeenCalledOnce()
		expect(vi.mocked(issue_release_cli.link).mock.calls).toStrictEqual([
			[OPEN_BLOCKER, REPO],
			[SECOND_OPEN_BLOCKER, REPO],
		])
	})

	it('warns rather than throws, and carries no blocker, when the close is refused', async () => {
		given(REPO, RELEASE_ISSUE)
		given_relations(relations_json([OPEN_BLOCKER]))
		vi.mocked(git_gh_command.issue_close).mockResolvedValue(false)

		await expect(release_issue_close.close_published(VERSION)).resolves.toBeUndefined()
		expect(console.warn).toHaveBeenCalledOnce()
		expect(issue_release_cli.link).not.toHaveBeenCalled()
	})

	it.each([
		['unreadable', undefined],
		['malformed', '{"blockedBy":{"nodes":"none"}}'],
	])('leaves it open and warns when its blockers are %s', async (_label, json) => {
		given(REPO, RELEASE_ISSUE)
		given_relations(json)
		await release_issue_close.close_published(VERSION)

		expect(git_gh_command.issue_close).not.toHaveBeenCalled()
		expect(console.warn).toHaveBeenCalledOnce()
	})
})
