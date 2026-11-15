import { change_base } from '#scripts/git/change-base'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { prose_stale_cli } from './prose-stale-cli'
import { prose_stale_scan } from './prose-stale-scan'

const USAGE_LINE = 'Usage: josh prose:stale'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('prose_stale_cli.run', () => {
	it('refuses an argument with the usage line and exit 2, before reading git', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		expect(await prose_stale_cli.run(['--all'])).toBe(prose_stale_scan.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith(USAGE_LINE)
	})

	it.each(['--help', '-h'])(
		'prints the usage and succeeds for %s, before reading git',
		async (flag) => {
			const info = vi.spyOn(console, 'info').mockReturnValue(undefined)
			const resolved = vi.spyOn(change_base, 'resolved')

			expect(await prose_stale_cli.run([flag])).toBe(0)
			expect(info).toHaveBeenCalledWith(USAGE_LINE)
			expect(resolved).not.toHaveBeenCalled()
		},
	)
})

describe('prose_stale_cli.guarded', () => {
	it('answers a git call that throws with exit 2, never as 1 found or 0 ok', async () => {
		const error = vi.spyOn(console, 'error').mockReturnValue(undefined)

		vi.spyOn(change_base, 'resolved').mockRejectedValue(new Error('no repository'))

		expect(await prose_stale_cli.guarded([])).toBe(prose_stale_scan.FAILED_EXIT)
		expect(error).toHaveBeenCalledWith('prose:stale: Error: no repository')
	})
})
