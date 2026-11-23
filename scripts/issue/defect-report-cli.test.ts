import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { defect_merge_areas } from './defect-merge-areas'
import { defect_report_cli } from './defect-report-cli'
import { issue_body_keys } from './issue-body-keys'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: pnpm josh defect:report [--since <days>]'
const REPO = 'owner/repo'
const ORIGIN_PR = 5
const RECENT_BUG = 20
const OLD_BUG = 10
const RUN_AREA = 'scripts/run'
const RATE_TITLE = 'defect rate by area'
const LONG_AGO = '2020-01-01T00:00:00Z'
const ORIGIN_BODY = `## 背景\n\n${issue_body_keys.prefix('origin')} #${String(ORIGIN_PR)}\n`

vi.mock('./defect-merge-areas', () => ({
	defect_merge_areas: { read: vi.fn() },
}))

const ISSUES = JSON.stringify([
	{ number: RECENT_BUG, created_at: new Date().toISOString(), body: ORIGIN_BODY },
	{ number: OLD_BUG, created_at: LONG_AGO, body: '' }, // no origin line
])
const PULL = JSON.stringify({ merged_at: LONG_AGO })
const FILES = JSON.stringify([
	{ filename: `${RUN_AREA}/a.ts`, status: 'modified', additions: 1, deletions: 1 },
])

function gh_answer(options: { path: string }): string {
	if (options.path.startsWith(`repos/${REPO}/issues`)) return ISSUES

	return options.path.includes('/files') ? FILES : PULL
}

// GitHub answers one recent bug traced to a pull request in `scripts/run` and one bug filed long
// before any period; the local history has four merges that touched `scripts/run`.
function read_github(): MockInstance<typeof console.info> {
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async (options) => gh_answer(options))
	vi.mocked(defect_merge_areas.read).mockResolvedValue(new Map([[RUN_AREA, 4]]))

	return vi.spyOn(console, 'info').mockImplementation(() => undefined)
}

function printed(info: MockInstance<typeof console.info>): string {
	return info.mock.calls.map((call) => String(call[0])).join('\n')
}

afterEach(() => {
	vi.mocked(defect_merge_areas.read).mockReset()
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

describe('defect:report over a readable GitHub', () => {
	it('prints the whole-history report without a rate section when no period is given', async () => {
		const info = read_github()

		expect(await defect_report_cli.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(printed(info)).toContain('no origin line: 1 (50%)')
		expect(printed(info)).not.toContain(RATE_TITLE)
		expect(defect_merge_areas.read).not.toHaveBeenCalled()
	})

	it('drops the bugs filed before the period and adds the rate by area over local merges', async () => {
		const info = read_github()

		expect(await defect_report_cli.run(['--since', '7'])).toBe(SUCCESS_EXIT_CODE)
		expect(printed(info)).toContain('no origin line: 0 (0%)')
		expect(printed(info)).toContain(RATE_TITLE)
		expect(printed(info)).toContain(`${RUN_AREA}  1 / 4  25%`)
	})

	it('reports GitHub as unreadable when the issues listing does not parse', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue('not json')
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await defect_report_cli.run(['--since', '7'])).toBe(FAILURE_EXIT_CODE)
		expect(error).not.toHaveBeenCalledWith(USAGE)
	})

	it('returns the retrospective digest for the period', async () => {
		read_github()

		const lines = await defect_report_cli.digest(7)

		expect(lines[0]).toMatch(/^Defects \(last 7 days\): /u)
		expect(lines).toContain(`  ${RUN_AREA}  1 / 4  25%`)
	})
})

describe('defect:report retrospective digest', () => {
	it('prints no lines when GitHub cannot be read', async () => {
		vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockRejectedValue(new Error('offline'))

		expect(await defect_report_cli.digest(7)).toEqual([])
	})
})
