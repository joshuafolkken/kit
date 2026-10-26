import { pre_push_related_switch } from '#scripts/hooks/pre-push-related-switch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_overlap } from './run-ship-overlap'

const merge_mock = vi.hoisted(() => vi.fn())
const josh_run_mock = vi.hoisted(() => vi.fn())
const pr_number_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-pr-read', () => ({ git_gh_pr_read: { pr_get_number: pr_number_mock } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { branch: async () => '5067-lane' } }))
vi.mock('#scripts/git/main-merge', () => ({ main_merge: { merge: merge_mock } }))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.spyOn(run_ship_overlap, 'await_overlap').mockResolvedValue(undefined)
const { run_ship_sync } = await import('./run-ship-sync')

// joshuafolkken/kit#5067: a merge the sync stage made is pushed before the gate, so CI and SonarQube
// run beside the gate, the commit and round 2 rather than after them — on an open pull request, the
// only place CI runs.

const OK = 0
const FAILED = 1
const TITLE = 'Push the sync merge ahead of the gate #5067'
const ISSUE = '5067'
const is_dirty = false
const PULL_NUMBER = 5080
const PUSH = ['git', '-y', '--skip-commit', '--skip-pr', TITLE]
const RELATED = { [pre_push_related_switch.SWITCH_ENV_KEY]: pre_push_related_switch.SWITCH_ON }

function commands(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	merge_mock.mockReset().mockResolvedValue({ kind: 'merged', branch: 'main' })
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	pr_number_mock.mockReset().mockResolvedValue(PULL_NUMBER)
})

describe('run_ship_sync.sync_stage — a merge is pushed ahead of the gate', () => {
	it('pushes the merged tree to the branch, and says so', async () => {
		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)).toStrictEqual({
			code: OK,
			out: `merged main\n${run_ship_sync.PUSHED_NOTE}`,
		})
		expect(commands()).toStrictEqual([PUSH])
	})

	it('asks the pre-push hook for the related tests rather than the whole suite', async () => {
		await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)

		expect(josh_run_mock).toHaveBeenCalledWith(PUSH, true, undefined, RELATED)
	})

	it('goes on to the gate when the push fails, naming the failure', async () => {
		josh_run_mock.mockResolvedValue({ code: FAILED, out: 'push rejected' })

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)).toStrictEqual({
			code: OK,
			out: `merged main\n${run_ship_sync.PUSH_FAILED_NOTE}\npush rejected`,
		})
	})
})

describe('run_ship_sync.sync_stage — nothing merged leaves the push to the commit stage', () => {
	it('pushes nothing when the default branch brings nothing in', async () => {
		merge_mock.mockResolvedValue({ kind: 'current', branch: 'main' })

		await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)

		expect(commands()).toStrictEqual([])
	})

	it('pushes nothing when the merge was refused', async () => {
		merge_mock.mockResolvedValue({ kind: 'refused', message: 'fetch failed' })

		await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)

		expect(commands()).toStrictEqual([])
	})

	it('pushes nothing when the branch has no open pull request, since CI would not run', async () => {
		pr_number_mock.mockResolvedValue(undefined)

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)).toStrictEqual({
			code: OK,
			out: 'merged main',
		})
		expect(commands()).toStrictEqual([])
	})

	it('pushes nothing when the pull request cannot be read', async () => {
		pr_number_mock.mockRejectedValue(new Error('gh api failed'))

		await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)

		expect(commands()).toStrictEqual([])
	})

	it('pushes nothing when the merge stopped on a conflict', async () => {
		merge_mock.mockResolvedValue({ kind: 'conflict', files: ['scripts/a.ts'] })

		await run_ship_sync.sync_stage(ISSUE, TITLE, is_dirty)

		expect(commands()).toStrictEqual([])
	})
})
