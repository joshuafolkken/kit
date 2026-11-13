import { afterEach, describe, expect, it, vi } from 'vitest'
import { main, run } from './migrate-cli'

afterEach(() => vi.restoreAllMocks())

describe('migration command arguments', () => {
	it.each([{ args: [] }, { args: ['1.0.0', '--unknown'] }])(
		'rejects unsupported arguments: $args',
		async ({ args }) => {
			await expect(main(args)).rejects.toThrow('Usage:')
		},
	)
})

describe('migration command execution', () => {
	it('prints help without invoking migration', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await run(['--help'])
		expect(info).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
	})

	it('reports invalid arguments and exits unsuccessfully', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit')
		})

		await expect(run([])).rejects.toThrow('exit')
		expect(error).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
		expect(exit).toHaveBeenCalledWith(1)
	})
})
