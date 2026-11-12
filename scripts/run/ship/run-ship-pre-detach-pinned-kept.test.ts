import { run_review_pinned_accepted } from '#scripts/run/review/run-review-pinned-accepted'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShipArguments } from './run-ship-steps'

const make_directory = temporary_directory()

const { directories_mock, on_tree_mock } = vi.hoisted(() => ({
	directories_mock: vi.fn<() => Promise<ReadonlyArray<string>>>(),
	on_tree_mock: vi.fn<() => Promise<PinnedSummary | undefined>>(),
}))

vi.mock('#scripts/test/test-pinned', () => ({
	test_pinned: { held_report: async () => undefined },
}))
vi.mock('#scripts/run/review/run-review-pinned-join', () => ({
	run_review_pinned_join: { answer_on_tree: on_tree_mock },
}))
vi.mock('#scripts/run/review/run-review-pinned-steps', () => ({
	run_review_pinned_steps: { clear: vi.fn(), launch_remaining: () => ({ kind: 'failed' }) },
}))
vi.mock('#scripts/run/review/run-review-pinned-tree', () => ({
	run_review_pinned_tree: { key: async () => undefined },
}))
// A reused round 1 lists nothing after the detach, so the check judges the answer before it.
vi.mock('#scripts/review/review-round-reuse', () => ({
	review_round_reuse: { is_reusable_here: async () => true },
}))
vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: directories_mock, branch: async () => '6207-lane' },
}))

const { run_ship_pre_detach_pinned } = await import('./run-ship-pre-detach-pinned')

// joshuafolkken/kit#6207: a round-1 fix moved the tree, `--join` judged nothing on it, and the check
// `run:review` restarted there answered the ship's pre-detach with an unpinned place. The reason the
// round was opened with is recorded at the launch, so the ship given none carries it and goes on; a
// branch that gave none still stops.

const OK = 0
const FAILED = 1
const REASON = 'a log line no test can observe'
const SITE_LINE = 'unpinned scripts/issue/issue-file-cli.ts:49'
const RESTARTED: PinnedSummary = {
	text: `unpinned 1 · unchecked 0\n${SITE_LINE}\n`,
	unpinned: ['scripts/issue/issue-file-cli.ts 0123456789abcdef'],
}
const SHIP_ARGS: ShipArguments = {
	title: 'Ship #6207',
	number: '6207',
	notify: [],
	body: [],
	body_path: undefined,
	cites: [],
	is_review: true,
	is_detach: true,
	unpinned_ok: [],
}

const scratch = { directory: '' }

beforeEach(() => {
	scratch.directory = make_directory('run-ship-pre-detach-pinned-kept-')
	directories_mock.mockResolvedValue([scratch.directory])
	on_tree_mock.mockResolvedValue(RESTARTED)
})

async function shipped(): Promise<{ code: number; out: string }> {
	const args = await run_ship_pre_detach_pinned.with_recorded_reason(SHIP_ARGS)

	return await run_ship_pre_detach_pinned.pinned_check(args)
}

describe('the ship after the restarted check, under the reason run:review was opened with', () => {
	it('goes on, listing the unpinned place under the carried reason', async () => {
		await run_review_pinned_accepted.keep_reason(REASON)

		const result = await shipped()

		expect(result.code).toBe(OK)
		expect(result.out).toContain(SITE_LINE)
		expect(result.out).toContain(REASON)
	})

	it('stops on the unpinned place on a branch whose round gave no reason', async () => {
		const result = await shipped()

		expect(result.code).toBe(FAILED)
		expect(result.out).toContain(SITE_LINE)
	})
})
