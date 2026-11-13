import { performance } from 'node:perf_hooks'
import { epic_cross_repo } from '#scripts/epic/epic-cross-repo'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_live } from '#scripts/epic/epic-live'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { issue_publication_state } from '#scripts/issue/issue-publication-state'
import { propagate_publish } from '#scripts/propagate/propagate-publish'
import { run_label } from '#scripts/run/run-label'
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest'
import { lane_dispatch_dependency } from './lane-dispatch-dependency'
import { lane_state } from './lane-state'

const REPO = 'joshuafolkken/kit'
const ISSUE = 7427
const BLOCKER = 7422
const NATIVE_LISTING = 'native listing'
const WAIT_KIND = 'dependency-wait'
const read = vi.spyOn(epic_live, 'child')
const blockers = vi.spyOn(epic_live, 'blockers')

function child(number: number, state: EpicChild['state'] = 'OPEN'): EpicChild {
	return { number, repo: REPO, state, labels: [], body: '', blocked_by: [] }
}

beforeEach(() => {
	epic_cross_repo.reset_publish_cache()
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	read.mockImplementation(async (number) => child(number))
	blockers.mockResolvedValue([])
})

afterEach(() => vi.clearAllMocks())
afterAll(() => vi.restoreAllMocks())

it('withholds a blocker added after selection and starts after its live state becomes closed', async () => {
	blockers.mockResolvedValue([{ number: BLOCKER, repo: REPO, state: 'CLOSED' }])
	expect(await lane_dispatch_dependency.check(String(ISSUE))).toMatchObject({
		kind: WAIT_KIND,
	})
	read.mockImplementation(async (number) => child(number, number === BLOCKER ? 'CLOSED' : 'OPEN'))
	expect(await lane_dispatch_dependency.check(String(ISSUE))).toBeUndefined()
	expect(read).toHaveBeenCalledWith(BLOCKER, REPO)
})

it.each([NATIVE_LISTING, 'blocker state'])(
	'waits rather than launching on an unreadable %s',
	async (stage) => {
		blockers.mockResolvedValue([{ number: BLOCKER, repo: REPO }])
		if (stage === NATIVE_LISTING) blockers.mockRejectedValue(new Error('offline'))
		else read.mockRejectedValueOnce(new Error('offline'))
		expect(await lane_dispatch_dependency.check(String(ISSUE))).toMatchObject({
			reason: expect.stringContaining('unknown dependency state'),
		})
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('offline'))
	},
)

it('refuses direct dispatch of a prepared child before reading relations', async () => {
	read.mockResolvedValue({
		...child(ISSUE),
		body: issue_publication_state.prepare('Plan', ['auto-ok']),
	})
	expect(await lane_dispatch_dependency.check(String(ISSUE))).toMatchObject({
		reason: 'publication is pending',
	})
	expect(blockers).not.toHaveBeenCalled()
})

it('limits reads to the target and its blockers and measures the confirmation duration', async () => {
	vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(125)
	blockers.mockResolvedValue([{ number: BLOCKER, repo: REPO }])
	await lane_dispatch_dependency.check(String(ISSUE))
	expect(read.mock.calls).toEqual([
		[ISSUE, REPO],
		[BLOCKER, REPO],
	])
	expect(blockers).toHaveBeenCalledExactlyOnceWith(ISSUE, REPO)
	expect(console.error).toHaveBeenCalledWith(expect.stringContaining('(25 ms)'))
})

it('releases the in-progress claim when a resume is withheld', async () => {
	vi.spyOn(lane_state, 'record_change').mockResolvedValue({ kind: 'skipped', reason: 'fixture' })
	const unmark = vi.spyOn(run_label, 'unmark').mockResolvedValue(true)

	await lane_dispatch_dependency.defer(String(ISSUE))
	expect(unmark).toHaveBeenCalledWith(String(ISSUE))
})

it('revalidates a cross-repository release instead of reusing the selection cache', async () => {
	const external = { ...child(BLOCKER, 'CLOSED'), repo: 'joshuafolkken/app-kit' }
	const manifest = vi
		.spyOn(git_gh_exec, 'read_gh_api_sync')
		.mockReturnValue('{"version":"1.0.0","private":false}')

	vi.spyOn(propagate_publish, 'fetch_published_versions').mockReturnValue(['1.0.0'])
	expect(epic_cross_repo.resolve_cross_repo(external, child(ISSUE))).toBe('resolved')
	manifest.mockReturnValue('{"version":"2.0.0","private":false}')
	blockers.mockResolvedValue([{ number: BLOCKER, repo: external.repo }])
	read.mockImplementation(async (number) => (number === ISSUE ? child(number) : external))
	expect(await lane_dispatch_dependency.check(String(ISSUE))).toMatchObject({
		kind: WAIT_KIND,
	})
})
