import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_detach_wait } from './run-ship-detach-wait'
import { run_ship_wait_cli } from './run-ship-wait-cli'

const ISSUE = '5625'
const WAIT_FAILED = 1

const info_lines: Array<string> = []

beforeEach(() => {
	info_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(run_ship_wait_cli, 'run').mockResolvedValue(0)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_ship_detach_wait.after_launch', () => {
	it('runs ship:wait for the issue on a cost --cut of under', async () => {
		vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('under')

		await expect(run_ship_detach_wait.after_launch(ISSUE)).resolves.toBe(0)

		expect(run_ship_wait_cli.run).toHaveBeenCalledWith([ISSUE])
		expect(info_lines).toStrictEqual(['cost --cut: under'])
	})

	it('passes on the exit code ship:wait returns', async () => {
		vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('under')
		vi.mocked(run_ship_wait_cli.run).mockResolvedValue(WAIT_FAILED)

		await expect(run_ship_detach_wait.after_launch(ISSUE)).resolves.toBe(WAIT_FAILED)
	})

	it.each(['over', 'unmeasurable'] as const)(
		'ends the turn without waiting on a cost --cut of %s',
		async (verdict) => {
			vi.spyOn(cost_cli, 'session_verdict').mockReturnValue(verdict)

			await expect(run_ship_detach_wait.after_launch(ISSUE)).resolves.toBe(0)

			expect(run_ship_wait_cli.run).not.toHaveBeenCalled()
			expect(info_lines).toStrictEqual([`cost --cut: ${verdict}`, run_ship_detach_wait.END_TURN])
		},
	)
})
