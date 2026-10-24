import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned } from './run-review-pinned'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4647: `--unpinned-ok "<reason>"` is a start, not a usage error — its reason reaches
// the pinned check in place. joshuafolkken/kit#4770: that run launches no background check.

// Code's brief alone: the interaction brief beside it is `run-review-cli-interaction.test.ts`'s.
vi.mock('#scripts/review/review-interaction', async (import_original) => {
	const { review_interaction } = await import_original<Record<'review_interaction', object>>()

	return { review_interaction: { ...review_interaction, status: async () => 'not-required' } }
})

const FAILURE_EXIT_CODE = 1

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run with --unpinned-ok', () => {
	it('hands its reason to the in-place check and launches no background one', async () => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		vi.spyOn(run_review_pinned_steps, 'clear').mockReturnValue(undefined)
		const launch = vi.spyOn(run_review_pinned_steps, 'launch')

		vi.spyOn(run_review_steps, 'launch_gate').mockReturnValue({ kind: 'failed', note: 'busy' })
		const check = vi
			.spyOn(run_review_pinned, 'check')
			.mockResolvedValue({ kind: 'accepted', text: '' })

		expect(await run_review_cli.run(['--unpinned-ok', 'only logs'])).toBe(FAILURE_EXIT_CODE)
		expect(check).toHaveBeenCalledWith('only logs')
		expect(launch).not.toHaveBeenCalled()
	})
})
