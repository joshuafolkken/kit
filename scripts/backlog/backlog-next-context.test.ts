import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { OpenListing } from '#scripts/git/git-schemas'
import { lane_net_read } from '#scripts/lane/lane-net-read'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#8220: the tracking, the repository and the measurements are read side by side, and
// a failure is still reported tracking first.

const OPTED_IN = { kind: 'read' as const, issues: [], cutoff: 'none' as const }
const OPEN: OpenListing = { rows: [], is_capped: false }
const REPO = 'owner/repo'

const errors: Array<string> = []

// joshuafolkken/kit#9007: the failures go to the caller's port, which `run:board` leaves silent.
function report(line: string): void {
	errors.push(line)
}

beforeEach(() => {
	errors.length = 0
	vi.spyOn(auto_ok_cli, 'fetch_tracking').mockResolvedValue({
		kind: 'read',
		index: new Map(),
		cutoff: 'none',
	})
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(lane_net_read, 'measurements').mockResolvedValue({
		implement_rate: undefined,
		growth: {},
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_next.context_of', () => {
	it('hands the open listing to the tracking read', async () => {
		const context = await backlog_next.context_of(OPTED_IN, [], report, OPEN)

		expect(context?.repo).toBe(REPO)
		expect(auto_ok_cli.fetch_tracking).toHaveBeenCalledWith(0, OPEN)
	})

	it('reports only the unreadable tracking when the repository fails too', async () => {
		vi.mocked(auto_ok_cli.fetch_tracking).mockResolvedValue({ kind: 'epics_unreadable' })
		vi.mocked(git_gh_command.repo_get_name_with_owner).mockResolvedValue(undefined)

		await expect(backlog_next.context_of(OPTED_IN, [], report)).resolves.toBeUndefined()
		expect(errors).toStrictEqual([auto_ok_cli.EPICS_UNREADABLE_MESSAGE])
	})

	it('reports an unreadable repository', async () => {
		vi.mocked(git_gh_command.repo_get_name_with_owner).mockResolvedValue(undefined)

		await expect(backlog_next.context_of(OPTED_IN, [], report)).resolves.toBeUndefined()
		expect(errors).toStrictEqual([backlog_next.REPO_UNREADABLE_MESSAGE])
	})
})
