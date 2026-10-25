import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review } from './run-review'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4647: `--unpinned-ok "<reason>"` is a start, not a usage error.
// joshuafolkken/kit#4793: its check runs in the background beside the pair, so the gate and the
// reviewer start without waiting on it, and the reason rides on the launch for the join to judge by.

// Code's brief alone: the interaction brief beside it is `run-review-cli-interaction.test.ts`'s.
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: async () => 'not-required' } }
})

const FAILURE_EXIT_CODE = 1
const REASON = 'only logs'
const REFUSAL = 'scoped checks not green on this tree'
const TREE = 'briefed-tree'

beforeEach(() => {
	vi.spyOn(review_brief_cli, 'scoped_refusal').mockResolvedValue(undefined)
	vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(TREE)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run with --unpinned-ok', () => {
	it('launches the check in the background with its reason before the gate starts', async () => {
		const order: Array<string> = []

		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		vi.spyOn(run_review_pinned_steps, 'clear').mockReturnValue(undefined)
		const launch = vi.spyOn(run_review_pinned_steps, 'launch').mockImplementation(() => {
			order.push('pinned')

			return { kind: 'launched', pid: 1 }
		})

		vi.spyOn(run_review_steps, 'launch_gate').mockImplementation(() => {
			order.push('gate')

			return { kind: 'failed', note: 'busy' }
		})

		expect(await run_review_cli.run(['--unpinned-ok', REASON])).toBe(FAILURE_EXIT_CODE)
		expect(launch).toHaveBeenCalledWith(PROJECT_ROOT, REASON, TREE)
		expect(order).toStrictEqual(['pinned', 'gate'])
	})
})

// joshuafolkken/kit#4834: `review:record` starts the check again on a tree a round-1 fix moved, and
// `--pinned` reads its answer alone, after the pair's join has already closed.
describe('run --pinned', () => {
	const LINE = 'unpinned a.ts:1'
	const UNPINNED = { text: `${LINE}\n`, unpinned: ['a.ts 0123456789abcdef'] }
	const PINNED = ['--pinned']

	beforeEach(() => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		vi.spyOn(run_review_pinned_steps, 'launched_reason').mockReturnValue(undefined)
		vi.spyOn(run_review_steps, 'wait_for_gate_finish')
	})

	it('exits 3 on an unpinned answer without joining the gate', async () => {
		vi.spyOn(run_review_pinned_steps, 'wait_for_answer').mockResolvedValue(UNPINNED)

		expect(await run_review_cli.run(PINNED)).toBe(run_review.UNPINNED_EXIT_CODE)
		expect(process.stderr.write).toHaveBeenCalledWith(expect.stringContaining(LINE))
		expect(run_review_steps.wait_for_gate_finish).not.toHaveBeenCalled()
	})

	it('exits 0 on a clear answer, and when no check was launched', async () => {
		const wait = vi.spyOn(run_review_pinned_steps, 'wait_for_answer')

		wait.mockResolvedValueOnce({ text: 'unpinned 0\n', unpinned: [] })
		wait.mockResolvedValueOnce(undefined)

		expect(await run_review_cli.run(PINNED)).toBe(0)
		expect(await run_review_cli.run(PINNED)).toBe(0)
	})
})

// joshuafolkken/kit#4828: a start the brief refuses leaves no check and no gate running.
describe('run on a tree the scoped pair has not been green on', () => {
	it('refuses before launching the check or the gate, and keeps the last check', async () => {
		vi.mocked(review_brief_cli.scoped_refusal).mockResolvedValue(REFUSAL)
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)
		const started = [
			vi.spyOn(run_review_pinned_steps, 'clear').mockReturnValue(undefined),
			vi.spyOn(run_review_pinned_steps, 'launch'),
			vi.spyOn(run_review_steps, 'launch_gate'),
		]

		expect(await run_review_cli.run([])).toBe(FAILURE_EXIT_CODE)
		expect(error).toHaveBeenCalledWith(REFUSAL)
		expect(started.filter((spy) => spy.mock.calls.length > 0)).toStrictEqual([])
	})
})
