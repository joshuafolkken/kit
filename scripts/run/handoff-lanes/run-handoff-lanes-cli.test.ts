import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_handoff_lanes } from './run-handoff-lanes'
import { run_handoff_lanes_cli } from './run-handoff-lanes-cli'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_handoff_lanes_cli.run', () => {
	it('refuses an argument with the usage and runs no step', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const chain = vi.spyOn(run_handoff_lanes, 'run')

		expect(await run_handoff_lanes_cli.run(['5845'])).toBe(1)
		expect(error).toHaveBeenCalledWith(run_handoff_lanes_cli.USAGE)
		expect(chain).not.toHaveBeenCalled()
	})

	it('runs the chain through the real steps and prints to stdout', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
		const chain = vi.spyOn(run_handoff_lanes, 'run').mockImplementation(async (io) => {
			io.print('x')

			return 0
		})

		expect(await run_handoff_lanes_cli.run([])).toBe(0)
		expect(chain).toHaveBeenCalledWith(expect.objectContaining(run_handoff_lanes.DEFAULT_IO))
		expect(info).toHaveBeenCalledWith('x')
	})
})
