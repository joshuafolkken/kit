import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned_steps } from './run-review-pinned-steps'
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
		expect(launch).toHaveBeenCalledWith(PROJECT_ROOT, REASON)
		expect(order).toStrictEqual(['pinned', 'gate'])
	})
})
