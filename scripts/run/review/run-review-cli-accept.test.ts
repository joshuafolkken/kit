import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_GREEN, GATE_RED, run_review, type GateState } from './run-review'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned } from './run-review-pinned'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4920: the reason given after the join stopped, on the tree it stopped on and its
// green gate, judges the finished answer, and neither the check nor the pair runs again.

vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: async () => 'not-required' } }
})

const FAILURE_EXIT_CODE = 1
const REASON = 'only logs'
const TREE = 'briefed-tree'
const OK_ARGV = [run_review_pinned.UNPINNED_OK_FLAG, REASON]
const UNPINNED: PinnedSummary = { text: 'unpinned a.ts:1\n', unpinned: ['a.ts 0123456789abcdef'] }
const CLEAR: PinnedSummary = { text: 'unpinned 0\n', unpinned: [] }
const RECHECKS: ReadonlyArray<[string, PinnedSummary | undefined, GateState]> = [
	['the tree moved', undefined, GATE_GREEN],
	['the gate is not green', UNPINNED, GATE_RED],
	['the answer was clear, so the join stopped on nothing', CLEAR, GATE_GREEN],
]

interface Spied {
	mock: { calls: ReadonlyArray<unknown> }
}

function spy_starts(): ReadonlyArray<Spied> {
	return [
		vi.spyOn(run_review_pinned_steps, 'clear').mockReturnValue(undefined),
		vi.spyOn(run_review_pinned_steps, 'launch').mockReturnValue({ kind: 'launched', pid: 1 }),
		vi.spyOn(run_review_steps, 'launch_gate').mockReturnValue({ kind: 'failed', note: 'busy' }),
	]
}

beforeEach(() => {
	vi.spyOn(review_brief_cli, 'scoped_refusal').mockResolvedValue(undefined)
	vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(TREE)
	vi.spyOn(process.stderr, 'write').mockReturnValue(true)
	vi.spyOn(git_command, 'git_directories').mockResolvedValue([])
	vi.spyOn(run_review_pinned_steps, 'carry_reason').mockReturnValue(undefined)
	vi.spyOn(run_review_steps, 'read_gate_state').mockResolvedValue(GATE_GREEN)
	vi.spyOn(run_review_pinned_steps, 'launched_reason').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run with --unpinned-ok after the join stopped on this tree', () => {
	it('accepts the finished answer with the reason and starts nothing', async () => {
		vi.spyOn(run_review_pinned_join, 'finished_on_tree').mockResolvedValue(UNPINNED)
		const started = spy_starts()

		expect(await run_review_cli.run(OK_ARGV)).toBe(0)
		expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(REASON))
		expect(run_review_pinned_steps.carry_reason).toHaveBeenCalledWith(REASON)
		expect(started.filter((spy) => spy.mock.calls.length > 0)).toStrictEqual([])
	})

	// joshuafolkken/kit#5153: a check cut at its first unpinned hunk listed only that one.
	it('launches only the whole check under the reason over an answer cut at its first unpinned hunk', async () => {
		vi.spyOn(run_review_pinned_join, 'finished_on_tree').mockResolvedValue({
			...UNPINNED,
			is_cut: true,
		})
		spy_starts()

		expect(await run_review_cli.run(OK_ARGV)).toBe(0)
		expect(run_review_pinned_steps.launch).toHaveBeenCalledWith(PROJECT_ROOT, REASON, TREE)
		expect(run_review_steps.launch_gate).not.toHaveBeenCalled()
		expect(run_review_pinned_steps.carry_reason).not.toHaveBeenCalled()
	})

	it.each(RECHECKS)('checks again when %s', async (_label, answer, gate) => {
		vi.spyOn(run_review_pinned_join, 'finished_on_tree').mockResolvedValue(answer)
		vi.mocked(run_review_steps.read_gate_state).mockResolvedValue(gate)
		spy_starts()

		expect(await run_review_cli.run(OK_ARGV)).toBe(FAILURE_EXIT_CODE)
		expect(run_review_pinned_steps.launch).toHaveBeenCalledWith(PROJECT_ROOT, REASON, TREE)
		expect(run_review_pinned_steps.carry_reason).not.toHaveBeenCalled()
	})
})

describe('run with --unpinned-ok — what never takes the finished answer', () => {
	it('opens a new round over a check launched under a reason, which stopped nothing', async () => {
		vi.spyOn(run_review_pinned_join, 'finished_on_tree').mockResolvedValue(UNPINNED)
		vi.mocked(run_review_pinned_steps.launched_reason).mockReturnValue(REASON)
		spy_starts()

		expect(await run_review_cli.run(OK_ARGV)).toBe(FAILURE_EXIT_CODE)
		expect(run_review_pinned_steps.launch).toHaveBeenCalledWith(PROJECT_ROOT, REASON, TREE)
	})

	it('refuses a blank reason with the usage line rather than accepting the answer', async () => {
		const finished = vi.spyOn(run_review_pinned_join, 'finished_on_tree')

		expect(await run_review_cli.run([run_review_pinned.UNPINNED_OK_FLAG, '  '])).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(finished).not.toHaveBeenCalled()
	})

	it("passes over the ship's own --code-only open, which needs the brief", async () => {
		const finished = vi.spyOn(run_review_pinned_join, 'finished_on_tree')

		spy_starts()
		await run_review_cli.run([run_review.CODE_ONLY_FLAG, ...OK_ARGV])

		expect(finished).not.toHaveBeenCalled()
	})
})
