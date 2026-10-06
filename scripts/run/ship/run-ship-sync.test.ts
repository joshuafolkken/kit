import { beforeEach, describe, expect, it, vi } from 'vitest'

const merge_mock = vi.hoisted(() => vi.fn())
const josh_run_mock = vi.hoisted(() => vi.fn())
const merge_state_mock = vi.hoisted(() => vi.fn())
const scoped_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/main-merge', () => ({ main_merge: { merge: merge_mock } }))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/gh/git-gh-pr-read', () => ({
	git_gh_pr_read: { pr_get_merge_state: merge_state_mock },
}))
vi.mock('#scripts/git/git-command', () => ({
	git_command: { branch: vi.fn().mockResolvedValue('3221-lane') },
}))
vi.mock('./run-ship-scoped', () => ({ run_ship_scoped: { scoped_gate: scoped_mock } }))

const { run_ship_sync } = await import('./run-ship-sync')

// joshuafolkken/kit#3221: `josh ship` merges the default branch again before the commit and on a
// conflicting pull request, and stops as `conflict` only on a merge git cannot finish.

const OK = 0
const FAILED = 1
const TITLE = 'Re-merge main #3221'
const NOTIFY = ['--notify-message-file', 'body.txt']
const CONFLICTED = ['scripts/a.ts', 'scripts/b.ts']
const CURRENT = { kind: 'current', branch: 'main' }
const MERGED = { kind: 'merged', branch: 'main' }
const CONFLICT = { kind: 'conflict', files: CONFLICTED }
const DIRTY = {
	is_merged: false,
	merged_at: undefined,
	head_sha: 'abc',
	merge_state_status: 'DIRTY',
}
const FOLLOWUP_FAILED = { code: FAILED, out: 'PR checks failed: merge conflict' }
const SCOPED_GREEN = { code: OK, out: 'scoped green' }
const GATE_RED = { code: FAILED, out: 'gate red' }
const PUSH_REJECTED = { code: FAILED, out: 'push rejected' }
const PUSH = ['git', '-y', '--skip-commit', '--skip-pr', TITLE]
const FOLLOWUP = ['followup', TITLE, ...NOTIFY]

function commands(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	merge_mock.mockReset().mockResolvedValue(CURRENT)
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	merge_state_mock.mockReset().mockResolvedValue(DIRTY)
	scoped_mock.mockReset().mockResolvedValue(SCOPED_GREEN)
})

describe('run_ship_sync.sync_stage — the merge before the commit', () => {
	it('goes on when the default branch brings nothing in', async () => {
		expect(await run_ship_sync.sync_stage()).toStrictEqual({
			code: OK,
			out: 'main brings nothing in',
		})
		expect(scoped_mock).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#3307: the gate stage after the sync checks the merged tree, so its record pins
	// the merge base the push carries.
	it('leaves the merged tree to the gate stage that follows, and goes on without stopping', async () => {
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.sync_stage()).toStrictEqual({ code: OK, out: 'merged main' })
		expect(scoped_mock).not.toHaveBeenCalled()
		expect(josh_run_mock).not.toHaveBeenCalled()
	})

	it('stops on a conflict, naming the unmerged paths', async () => {
		merge_mock.mockResolvedValue(CONFLICT)

		const result = await run_ship_sync.sync_stage()

		expect(result.code).toBe(FAILED)
		expect(result.conflicts).toStrictEqual(CONFLICTED)
		expect(result.out).toContain(run_ship_sync.CONFLICT_NOTE)
	})

	it('defers a refused merge to the followup rather than stopping the commit', async () => {
		merge_mock.mockResolvedValue({ kind: 'refused', message: 'uncommitted overlap' })

		expect(await run_ship_sync.sync_stage()).toMatchObject({ code: OK })
	})

	it('defers a merge that could not be attempted rather than throwing', async () => {
		merge_mock.mockRejectedValue(new Error('fetch failed'))

		expect(await run_ship_sync.sync_stage()).toMatchObject({ code: OK })
	})
})

describe('run_ship_sync.followup_stage — a pull request that turned conflicting', () => {
	it('returns a green followup as it is, merging nothing', async () => {
		expect(await run_ship_sync.followup_stage(TITLE, NOTIFY)).toMatchObject({ code: OK })
		expect(merge_mock).not.toHaveBeenCalled()
	})

	it('merges again on DIRTY, gates and pushes the clean merge and waits again', async () => {
		josh_run_mock.mockResolvedValueOnce(FOLLOWUP_FAILED)
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.followup_stage(TITLE, NOTIFY)).toMatchObject({ code: OK })
		expect(commands()).toStrictEqual([FOLLOWUP, PUSH, FOLLOWUP])
		expect(scoped_mock).toHaveBeenCalledOnce()
		expect(scoped_mock.mock.invocationCallOrder[0]).toBeLessThan(
			josh_run_mock.mock.invocationCallOrder[1] ?? 0,
		)
	})

	it('stops before the push when the gate over the merged tree is red', async () => {
		josh_run_mock.mockResolvedValueOnce(FOLLOWUP_FAILED)
		merge_mock.mockResolvedValue(MERGED)
		scoped_mock.mockResolvedValue(GATE_RED)

		expect(await run_ship_sync.followup_stage(TITLE, NOTIFY)).toStrictEqual(GATE_RED)
		expect(commands()).toStrictEqual([FOLLOWUP])
	})

	it('stops as a conflict only when the merge leaves unmerged paths', async () => {
		josh_run_mock.mockResolvedValueOnce(FOLLOWUP_FAILED)
		merge_mock.mockResolvedValue(CONFLICT)

		const result = await run_ship_sync.followup_stage(TITLE, NOTIFY)

		expect(result.conflicts).toStrictEqual(CONFLICTED)
		expect(result.out).toContain(FOLLOWUP_FAILED.out)
		expect(commands()).toStrictEqual([FOLLOWUP])
	})
})

describe('run_ship_sync.followup_stage — failures that are not merged again', () => {
	it('leaves a failure that is not a conflict as it was', async () => {
		josh_run_mock.mockResolvedValueOnce(FOLLOWUP_FAILED)
		merge_state_mock.mockResolvedValue({ ...DIRTY, merge_state_status: 'BLOCKED' })

		expect(await run_ship_sync.followup_stage(TITLE, NOTIFY)).toStrictEqual(FOLLOWUP_FAILED)
		expect(merge_mock).not.toHaveBeenCalled()
	})

	it('leaves the failure as it was when the pull request cannot be read', async () => {
		josh_run_mock.mockResolvedValueOnce(FOLLOWUP_FAILED)
		merge_state_mock.mockRejectedValue(new Error('rate limited'))

		expect(await run_ship_sync.followup_stage(TITLE, NOTIFY)).toStrictEqual(FOLLOWUP_FAILED)
	})

	it('stops on a failed push of the clean merge', async () => {
		josh_run_mock.mockResolvedValueOnce(FOLLOWUP_FAILED).mockResolvedValueOnce(PUSH_REJECTED)
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.followup_stage(TITLE, NOTIFY)).toStrictEqual(PUSH_REJECTED)
	})

	it('merges again a bounded number of times on a default branch that keeps moving', async () => {
		josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) =>
			argv[0] === 'followup' ? FOLLOWUP_FAILED : { code: OK, out: '' },
		)
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.followup_stage(TITLE, NOTIFY)).toStrictEqual(FOLLOWUP_FAILED)
		expect(merge_mock).toHaveBeenCalledTimes(run_ship_sync.MAX_MERGE_RETRIES)
	})
})
