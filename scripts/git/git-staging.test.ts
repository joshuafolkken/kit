import { OBSERVATION_LEDGER_PATH } from '#scripts/observations/observation-ledger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'
import { git_prompt } from './git-prompt'
import { git_staging } from './git-staging'
import { git_status } from './git-status'

vi.mock('./git-command', () => ({
	git_command: {
		add_tracked: vi.fn(),
		add_path: vi.fn(),
		status: vi.fn().mockResolvedValue(''),
	},
}))

vi.mock('./git-status', () => ({
	git_status: {
		check_unstaged: vi.fn(),
		check_branch_version: vi.fn().mockResolvedValue(true),
		list_untracked_files: vi.fn().mockReturnValue([]),
	},
}))

vi.mock('./git-prompt', () => ({
	git_prompt: {
		confirm_unstaged_files: vi.fn(),
	},
}))

const UNTRACKED_TEST_FILE = 'scripts/new-test.spec.ts'
const UNTRACKED_DOC_FILE = 'docs/new.md'

describe('git_staging.check_and_confirm_staging — tracked files', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('auto-stages tracked files when force=true and unstaged files exist', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_tracked).toHaveBeenCalledOnce()
		expect(git_prompt.confirm_unstaged_files).not.toHaveBeenCalled()
	})

	it('prompts user when force=false and unstaged files exist', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)

		await git_staging.check_and_confirm_staging(false)

		expect(git_prompt.confirm_unstaged_files).toHaveBeenCalledOnce()
		expect(git_command.add_tracked).not.toHaveBeenCalled()
	})

	it('skips staging when no unstaged files exist', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(false)

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_tracked).not.toHaveBeenCalled()
		expect(git_prompt.confirm_unstaged_files).not.toHaveBeenCalled()
	})
})

describe('git_staging.check_and_confirm_staging — untracked files', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('also stages untracked non-ignored files when force=true', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)
		vi.mocked(git_status.list_untracked_files).mockReturnValueOnce([
			UNTRACKED_TEST_FILE,
			UNTRACKED_DOC_FILE,
		])

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_tracked).toHaveBeenCalledOnce()
		expect(git_command.add_path).toHaveBeenCalledTimes(2)
		expect(git_command.add_path).toHaveBeenNthCalledWith(1, UNTRACKED_TEST_FILE)
		expect(git_command.add_path).toHaveBeenNthCalledWith(2, UNTRACKED_DOC_FILE)
	})

	it('does not call add_path when there are no untracked files', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)
		vi.mocked(git_status.list_untracked_files).mockReturnValueOnce([])

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_tracked).toHaveBeenCalledOnce()
		expect(git_command.add_path).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#1756: a parent session appends to the observation ledger in the primary
// checkout, and the next `pnpm josh git` run there used to sweep that line into a pull request about
// something else. Both halves are pinned, because the ledger can be either tracked or — in a
// repository taking its first observation — untracked, and an exclusion covering one of the two
// leaves the contamination on the other path.
describe('git_staging.check_and_confirm_staging — the observation ledger', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('excludes the ledger from the tracked-file staging', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_tracked).toHaveBeenCalledWith([OBSERVATION_LEDGER_PATH])
	})

	// Without this line the ledger alone in the tree produces `Failed to commit changes` from git's
	// empty index and nothing that names the exclusion which caused it.
	it('says why the ledger was left out', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)
		vi.mocked(git_command.status).mockResolvedValueOnce(` M ${OBSERVATION_LEDGER_PATH}`)

		await git_staging.check_and_confirm_staging(true)

		expect(info).toHaveBeenCalledWith(expect.stringContaining('pnpm josh observations:flush'))
		info.mockRestore()
	})

	it('does not stage the ledger as an untracked file either', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)
		vi.mocked(git_status.list_untracked_files).mockReturnValueOnce([
			OBSERVATION_LEDGER_PATH,
			UNTRACKED_DOC_FILE,
		])

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_path).toHaveBeenCalledExactlyOnceWith(UNTRACKED_DOC_FILE)
	})
})
