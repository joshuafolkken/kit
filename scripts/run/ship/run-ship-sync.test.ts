import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_overlap } from './run-ship-overlap'

const merge_mock = vi.hoisted(() => vi.fn())
const josh_run_mock = vi.hoisted(() => vi.fn())
const merge_state_mock = vi.hoisted(() => vi.fn())
const scoped_mock = vi.hoisted(() => vi.fn())
const overlap_mock = vi.spyOn(run_ship_overlap, 'await_overlap')

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

// joshuafolkken/kit#3221: `josh ship` merges the default branch again before the gate and on a
// conflicting pull request, and stops as `conflict` only on a merge git cannot finish.

const OK = 0
const FAILED = 1
const TITLE = 'Re-merge main #3221'
const ISSUE = '3221'
const SHARED = 'scripts/shared.ts'
const WAITED = { issue: 3221, lanes: [3870], paths: [SHARED], waited_ms: 1, is_cleared: true }
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
const LOCAL_COMMIT = ['git', '-y', '--skip-push', '--skip-pr', TITLE]
const COMMIT_REFUSED = { code: FAILED, out: 'commit refused' }
const MERGED_NOTE = 'merged main'
// tree dirtiness as the probe read it
const tree = { is_dirty: false }
const FOLLOWUP = ['followup', TITLE, ...NOTIFY]
const SPAWN_FAILED = 'spawn failed'

function commands(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	merge_mock.mockReset().mockResolvedValue(CURRENT)
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	merge_state_mock.mockReset().mockResolvedValue(DIRTY)
	scoped_mock.mockReset().mockResolvedValue(SCOPED_GREEN)
	overlap_mock.mockReset().mockResolvedValue(undefined)
	tree.is_dirty = false
})

// joshuafolkken/kit#3901: the sync waits out an overlapping open pull request first, so the merge that
// follows brings that pull request in before the gate.
describe('run_ship_sync.sync_stage — the wait for an overlapping lane', () => {
	it('waits for the overlapping lane before merging, and says so', async () => {
		overlap_mock.mockImplementation(async () => {
			expect(merge_mock).not.toHaveBeenCalled()

			return WAITED
		})
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toStrictEqual({
			code: OK,
			out: `${run_ship_overlap.note(WAITED)}\nmerged main`,
		})
		expect(overlap_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('still names the wait when the merge after it stops on a conflict', async () => {
		overlap_mock.mockResolvedValue(WAITED)
		merge_mock.mockResolvedValue(CONFLICT)

		const result = await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)

		expect(result.out.startsWith(run_ship_overlap.note(WAITED))).toBe(true)
	})
})

describe('run_ship_sync.sync_stage — the merge before the commit', () => {
	it('goes on when the default branch brings nothing in', async () => {
		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toStrictEqual({
			code: OK,
			out: 'main brings nothing in',
		})
		expect(scoped_mock).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#3307: the gate stage after the sync checks the merged tree, so its record pins
	// the merge base the push carries.
	it('leaves the merged tree to the gate stage that follows, and goes on without stopping', async () => {
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toStrictEqual({
			code: OK,
			out: MERGED_NOTE,
		})
		expect(scoped_mock).not.toHaveBeenCalled()
		expect(josh_run_mock).not.toHaveBeenCalled()
	})

	it('stops on a conflict, naming the unmerged paths', async () => {
		merge_mock.mockResolvedValue(CONFLICT)

		const result = await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)

		expect(result.code).toBe(FAILED)
		expect(result.conflicts).toStrictEqual(CONFLICTED)
		expect(result.out).toContain(run_ship_sync.CONFLICT_NOTE)
	})

	it('defers a refused merge to the followup rather than stopping the ship', async () => {
		merge_mock.mockResolvedValue({ kind: 'refused', message: 'fetch refused' })

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toMatchObject({ code: OK })
	})

	it('defers a merge that could not be attempted rather than throwing', async () => {
		merge_mock.mockRejectedValue(new Error('fetch failed'))

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toMatchObject({ code: OK })
	})
})

// joshuafolkken/kit#4708: uncommitted work is committed locally before the merge, so a merge the guard
// would refuse is not deferred past the gate and the reviews to the followup.
describe('run_ship_sync.sync_stage — the local commit before the merge', () => {
	it('commits uncommitted work without pushing, then merges in the sync stage', async () => {
		tree.is_dirty = true
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toStrictEqual({
			code: OK,
			out: MERGED_NOTE,
		})
		expect(commands()).toStrictEqual([LOCAL_COMMIT])
		expect(josh_run_mock.mock.invocationCallOrder[0]).toBeLessThan(
			merge_mock.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('stops in the sync stage on a conflict after the local commit', async () => {
		tree.is_dirty = true
		merge_mock.mockResolvedValue(CONFLICT)

		const result = await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)

		expect(result.code).toBe(FAILED)
		expect(result.conflicts).toStrictEqual(CONFLICTED)
		expect(commands()).toStrictEqual([LOCAL_COMMIT])
	})

	it('stops before the merge when the local commit fails', async () => {
		tree.is_dirty = true
		josh_run_mock.mockResolvedValue(COMMIT_REFUSED)

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toStrictEqual(
			COMMIT_REFUSED,
		)
		expect(merge_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_sync.sync_stage — a failed local commit after an overlap wait', () => {
	it('keeps the overlap wait note ahead of a failed local commit', async () => {
		tree.is_dirty = true
		overlap_mock.mockResolvedValue(WAITED)
		josh_run_mock.mockResolvedValue(COMMIT_REFUSED)

		expect(await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)).toStrictEqual({
			...COMMIT_REFUSED,
			out: `${run_ship_overlap.note(WAITED)}\n${COMMIT_REFUSED.out}`,
		})
	})
})

describe('run_ship_sync.sync_stage — the local commit: no stash, nothing on a clean tree', () => {
	it('never stashes around the merge', async () => {
		tree.is_dirty = true

		await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)

		expect(commands().flat()).not.toContain('stash')
	})

	it('commits nothing on a clean tree', async () => {
		await run_ship_sync.sync_stage(ISSUE, TITLE, tree.is_dirty)

		expect(josh_run_mock).not.toHaveBeenCalled()
		expect(merge_mock).toHaveBeenCalledOnce()
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

// joshuafolkken/kit#4466: the lane holds no place only while `josh followup` waits, never while the
// followup stage merges and gates again.
describe('run_ship_sync.followup_stage — the merge wait mark', () => {
	it('marks the wait around each followup and takes it down before the gate', async () => {
		const marks: Array<string> = []

		josh_run_mock.mockImplementation(async (argv: ReadonlyArray<string>) => {
			marks.push(argv[0] ?? '')

			return marks.length === 2 ? FOLLOWUP_FAILED : { code: OK, out: '' }
		})
		scoped_mock.mockImplementation(async () => {
			marks.push('gate')

			return SCOPED_GREEN
		})
		merge_mock.mockResolvedValue(MERGED)

		await run_ship_sync.followup_stage(TITLE, NOTIFY, (is_waiting) => {
			marks.push(is_waiting ? 'wait' : 'clear')
		})

		expect(marks).toStrictEqual([
			'wait',
			'followup',
			'clear',
			'gate',
			'git',
			'wait',
			'followup',
			'clear',
		])
	})

	it('takes the wait down when the followup throws', async () => {
		const mark = vi.fn()

		josh_run_mock.mockRejectedValue(new Error(SPAWN_FAILED))

		await expect(run_ship_sync.followup_stage(TITLE, NOTIFY, mark)).rejects.toThrow(SPAWN_FAILED)
		expect(mark.mock.calls).toStrictEqual([[true], [false]])
	})
})
