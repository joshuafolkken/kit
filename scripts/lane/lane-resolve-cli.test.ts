import { describe, expect, it, vi } from 'vitest'
import { lane_resolve } from './lane-resolve'
import { lane_resolve_cli } from './lane-resolve-cli'
import { lane_resolve_record } from './lane-resolve-record'

// joshuafolkken/kit#5837: `josh lane:resolve` takes one issue number and prints one verdict line.
// joshuafolkken/kit#5922: `--record [<path>...]` posts the resolution comment instead.

const USAGE = 'Usage: josh lane:resolve <issue-number> [--record [<path>...]]'
const ISSUE = '3769'
const REFUSAL = 'dirty tree'
const GIT_FAILURE = 'fetch failed'
const URL = 'https://github.com/joshuafolkken/kit/issues/3769#issuecomment-1'

const resolve = vi.spyOn(lane_resolve, 'resolve')
const record = vi.spyOn(lane_resolve_record, 'record')
const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

describe('lane_resolve_cli.run', () => {
	it.each([[[]], [['abc']], [['1', '2']], [['abc', '--record']]])(
		'prints the usage and exits 1 for %o',
		async (argv) => {
			await expect(lane_resolve_cli.run(argv)).resolves.toBe(1)
			expect(error).toHaveBeenCalledWith(USAGE)
			expect(resolve).not.toHaveBeenCalled()
			expect(record).not.toHaveBeenCalled()
		},
	)

	it('routes --record with its paths and prints the comment url', async () => {
		record.mockResolvedValue({ kind: 'recorded', url: URL })

		await expect(lane_resolve_cli.run([ISSUE, '--record', 'docs/a.md'])).resolves.toBe(0)
		expect(record).toHaveBeenCalledWith(ISSUE, ['docs/a.md'])
		expect(resolve).not.toHaveBeenCalled()
		expect(info).toHaveBeenCalledWith(`recorded ${URL}`)
	})

	it('prints a --record refusal on stderr and exits 1', async () => {
		record.mockResolvedValue({ kind: 'refused', message: REFUSAL })

		await expect(lane_resolve_cli.run([ISSUE, '--record'])).resolves.toBe(1)
		expect(record).toHaveBeenCalledWith(ISSUE, [])
		expect(error).toHaveBeenCalledWith(REFUSAL)
	})
})

describe('lane_resolve_cli.run verdicts', () => {
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
