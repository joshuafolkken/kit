import { describe, expect, it, vi } from 'vitest'
import { prose_stale_cli } from './prose-stale-cli'
import { prose_stale_scan } from './prose-stale-scan'

describe('prose_stale_cli.run', () => {
	it('refuses an argument with the usage line and exit 2, before reading git', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await prose_stale_cli.run(['--all'])).toBe(prose_stale_scan.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith('usage: josh prose:stale')

		error.mockRestore()
	})
})
