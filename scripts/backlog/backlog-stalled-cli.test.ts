import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_stalled } from './backlog-stalled'
import { backlog_stalled_cli } from './backlog-stalled-cli'
import { backlog_stalled_detect } from './backlog-stalled-detect'

afterEach(() => {
	vi.restoreAllMocks()
	process.exitCode = undefined
})

describe('backlog_stalled_cli.main', () => {
	it('prints the verdict and exits success', async () => {
		vi.spyOn(backlog_stalled_detect, 'detect_and_report').mockResolvedValue(backlog_stalled.STALLED)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await backlog_stalled_cli.main()

		expect(info).toHaveBeenCalledWith(backlog_stalled.STALLED)
		expect(process.exitCode).toBe(0)
	})

	it('prints unreadable and still exits success when detection throws', async () => {
		vi.spyOn(backlog_stalled_detect, 'detect_and_report').mockRejectedValue(new Error('no repo'))
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await backlog_stalled_cli.main()

		expect(info).toHaveBeenCalledWith(backlog_stalled.UNREADABLE)
		expect(process.exitCode).toBe(0)
	})
})
