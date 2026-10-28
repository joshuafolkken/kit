import type { LaunchResult } from '#scripts/run/detached-launch'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { TREE, run_mock, read_mock, on_tree_mock, launch_mock, steps_clear_mock } = vi.hoisted(
	() => ({
		TREE: 'tree-digest',
		run_mock: vi.fn<(list: ReadonlyArray<string>) => Promise<Record<string, unknown>>>(),
		read_mock: vi.fn<(token: string) => PinnedSummary | undefined>(),
		on_tree_mock: vi.fn<() => Promise<PinnedSummary | undefined>>(),
		launch_mock: vi.fn<(root: string, tree?: string) => LaunchResult>(),
		steps_clear_mock: vi.fn<() => void>(),
	}),
)

vi.mock('#scripts/run/review/run-review-pinned-join', () => ({
	run_review_pinned_join: { answer_on_tree: on_tree_mock },
}))
vi.mock('#scripts/run/review/run-review-pinned-steps', () => ({
	run_review_pinned_steps: { clear: steps_clear_mock, launch_remaining: launch_mock },
}))
vi.mock('#scripts/run/review/run-review-pinned-tree', () => ({
	run_review_pinned_tree: { key: async () => TREE },
}))
vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: { run_buffered_process: run_mock },
}))
vi.mock('./run-ship-pre-detach', () => ({
	run_ship_pre_detach: { checks: async () => ({ code: 0, out: '' }) },
}))
vi.mock(import('#scripts/test/test-pinned-record'), async (import_original) => {
	const original = await import_original()

	return { test_pinned_record: { ...original.test_pinned_record, read: read_mock, clear: vi.fn() } }
})
// No git directory, so no accepted reason is recorded or read (`run-review-pinned-accepted.ts`).
vi.mock('#scripts/git/git-command', () => ({ git_command: { git_directories: async () => [] } }))

const { run_ship_pre_detach_pinned } = await import('./run-ship-pre-detach-pinned')

// joshuafolkken/kit#5327: a pre-detach that stops at its first unpinned hunk leaves the rest probing
// in the background, on the stamp the next pre-detach joins and `clear` discards.

const FAILED = 1
const UNPINNED: PinnedSummary = {
	text: 'unpinned 1 · unchecked 0\nunpinned scripts/issue/issue-file-cli.ts:49\n',
	unpinned: ['scripts/issue/issue-file-cli.ts 0123456789abcdef'],
}
const CUT: PinnedSummary = { ...UNPINNED, is_cut: true, remaining: 3 }
const NOTE = 'in the background'

async function stopped_out(): Promise<string> {
	const result = await run_ship_pre_detach_pinned.pinned_check({ number: '5327', unpinned_ok: [] })

	expect(result.code).toBe(FAILED)

	return result.out
}

beforeEach(() => {
	run_mock.mockReset().mockResolvedValue({ output: '', exit_code: 0 })
	read_mock.mockReset().mockReturnValue(CUT)
	on_tree_mock.mockReset().mockResolvedValue(undefined)
	launch_mock.mockReset().mockReturnValue({ kind: 'launched', pid: 1 })
	steps_clear_mock.mockReset()
})

describe('run_ship_pre_detach_pinned.pinned_check on a cut answer', () => {
	it('still stops, and launches the rest on this tree with their count printed', async () => {
		expect(await stopped_out()).toContain(`probing 3 remaining hunks ${NOTE}`)
		expect(steps_clear_mock).toHaveBeenCalledOnce()
		expect(launch_mock).toHaveBeenCalledWith(expect.any(String), TREE)
	})

	it("goes on past the run:review check's cut answer as well, running no probe of its own", async () => {
		on_tree_mock.mockResolvedValue(CUT)

		await stopped_out()

		expect(run_mock).not.toHaveBeenCalled()
		expect(launch_mock).toHaveBeenCalledOnce()
	})

	it('prints no note when the launch failed', async () => {
		launch_mock.mockReturnValue({ kind: 'failed', note: 'no spawn' })

		expect(await stopped_out()).not.toContain(NOTE)
	})

	it('still stops with no note when the launch threw', async () => {
		launch_mock.mockImplementation(() => {
			throw new Error('git failed')
		})

		expect(await stopped_out()).not.toContain(NOTE)
	})

	it('launches nothing on an answer that probed every hunk', async () => {
		read_mock.mockReturnValue(UNPINNED)

		expect(await stopped_out()).not.toContain(NOTE)
		expect(launch_mock).not.toHaveBeenCalled()
		expect(steps_clear_mock).not.toHaveBeenCalled()
	})
})

describe('run_ship_pre_detach_pinned.checks_for without --review', () => {
	it('stops the background probe it will not read', async () => {
		await run_ship_pre_detach_pinned.checks_for({
			number: '5327',
			is_review: false,
			unpinned_ok: [],
		})()

		expect(steps_clear_mock).toHaveBeenCalledOnce()
	})

	it('runs the checks when the clear throws', async () => {
		steps_clear_mock.mockImplementation(() => {
			throw new Error('kill failed')
		})

		const result = await run_ship_pre_detach_pinned.checks_for({
			number: '5327',
			is_review: false,
			unpinned_ok: [],
		})()

		expect(result.code).toBe(0)
	})
})
