import { describe, expect, it, vi } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const { ISSUE, WITH_HANDOFF, find_open_lane, is_reviewer, printed_errors, verdict } =
	run_cut_cli_fixture

run_cut_cli_fixture.install()

describe('run:cut next action output', () => {
	it('keeps the verdict token and prints the gate command outside a lane', async () => {
		find_open_lane.mockResolvedValue(undefined)

		expect(await run_cut_cli.run([ISSUE])).toBe(0)
		expect(verdict()).toBe('not-a-lane')
		expect(printed_errors()).toContain(`next: pnpm josh run:chain ${ISSUE}`)
	})

	it('prints a next action when directory lookup fails before taking the cut', async () => {
		vi.spyOn(run_cut, 'worktree_directory').mockResolvedValue(undefined)

		expect(await run_cut_cli.run([ISSUE])).toBe(1)
		expect(verdict()).toBe('unknown')
		expect(printed_errors()).toContain(`next: pnpm josh run:chain ${ISSUE}`)
	})

	it('prints a next action after an unexpected failure', async () => {
		find_open_lane.mockRejectedValue(new Error('lane lookup failed'))

		expect(await run_cut_cli.run([ISSUE])).toBe(1)
		expect(verdict()).toBe('unknown')
		expect(printed_errors()).toContain(`next: pnpm josh run:chain ${ISSUE}`)
	})

	it.each([
		['--resume', ISSUE],
		['--impl', ISSUE, ...WITH_HANDOFF],
	])('keeps the %s protocol without a pre-gate next action', async (...argv) => {
		await run_cut_cli.run(argv)

		expect(printed_errors()).not.toContain('next:')
	})

	it('keeps the reviewer on its own task', async () => {
		is_reviewer.mockReturnValueOnce(true).mockReturnValueOnce(true)

		await run_cut_cli.run([ISSUE])

		expect(printed_errors()).not.toContain('next:')
	})
})
