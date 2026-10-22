import { afterEach, describe, expect, it, vi } from 'vitest'
import { stdout_on_stderr } from './stdout-on-stderr'

const LINE = 'sent\n'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('stdout_on_stderr.run', () => {
	it('sends what the work writes to stdout to stderr, and returns its answer', async () => {
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		const answer = await stdout_on_stderr.run(async () => {
			process.stdout.write(LINE)

			return 'done'
		})

		expect(answer).toBe('done')
		expect(stderr).toHaveBeenCalledWith(LINE)
	})

	it('puts stdout back even when the work throws', async () => {
		const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		await expect(
			stdout_on_stderr.run(async () => {
				throw new Error('boom')
			}),
		).rejects.toThrow('boom')
		process.stdout.write(LINE)

		expect(stdout).toHaveBeenCalledWith(LINE)
	})
})
