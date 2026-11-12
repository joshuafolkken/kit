import { rmSync } from 'node:fs'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './hold/run-hold'
import { run_label_main } from './run-label-main'

const make_directory = temporary_directory('suite')

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_add_label: vi.fn(), issue_remove_label: vi.fn() },
}))

const ISSUE = '6255'
const GIT_DIRECTORY = make_directory('run-label-hold-test-')

beforeEach(() => {
	vi.spyOn(git_command, 'git_directories').mockResolvedValue([GIT_DIRECTORY, GIT_DIRECTORY])
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(run_hold.hold_path(GIT_DIRECTORY), { force: true })
})

describe('the delayed label reads the actual hold record', () => {
	it('retries while the worktree holds this issue', async () => {
		run_hold.write_hold(run_hold.hold_path(GIT_DIRECTORY), ISSUE)

		expect(await run_label_main.run([ISSUE, '--retry'])).toBe(0)
		expect(git_gh_command.issue_add_label).toHaveBeenCalledWith(ISSUE, 'in-progress')
		expect(git_gh_command.issue_remove_label).not.toHaveBeenCalled()
	})

	it('skips the retry when the record is absent', async () => {
		expect(await run_label_main.run([ISSUE, '--retry'])).toBe(0)
		expect(git_gh_command.issue_add_label).not.toHaveBeenCalled()
	})
})
