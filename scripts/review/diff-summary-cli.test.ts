import { afterEach, describe, expect, it, vi } from 'vitest'
import { diff_summary_cli } from './diff-summary-cli'

// joshuafolkken/kit#5547: `josh diff:summary`'s argument handling; the real-git reads are
// `diff-summary-cli.git.test.ts`.

const USAGE_LINE = 'Usage: josh diff:summary [<base>]'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('diff_summary_cli.guarded', () => {
	it('refuses more than one argument with exit 2 and the usage line', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await diff_summary_cli.guarded(['a', 'b'])).toBe(2)
		expect(error).toHaveBeenCalledWith(USAGE_LINE)
	})

	it.each(['--help', '-h'])(
		'prints the usage and succeeds for %s, never reading it as a base',
		async (flag) => {
			const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

			expect(await diff_summary_cli.guarded([flag])).toBe(0)
			expect(info).toHaveBeenCalledExactlyOnceWith(USAGE_LINE)
		},
	)
})
