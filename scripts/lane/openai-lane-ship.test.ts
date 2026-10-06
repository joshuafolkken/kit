import { beforeEach, expect, it, vi } from 'vitest'

const repository_mock = vi.hoisted(() => vi.fn())
const result_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/ship/run-ship-probe', () => ({
	run_ship_probe: { repository_directory: repository_mock },
}))
vi.mock('#scripts/run/ship/run-ship-detach', () => ({
	run_ship_detach: { read_result: result_mock },
}))

const { openai_lane_ship } = await import('./openai-lane-ship')
const ISSUE = '2639'

beforeEach(() => {
	repository_mock.mockReset().mockResolvedValue(process.cwd())
	result_mock.mockReset()
})

it('ignores a ship launch from an earlier generation', async () => {
	result_mock.mockReturnValue({ launch_id: 'old', result: 'failed' })
	expect(await openai_lane_ship.wait_for_ship(ISSUE, 'old')).toBe('none')
})

it.each(['success', 'failed', 'abnormal'] as const)(
	'waits through a running ship and reports its final %s result',
	async (result) => {
		result_mock
			.mockReturnValueOnce({ launch_id: 'new', result: 'running' })
			.mockReturnValueOnce({ launch_id: 'new', result })

		expect(await openai_lane_ship.wait_for_ship(ISSUE, 'old')).toBe(result)
		expect(result_mock).toHaveBeenCalledWith(process.cwd(), ISSUE)
	},
)
