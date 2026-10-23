import { beforeEach, describe, expect, it, vi } from 'vitest'

const run_mock = vi.hoisted(() => vi.fn())
const is_kit_mock = vi.hoisted(() => vi.fn(() => true))

vi.mock('#scripts/lib/buffered-process', () => ({
	buffered_process: {
		run_buffered_process: run_mock,
		is_process_failed: (result: { exit_code: number }): boolean => result.exit_code !== 0,
	},
}))
vi.mock('./project-checks', () => ({ project_checks: { is_kit_repository: is_kit_mock } }))

const { metrics_totals } = await import('./metrics-totals')

// joshuafolkken/kit#4594: the ratchet totals reported in the implementation loop, before the ship.

const DIRECTORY = '/repository'
const GROWN =
	'josh metrics: 1 total(s) grew past the merge-base abc123:\nRecord the reason: pnpm josh metrics --accept --reason "<why>"'

beforeEach(() => {
	run_mock.mockReset()
	is_kit_mock.mockReturnValue(true)
	run_mock.mockResolvedValue({ exit_code: 0, output: 'josh metrics: no total grew' })
})

describe('metrics_totals.growth_notice', () => {
	it('runs no metrics outside kit', async () => {
		is_kit_mock.mockReturnValue(false)

		await expect(metrics_totals.growth_notice(DIRECTORY)).resolves.toBeUndefined()
		expect(run_mock).not.toHaveBeenCalled()
	})

	it('runs the totals-only form in the given directory', async () => {
		await metrics_totals.growth_notice(DIRECTORY)

		expect(run_mock).toHaveBeenCalledWith(['josh', 'metrics', '--totals-only'], {
			cwd: DIRECTORY,
		})
	})

	it('answers nothing when no total grew', async () => {
		await expect(metrics_totals.growth_notice(DIRECTORY)).resolves.toBeUndefined()
	})

	it('answers the notice with the accept hint when a total grew', async () => {
		run_mock.mockResolvedValue({ exit_code: 1, output: `${GROWN}\n` })

		await expect(metrics_totals.growth_notice(DIRECTORY)).resolves.toBe(
			`${metrics_totals.NOTICE_HEADING}\n${GROWN}`,
		)
	})
})
