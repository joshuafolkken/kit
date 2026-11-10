import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_hand_back_held } from '#scripts/lane/lane-hand-back-held'
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
	vi.spyOn(lane_hand_back_held, 'record').mockResolvedValue()
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(false)
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

	// joshuafolkken/kit#7121: a lane child's detach frees its seat, so a full driver's hand-back mark becomes a hold.
	it('records a lane child’s freed hand-back hold before the cost cut', async () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
		const verdict = vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('over')

		await run_ship_detach_wait.after_launch(ISSUE)

		const [record_order] = vi.mocked(lane_hand_back_held.record).mock.invocationCallOrder
		const [verdict_order] = verdict.mock.invocationCallOrder

		expect(record_order).toBeLessThan(verdict_order ?? 0)
	})

	it('leaves the hand-back mark alone on a detach outside a lane', async () => {
		vi.spyOn(cost_cli, 'session_verdict').mockReturnValue('over')

		await run_ship_detach_wait.after_launch(ISSUE)

		expect(lane_hand_back_held.record).not.toHaveBeenCalled()
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
