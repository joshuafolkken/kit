import { change_base } from '#scripts/git/change-base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prose_stale_cli } from './prose-stale-cli'
import { prose_stale_scan } from './prose-stale-scan'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('prose_stale_cli.run', () => {
	it('refuses an argument with the usage line and exit 2, before reading git', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await prose_stale_cli.run(['--all'])).toBe(prose_stale_scan.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith('usage: josh prose:stale')
	})
})

describe('prose_stale_cli.guarded', () => {
	it('answers a git call that throws with exit 2, never as 1 found or 0 ok', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		vi.spyOn(change_base, 'resolved').mockRejectedValue(new Error('no repository'))

		expect(await prose_stale_cli.guarded([])).toBe(prose_stale_scan.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith('prose:stale: Error: no repository')
	})
})
