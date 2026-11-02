import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_resolve } from './lane-resolve'
import { lane_resolve_cli } from './lane-resolve-cli'

// joshuafolkken/kit#5837: `josh lane:resolve` takes one issue number and prints one verdict line.

const USAGE = 'Usage: josh lane:resolve <issue-number>'
const ISSUE = '3769'
const REFUSAL = 'dirty tree'
const GIT_FAILURE = 'fetch failed'

const resolve = vi.spyOn(lane_resolve, 'resolve')
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('lane_resolve_cli.run', () => {
	it.each([[[]], [['abc']], [['1', '2']]])('prints the usage and exits 1 for %o', async (argv) => {
		await expect(lane_resolve_cli.run(argv)).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(USAGE)
		expect(resolve).not.toHaveBeenCalled()
	})

	it('prints the verdict line on stdout and exits 0', async () => {
		resolve.mockResolvedValue({ kind: 'conflict', files: ['docs/a.md'] })

		await expect(lane_resolve_cli.run([ISSUE])).resolves.toBe(0)
		expect(info).toHaveBeenCalledWith('conflict docs/a.md')
	})

	it('prints a refusal on stderr and exits 1', async () => {
		resolve.mockResolvedValue({ kind: 'refused', message: REFUSAL })

		await expect(lane_resolve_cli.run([ISSUE])).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(REFUSAL)
	})

	it('reports a git failure as a message and exits 1', async () => {
		resolve.mockRejectedValue(new Error(GIT_FAILURE))

		await expect(lane_resolve_cli.run([ISSUE])).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(GIT_FAILURE)
	})
})
