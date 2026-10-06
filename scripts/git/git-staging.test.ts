import {
	LEGACY_OBSERVATION_LEDGER_DIRECTORY,
	LEGACY_OBSERVATION_LEDGER_PATHS,
	MIGRATION_CLAIM_SUFFIX,
	observation_ledger,
	OBSERVATION_LEDGER_DIRECTORY,
} from '#scripts/observations/observation-ledger'
import { observation_ledger_prepare } from '#scripts/observations/observation-ledger-prepare'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'
import { git_prompt } from './git-prompt'
import { git_staging } from './git-staging'
import { git_status } from './git-status'

const REPOSITORY_ROOT = '/repository'

vi.mock('./git-command', () => ({
	git_command: {
		add_tracked: vi.fn(),
		add_path: vi.fn(),
		repository_root: vi.fn(),
		status: vi.fn().mockResolvedValue(''),
	},
}))

vi.mock('#scripts/observations/observation-ledger-prepare', () => ({
	observation_ledger_prepare: { prepare: vi.fn().mockResolvedValue([]) },
}))

// joshuafolkken/kit#2919: the ledger is a directory of one file per issue; a lane stages its own.
const OBSERVATION_LEDGER_PATH = observation_ledger.ledger_file(2919)
const LEGACY_OBSERVATION_LEDGER_PATH = LEGACY_OBSERVATION_LEDGER_PATHS[0] ?? ''
const MIGRATION_CLAIM_FILE = `${LEGACY_OBSERVATION_LEDGER_PATH}.123${MIGRATION_CLAIM_SUFFIX}`
const BROKEN_LINE = { line: '- k:broken', reason: 'expected 5 fields' }

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

// joshuafolkken/kit#2763: the ledger lines a run appended ride that run's own commit, so no pull
// request of the ledger's own follows the merge. Both halves are pinned, because the ledger can be
// either tracked or — in a repository taking its first observation — untracked.
describe('git_staging.check_and_confirm_staging — the observation ledger rides the commit', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('stages the ledger with the tracked files when its grammar holds', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_tracked).toHaveBeenCalledWith([])
	})

	it('stages an untracked ledger, but never a migration claim', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)
		vi.mocked(git_status.list_untracked_files).mockReturnValueOnce([
			OBSERVATION_LEDGER_PATH,
			MIGRATION_CLAIM_FILE,
		])

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_path).toHaveBeenCalledExactlyOnceWith(OBSERVATION_LEDGER_PATH)
	})

	it('prepares the ledger at the repository root before staging', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)
		vi.mocked(git_command.repository_root).mockResolvedValueOnce(REPOSITORY_ROOT)

		await git_staging.check_and_confirm_staging(true)

		expect(observation_ledger_prepare.prepare).toHaveBeenCalledWith(REPOSITORY_ROOT)
	})

	it('reads the status only after the migration has moved an old-path ledger', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)

		await git_staging.check_and_confirm_staging(true)

		const [prepared_at] = vi.mocked(observation_ledger_prepare.prepare).mock.invocationCallOrder
		const [status_read_at = 0] = vi.mocked(git_command.status).mock.invocationCallOrder

		expect(prepared_at).toBeLessThan(status_read_at)
	})
})

// joshuafolkken/kit#2123: a line that breaks the ledger grammar never reaches a commit. The run's
// commit still goes ahead, without the ledger, and says where the line is named.
describe('git_staging.check_and_confirm_staging — a ledger that breaks the grammar', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(observation_ledger_prepare.prepare).mockResolvedValueOnce([BROKEN_LINE])
	})

	it('excludes the ledger directory and every old path from the tracked-file staging', async () => {
		vi.mocked(git_status.check_unstaged).mockResolvedValueOnce(true)

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_tracked).toHaveBeenCalledWith([
			OBSERVATION_LEDGER_DIRECTORY,
			LEGACY_OBSERVATION_LEDGER_DIRECTORY,
			...LEGACY_OBSERVATION_LEDGER_PATHS,
		])
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
			LEGACY_OBSERVATION_LEDGER_PATH,
			UNTRACKED_DOC_FILE,
		])

		await git_staging.check_and_confirm_staging(true)

		expect(git_command.add_path).toHaveBeenCalledExactlyOnceWith(UNTRACKED_DOC_FILE)
	})
})
