import { afterEach, describe, expect, it, vi } from 'vitest'
import { metrics_command } from './metrics-command'
import { metrics_expect } from './metrics-expect'

// joshuafolkken/kit#7612: a help request is answered before anything is measured, and succeeds.

const USAGE_PATTERN = /^Usage: josh metrics /u

afterEach(() => {
	vi.restoreAllMocks()
})

describe('metrics_command.run_metrics — usage', () => {
	it.each(['--help', '-h'])('prints the usage and exits 0 on %s', async (flag) => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		expect(await metrics_command.run_metrics([flag])).toBe(0)
		expect(info).toHaveBeenCalledWith(expect.stringMatching(USAGE_PATTERN))
	})

	// joshuafolkken/kit#8860: the declaration form is named beside the others.
	it('names the --expect form in the usage', async () => {
		const info = vi.spyOn(console, 'info').mockReturnValue(undefined)

		expect(await metrics_command.run_metrics(['--help'])).toBe(0)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(metrics_expect.USAGE_LINE))
	})

	it('prints the usage and exits 1 on a misspelled flag', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await metrics_command.run_metrics(['--totals'])).toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringMatching(USAGE_PATTERN))
	})
})
