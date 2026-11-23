import { git_gh_command } from '#scripts/gh/git-gh-command'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defect_report_cli } from './defect-report-cli'

const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: pnpm josh defect:report [--since <days>]'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('defect:report arguments', () => {
	it.each([[['--since']], [['--since', 'x']], [['--since', '0']], [['--until', '7']]])(
		'refuses %j with the usage',
		async (argv) => {
			const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

			expect(await defect_report_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
			expect(error).toHaveBeenCalledWith(USAGE)
		},
	)

	it('accepts --since <days> and reports GitHub as unreadable when it is', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(undefined)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await defect_report_cli.run(['--since', '7'])).toBe(FAILURE_EXIT_CODE)
		expect(error).not.toHaveBeenCalledWith(USAGE)
	})
})

describe('defect:report retrospective digest', () => {
	it('prints no lines when GitHub cannot be read', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockRejectedValue(new Error('offline'))

		expect(await defect_report_cli.digest(7)).toEqual([])
	})
})
