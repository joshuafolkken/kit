import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const merge_mock = vi.hoisted(() => vi.fn())
const josh_run_mock = vi.hoisted(() => vi.fn())
const scoped_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-pr-read', () => ({ git_gh_pr_read: { pr_get_number: async () => 1 } }))
vi.mock('#scripts/gh/git-gh-code-scanning', () => ({
	git_gh_code_scanning: { own_alerts_note: async () => undefined },
}))
vi.mock('#scripts/git/git-command', () => ({ git_command: { branch: async () => '6675-lane' } }))
vi.mock('#scripts/git/main-merge', () => ({ main_merge: { merge: merge_mock } }))
vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('./run-ship-scoped', () => ({ run_ship_scoped: { scoped_gate: scoped_mock } }))
const { run_ship_sync } = await import('./run-ship-sync')

// joshuafolkken/kit#6675: a followup red after the default branch moved takes the in-ship short path —
// merge, gate, push, followup again — and says so on the ship log; any other red stands as before.

const OK = 0
const FAILED = 1
const TITLE = 'Resume followup after a main move #6675'
const CHECKS_RED = { code: FAILED, out: 'PR checks failed (failed checks: Unit Tests (1/6)).' }
const REVIEW_BLOCKED = { code: FAILED, out: 'PR checks failed (review requested changes).' }
const GATE_RED = { code: FAILED, out: 'byte budget: docs/josh-commands-run.md is over its ceiling' }
const MERGED = { kind: 'merged', branch: 'main' }
const CURRENT = { kind: 'current', branch: 'main' }
const FOLLOWUP = ['followup', TITLE]
const PUSH = ['git', '-y', '--skip-commit', '--skip-pr', TITLE]

function commands(): ReadonlyArray<ReadonlyArray<string>> {
	return josh_run_mock.mock.calls.map((call) => call[0] as ReadonlyArray<string>)
}

beforeEach(() => {
	vi.spyOn(console, 'error').mockReturnValue()
	merge_mock.mockReset().mockResolvedValue(MERGED)
	josh_run_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
	scoped_mock.mockReset().mockResolvedValue({ code: OK, out: '' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_sync.followup_stage — the short path after a main move', () => {
	it('merges, gates, pushes and waits again, saying so once on the ship log', async () => {
		josh_run_mock.mockResolvedValueOnce(CHECKS_RED)

		expect(await run_ship_sync.followup_stage(TITLE, [])).toMatchObject({ code: OK })
		expect(commands()).toStrictEqual([FOLLOWUP, PUSH, FOLLOWUP])
		expect(console.error).toHaveBeenCalledOnce()
		expect(console.error).toHaveBeenCalledWith(run_ship_sync.MERGED_AGAIN_NOTE)
	})

	it('stops before the push when the merged tree is red, the gate not weakened', async () => {
		josh_run_mock.mockResolvedValueOnce(CHECKS_RED)
		scoped_mock.mockResolvedValue(GATE_RED)

		expect(await run_ship_sync.followup_stage(TITLE, [])).toMatchObject({
			code: FAILED,
			cause: 'check',
		})
		expect(commands()).toStrictEqual([FOLLOWUP])
		expect(console.error).toHaveBeenCalledWith(run_ship_sync.MERGED_AGAIN_NOTE)
	})
})

describe('run_ship_sync.followup_stage — the old path, with no short-path line', () => {
	it('keeps the red when the default branch has not moved', async () => {
		josh_run_mock.mockResolvedValueOnce(CHECKS_RED)
		merge_mock.mockResolvedValue(CURRENT)

		expect(await run_ship_sync.followup_stage(TITLE, [])).toStrictEqual(CHECKS_RED)
		expect(console.error).not.toHaveBeenCalled()
	})

	it('keeps a red that no merge can change, merging nothing', async () => {
		josh_run_mock.mockResolvedValueOnce(REVIEW_BLOCKED)

		expect(await run_ship_sync.followup_stage(TITLE, [])).toStrictEqual(REVIEW_BLOCKED)
		expect(merge_mock).not.toHaveBeenCalled()
		expect(console.error).not.toHaveBeenCalled()
	})
})
