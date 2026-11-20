import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { run_review_pinned } from '#scripts/run/review/run-review-pinned'
import type { PinnedReport } from '#scripts/test/test-pinned-logic'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { launch_mock, on_tree_mock, held_mock, reusable_mock } = vi.hoisted(() => ({
	launch_mock: vi.fn<(root?: string, reason?: string) => Promise<void>>(),
	on_tree_mock: vi.fn<() => Promise<PinnedSummary | undefined>>(),
	held_mock: vi.fn<(max_hunks: number) => Promise<PinnedReport | undefined>>(),
	reusable_mock: vi.fn<(issue: number) => Promise<boolean>>(),
}))

vi.mock('#scripts/run/review/run-review-pinned-join', () => ({
	run_review_pinned_join: { answer_on_tree: on_tree_mock, launch_on_tree: launch_mock },
}))
vi.mock('#scripts/test/test-pinned', () => ({ test_pinned: { held_report: held_mock } }))
vi.mock('#scripts/review/review-round-reuse', () => ({
	review_round_reuse: { is_reusable_here: reusable_mock },
}))
// No git directory, so no accepted reason is recorded or read (`run-review-pinned-accepted.ts`).
vi.mock('#scripts/git/git-command', () => ({ git_command: { git_directories: async () => [] } }))

const { run_ship_pre_detach_pinned } = await import('./run-ship-pre-detach-pinned')

// joshuafolkken/kit#8271: the recheck's `is_launching` starts the tree's check only where
// `pinned_check` reads it, so no launched check is left running unread through the ship.

const ISSUE = '8271'
const REASON = 'a log line no test can observe'
const UNPINNED_OK = [run_review_pinned.UNPINNED_OK_FLAG, REASON]
const CLEAR: PinnedSummary = { text: 'unpinned 0 · unchecked 0\n', unpinned: [] }
const HELD: PinnedReport = {
	unpinned: [],
	stopped: [],
	is_held: true,
	unchecked: [],
	unparsed: [],
	max_hunks: 1,
	has_runner: true,
}

async function launching(unpinned_ok: ReadonlyArray<string>): Promise<void> {
	await run_ship_pre_detach_pinned.pinned_check({ number: ISSUE, unpinned_ok, is_launching: true })
}

beforeEach(() => {
	launch_mock.mockResolvedValue()
	on_tree_mock.mockResolvedValue(CLEAR)
	held_mock.mockResolvedValue(undefined)
	reusable_mock.mockResolvedValue(true)
})

describe('run_ship_pre_detach_pinned.pinned_check with is_launching', () => {
	it('launches the check on the tree before reading its answer', async () => {
		const order: Array<string> = []

		launch_mock.mockImplementation(async () => {
			order.push('launch')
		})
		on_tree_mock.mockImplementation(async () => {
			order.push('read')

			return CLEAR
		})

		await launching([])

		expect(order).toStrictEqual(['launch', 'read'])
		expect(launch_mock).toHaveBeenCalledWith(PROJECT_ROOT, undefined)
	})

	it('launches under the reason when the supervisor reuses round 1', async () => {
		await launching(UNPINNED_OK)

		expect(launch_mock).toHaveBeenCalledWith(PROJECT_ROOT, REASON)
	})

	it('launches nothing when a reason skips the check for a fresh round 1', async () => {
		reusable_mock.mockResolvedValue(false)

		await launching(UNPINNED_OK)

		expect(launch_mock).not.toHaveBeenCalled()
	})

	it('launches nothing when the cache answers under the reason', async () => {
		held_mock.mockResolvedValue(HELD)

		await launching(UNPINNED_OK)

		expect(launch_mock).not.toHaveBeenCalled()
		expect(on_tree_mock).not.toHaveBeenCalled()
	})

	it('launches nothing without is_launching', async () => {
		await run_ship_pre_detach_pinned.pinned_check({ number: ISSUE, unpinned_ok: [] })

		expect(launch_mock).not.toHaveBeenCalled()
		expect(on_tree_mock).toHaveBeenCalledOnce()
	})
})
