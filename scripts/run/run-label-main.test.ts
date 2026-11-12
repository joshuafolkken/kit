import { git_gh_command } from '#scripts/gh/git-gh-command'
import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './hold/run-hold'
import { run_label_main } from './run-label-main'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_add_label: vi.fn(), issue_remove_label: vi.fn() },
}))
vi.mock('./hold/run-hold', () => ({
	run_hold: {
		worktree_directory: vi.fn(),
		hold_path: vi.fn().mockReturnValue('hold.json'),
		read_hold: vi.fn(),
		is_own_hold: vi.fn(),
	},
}))

const ISSUE = '6255'
const LABEL = 'in-progress'

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(run_hold.worktree_directory).mockResolvedValue('tree')
	vi.mocked(run_hold.read_hold).mockReturnValue({
		kind: 'held',
		hold: { issue: ISSUE, taken_at: '', pid: 1 },
	})
	vi.mocked(run_hold.is_own_hold).mockReturnValue(true)
	vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(true)
})

describe('the label worker entry', () => {
	it.each([true, false])('reports a label write result of %s as its exit code', async (applied) => {
		vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(applied)

		expect(await main_entry_fixture.run_entry('scripts/run/run-label-main.ts', [ISSUE])).toBe(
			applied ? 0 : 1,
		)
		expect(git_gh_command.issue_add_label).toHaveBeenCalledWith(ISSUE, LABEL)
	})
})

afterEach(() => vi.restoreAllMocks())

describe('the label worker', () => {
	it('applies the label and reports success', async () => {
		expect(await run_label_main.run([ISSUE])).toBe(0)
		expect(git_gh_command.issue_add_label).toHaveBeenCalledWith(ISSUE, LABEL)
	})

	it('does not reapply a delayed label after the run ended', async () => {
		vi.mocked(run_hold.is_own_hold).mockReturnValue(false)

		expect(await run_label_main.run([ISSUE, '--retry'])).toBe(0)
		expect(git_gh_command.issue_add_label).not.toHaveBeenCalled()
	})

	it('removes a label if the run ends during the retry', async () => {
		vi.mocked(run_hold.is_own_hold).mockReturnValueOnce(true).mockReturnValueOnce(false)

		await run_label_main.run([ISSUE, '--retry'])

		expect(git_gh_command.issue_remove_label).toHaveBeenCalledWith(ISSUE, LABEL)
	})

	it('reports a failed write in the retry log and exit status', async () => {
		vi.mocked(git_gh_command.issue_add_label).mockResolvedValue(false)

		expect(await run_label_main.run([ISSUE, '--retry'])).toBe(1)
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('failed'))
	})
})
