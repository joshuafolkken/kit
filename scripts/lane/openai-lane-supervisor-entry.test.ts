import { expect, it, vi } from 'vitest'
import { openai_lane_supervisor_cli } from './openai-lane-supervisor-cli'

it('forwards the process arguments and the supervisor exit status', async () => {
	const run = vi.spyOn(openai_lane_supervisor_cli, 'run').mockResolvedValue(1)
	const previous = process.exitCode

	await import('./openai-lane-supervisor-entry')

	expect(run).toHaveBeenCalledWith(process.argv.slice(2))
	expect(process.exitCode).toBe(1)
	process.exitCode = previous
	run.mockRestore()
})
