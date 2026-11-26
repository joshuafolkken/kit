import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { run_mock, on_tree_mock, start_mock, read_mock } = vi.hoisted(() => ({
	run_mock: vi.fn<(list: ReadonlyArray<string>) => Promise<Record<string, unknown>>>(),
	on_tree_mock: vi.fn<() => Promise<PinnedSummary | undefined>>(),
	start_mock: vi.fn<() => Promise<{ kind: string }>>(),
	read_mock: vi.fn<() => Promise<PinnedSummary | undefined>>(),
}))

vi.mock('#scripts/run/review/run-review-pinned-join', () => ({
	run_review_pinned_join: { answer_on_tree: on_tree_mock },
}))
vi.mock('#scripts/run/review/run-review-pinned-remaining', () => ({
	run_review_pinned_remaining: { start: start_mock, read: read_mock },
}))
vi.mock('#scripts/test/test-pinned', () => ({
	test_pinned: { held_report: async () => undefined },
}))
vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: { run_buffered_process: run_mock },
}))
vi.mock('#scripts/review/review-round-reuse', () => ({
	review_round_reuse: { is_reusable_here: async () => true },
}))
vi.mock('#scripts/git/git-command', () => ({ git_command: { git_directories: async () => [] } }))

const { run_ship_pre_detach_pinned } = await import('./run-ship-pre-detach-pinned')

// joshuafolkken/kit#8981: under a reason, a cut answer on the checked tree is completed by the rest's
// probe on that tree, never by a whole `josh test:pinned` again.

const OK = 0
const REASON = 'a log line no test can observe'
const CUT: PinnedSummary = { text: 'unpinned 1 · unchecked 1\n', unpinned: ['a 01'], is_cut: true }
const REST: PinnedSummary = { text: 'unpinned 0 · unchecked 0\n', unpinned: [] }

async function check(): Promise<{ code: number; out: string }> {
	return await run_ship_pre_detach_pinned.pinned_check({
		number: '8981',
		unpinned_ok: [run_review_pinned.UNPINNED_OK_FLAG, REASON],
	})
}

beforeEach(() => {
	run_mock.mockReset().mockResolvedValue({ output: '', exit_code: OK })
	on_tree_mock.mockReset().mockResolvedValue(CUT)
	start_mock.mockReset().mockResolvedValue({ kind: 'launched' })
	read_mock.mockReset().mockResolvedValue(REST)
})

describe('run_ship_pre_detach_pinned.pinned_check under a reason on a cut answer', () => {
	it("judges the rest's answer and starts no check of its own", async () => {
		const result = await check()

		expect(result.code).toBe(OK)
		expect(result.out).toContain(REST.text)
		expect(start_mock).toHaveBeenCalledOnce()
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs its own check when the rest left no answer', async () => {
		read_mock.mockResolvedValue(undefined)

		await check()

		expect(run_mock).toHaveBeenCalledOnce()
	})

	it('runs its own check when the rest answer is still cut', async () => {
		read_mock.mockResolvedValue(CUT)

		await check()

		expect(run_mock).toHaveBeenCalledOnce()
	})
})
