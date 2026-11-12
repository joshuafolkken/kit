import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const merge_mock = vi.hoisted(() => vi.fn())
const josh_run_mock = vi.hoisted(() => vi.fn())
const scoped_mock = vi.hoisted(() => vi.fn())
const green_mock = vi.hoisted(() => vi.fn())
const conflicts_mock = vi.hoisted(() => vi.fn())
const default_branch_mock = vi.hoisted(() => vi.fn())
const behind_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/main-merge', () => ({ main_merge: { merge: merge_mock } }))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('./run-ship-scoped', () => ({
	run_ship_scoped: { scoped_gate: scoped_mock, is_gate_green: green_mock },
}))
vi.mock('./run-ship-conflict-probe', () => ({
	run_ship_conflict_probe: { read_conflicts: conflicts_mock },
}))
vi.mock('#scripts/git/git-command', () => ({
	git_command: { get_default_branch: default_branch_mock, commit_count_beyond: behind_mock },
}))
const { run_ship_sync } = await import('./run-ship-sync')

// joshuafolkken/kit#4825: before the commit stage pushes, a default branch that moved since the sync
// stage is merged again and the merged tree gated. joshuafolkken/kit#7058 narrows it to a move the
// probe finds conflicting or cannot read; a clean move over a green gate is left to the merge ref's CI.

const OK = 0
const FAILED = 1
const CONFLICTED = ['docs/josh-commands-run.md']
const CURRENT = { kind: 'current', branch: 'main' }
const MERGED = { kind: 'merged', branch: 'main' }
const SCOPED_GREEN = { code: OK, out: 'scoped green' }
const GATE_RED = { code: FAILED, out: 'document over its byte cap' }
const BEHIND = 3

beforeEach(() => {
	merge_mock.mockReset().mockResolvedValue(CURRENT)
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	scoped_mock.mockReset().mockResolvedValue(SCOPED_GREEN)
	green_mock.mockReset().mockResolvedValue(true)
	// The probe cannot tell by default, so the merge-and-gate path runs as before joshuafolkken/kit#7058.
	conflicts_mock.mockReset().mockResolvedValue(undefined)
	default_branch_mock.mockReset().mockResolvedValue('main')
	behind_mock.mockReset().mockResolvedValue(BEHIND)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_sync.catch_up — a clean move left to the merge ref CI', () => {
	it('pushes without merging or gating when the probe finds no conflict', async () => {
		conflicts_mock.mockResolvedValue([])

		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(merge_mock).not.toHaveBeenCalled()
		expect(scoped_mock).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledExactlyOnceWith(run_ship_sync.LEFT_TO_CI_NOTE)
	})

	it('says nothing on the ship log when the default branch has not moved', async () => {
		conflicts_mock.mockResolvedValue([])
		behind_mock.mockResolvedValue(0)

		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(merge_mock).not.toHaveBeenCalled()
		expect(console.error).not.toHaveBeenCalled()
	})

	it('still stops on a conflict the probe finds, through the merge', async () => {
		conflicts_mock.mockResolvedValue(CONFLICTED)
		merge_mock.mockResolvedValue({ kind: 'conflict', files: CONFLICTED })

		const result = await run_ship_sync.catch_up()

		expect(result?.conflicts).toStrictEqual(CONFLICTED)
		expect(scoped_mock).not.toHaveBeenCalled()
	})

	it('merges and gates a tree with no green gate record without asking the probe', async () => {
		conflicts_mock.mockResolvedValue([])
		green_mock.mockResolvedValue(false)
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(conflicts_mock).not.toHaveBeenCalled()
		expect(scoped_mock).toHaveBeenCalledOnce()
	})
})

describe('run_ship_sync.catch_up — an unreadable commit count', () => {
	it('still says the skipped merge when the commit count cannot be read', async () => {
		conflicts_mock.mockResolvedValue([])
		behind_mock.mockRejectedValue(new Error('unknown revision'))

		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(console.error).toHaveBeenCalledExactlyOnceWith(run_ship_sync.LEFT_TO_CI_NOTE)
	})
})

describe('run_ship_sync.catch_up — a default branch that moved since the sync', () => {
	it('merges it again and gates the merged tree, going on when the gate is green', async () => {
		merge_mock.mockResolvedValue(MERGED)

		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(scoped_mock).toHaveBeenCalledOnce()
		expect(josh_run_mock).not.toHaveBeenCalled()
	})

	it('stops on a red gate over the merged tree, saying the default branch moved', async () => {
		merge_mock.mockResolvedValue(MERGED)
		scoped_mock.mockResolvedValue(GATE_RED)

		expect(await run_ship_sync.catch_up()).toStrictEqual({
			code: FAILED,
			out: `${run_ship_sync.MERGED_GATE_NOTE}\n${GATE_RED.out}`,
			cause: 'check',
		})
	})

	it('gates a tree with no green gate record even when the merge brought nothing in', async () => {
		green_mock.mockResolvedValue(false)
		scoped_mock.mockResolvedValue(GATE_RED)

		expect(await run_ship_sync.catch_up()).toMatchObject({ code: FAILED, cause: 'check' })
		expect(scoped_mock).toHaveBeenCalledOnce()
	})

	it('stops on a conflict, naming the unmerged paths', async () => {
		merge_mock.mockResolvedValue({ kind: 'conflict', files: CONFLICTED })

		const result = await run_ship_sync.catch_up()

		expect(result?.code).toBe(FAILED)
		expect(result?.conflicts).toStrictEqual(CONFLICTED)
		expect(scoped_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_sync.catch_up — nothing to catch up with', () => {
	it('merges nothing and re-runs no gate when the default branch has not moved', async () => {
		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(merge_mock).toHaveBeenCalledOnce()
		expect(scoped_mock).not.toHaveBeenCalled()
	})

	it('reads the green gate record once across the probe and the merge', async () => {
		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(green_mock).toHaveBeenCalledOnce()
	})

	it('leaves a refused merge to the followup rather than stopping the push', async () => {
		merge_mock.mockResolvedValue({ kind: 'refused', message: 'uncommitted work' })

		expect(await run_ship_sync.catch_up()).toBeUndefined()
		expect(scoped_mock).not.toHaveBeenCalled()
	})

	it('leaves a merge that could not be attempted to the followup', async () => {
		merge_mock.mockRejectedValue(new Error('fetch failed'))

		expect(await run_ship_sync.catch_up()).toBeUndefined()
	})
})
