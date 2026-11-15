import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_measure_cli } from './lane-measure-cli'

// joshuafolkken/kit#7612: asking `lane:stats` or `lane:net` for help prints the usage and succeeds,
// where it had read as a refused argument and failed.

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_measure_cli.run — help', () => {
	it.each([
		[['--help']],
		[['stats', '--help']],
		[['net', '--help']],
		[['net', '-h']],
		[['sample', '-h']],
	])('answers %j with the usage and 0', async (argv) => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		await expect(lane_measure_cli.run(argv)).resolves.toBe(0)
		expect(info).toHaveBeenCalledWith(lane_measure_cli.USAGE)
	})

	it('still refuses a malformed argument with the usage and 1', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		await expect(lane_measure_cli.run(['net', '#7612'])).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(lane_measure_cli.USAGE)
	})
})
