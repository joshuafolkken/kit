import { lane_launch_cli } from '#scripts/lane/lane-launch-cli'
import { lane_sampler } from '#scripts/lane/lane-sampler'
import { run_carry } from '#scripts/run/carry/run-carry'
import { expect, it, vi } from 'vitest'
import { backlog_drive_cli } from './backlog-drive-cli'

it.each([false, true])(
	'clears pending admission on driver exit, throwing=%s',
	async (should_throw) => {
		const keep = vi.spyOn(lane_launch_cli, 'keep_pending')
		const read = vi.spyOn(run_carry, 'repository_directory')

		vi.spyOn(lane_sampler, 'start').mockReturnValue(vi.fn())
		vi.spyOn(console, 'info').mockImplementation(vi.fn())
		if (should_throw) read.mockRejectedValue(new Error('git died'))
		else read.mockResolvedValue(undefined)
		await backlog_drive_cli.run(['--owner', '4242'])

		expect(keep).toHaveBeenCalledWith([])
	},
)
