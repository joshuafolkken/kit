import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import {
	LEGACY_OBSERVATION_LEDGER_PATHS,
	MIGRATION_CLAIM_SUFFIX,
	observation_ledger,
} from '#scripts/observations/observation-ledger'
import { observation_ledger_prepare } from '#scripts/observations/observation-ledger-prepare'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_flush } from './git-followup-flush'

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		commit: vi.fn(),
		push: vi.fn(),
		repository_root: vi.fn().mockResolvedValue('/repository'),
		status: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: vi.fn() } }))
vi.mock('#scripts/observations/observation-ledger-prepare', () => ({
	observation_ledger_prepare: { prepare: vi.fn() },
}))

const ISSUE = '2919'
const LEDGER_FILE = observation_ledger.ledger_file(2919)
const DIRTY_LEDGER = `?? ${LEDGER_FILE}`
const OTHER_CHANGE = ' M scripts/git/git-command.ts'
const BROKEN_LINE = { line: '- k:broken', reason: 'expected 5 fields' }
const LIVE_CLAIM = `${LEGACY_OBSERVATION_LEDGER_PATHS[0] ?? ''}.4242${MIGRATION_CLAIM_SUFFIX}`

const mocked_status = vi.mocked(git_command.status)

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	mocked_status.mockResolvedValue([OTHER_CHANGE, DIRTY_LEDGER].join('\n'))
	vi.mocked(observation_ledger_prepare.prepare).mockResolvedValue([])
})

// joshuafolkken/kit#2919 regression: a line appended after the run's commit was flushed only after the
// merge, from the default branch a lane cannot reach — so a lane's line waited in the primary checkout
// and was lost there. It now rides the pull request's own branch before the merge.
describe('commit_ledger_step — a ledger line appended after the run commit', () => {
	it('stages only the ledger paths, commits them and pushes the branch', async () => {
		await git_followup_flush.commit_ledger_step(true, ISSUE)

		expect(git_spawn.read).toHaveBeenCalledExactlyOnceWith(['add', '-A', '--', LEDGER_FILE])
		expect(git_command.commit).toHaveBeenCalledWith(
			`${git_followup_flush.COMMIT_MESSAGE_PREFIX} #${ISSUE}`,
		)
		expect(git_command.push).toHaveBeenCalledOnce()
	})

	it('pushes after it commits, and commits after it stages', async () => {
		await git_followup_flush.commit_ledger_step(true, ISSUE)

		const [staged] = vi.mocked(git_spawn.read).mock.invocationCallOrder
		const [committed] = vi.mocked(git_command.commit).mock.invocationCallOrder
		const [pushed = 0] = vi.mocked(git_command.push).mock.invocationCallOrder

		expect(staged).toBeLessThan(committed ?? 0)
		expect(committed).toBeLessThan(pushed)
	})
})

// A rerun after a failed push would otherwise read the committed ledger as clean and merge without it.
describe('commit_ledger_step — a push that fails', () => {
	it('takes the commit back so the lines stay pending, and rethrows', async () => {
		const push_failure = new Error('rejected: non-fast-forward')

		vi.mocked(git_command.push).mockRejectedValueOnce(push_failure)

		await expect(git_followup_flush.commit_ledger_step(true, ISSUE)).rejects.toBe(push_failure)
		expect(git_spawn.read).toHaveBeenLastCalledWith(['reset', '--soft', 'HEAD~1'])
	})

	it('keeps the commit when the push lands', async () => {
		await git_followup_flush.commit_ledger_step(true, ISSUE)

		expect(git_spawn.read).not.toHaveBeenCalledWith(['reset', '--soft', 'HEAD~1'])
	})
})

describe('commit_ledger_step — nothing to commit', () => {
	it('does nothing on a tree whose ledger is clean', async () => {
		mocked_status.mockResolvedValue(OTHER_CHANGE)

		await git_followup_flush.commit_ledger_step(true, ISSUE)

		expect(git_command.commit).not.toHaveBeenCalled()
		expect(git_command.push).not.toHaveBeenCalled()
	})

	it('does nothing on a run that merges nothing, so the tree is never read', async () => {
		await git_followup_flush.commit_ledger_step(false, ISSUE)

		expect(mocked_status).not.toHaveBeenCalled()
		expect(git_command.commit).not.toHaveBeenCalled()
	})

	// A pathless `git add -A --` stages the whole tree, so a claim alone must stage nothing.
	it('stages nothing when a live migration claim is the only pending ledger path', async () => {
		mocked_status.mockResolvedValue(`?? ${LIVE_CLAIM}`)

		await git_followup_flush.commit_ledger_step(true, ISSUE)

		expect(git_spawn.read).not.toHaveBeenCalled()
		expect(git_command.commit).not.toHaveBeenCalled()
		expect(git_command.push).not.toHaveBeenCalled()
	})
})

describe('commit_ledger_step — a line that breaks the grammar', () => {
	it('refuses before anything is staged, naming the line', async () => {
		vi.mocked(observation_ledger_prepare.prepare).mockResolvedValue([BROKEN_LINE])

		await expect(git_followup_flush.commit_ledger_step(true, ISSUE)).rejects.toThrow(
			BROKEN_LINE.line,
		)
		expect(git_spawn.read).not.toHaveBeenCalled()
		expect(git_command.commit).not.toHaveBeenCalled()
	})
})
