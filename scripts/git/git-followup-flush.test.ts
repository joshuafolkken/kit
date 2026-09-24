import { OBSERVATION_LEDGER_PATH } from '#scripts/observations/observation-ledger'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { observations_flush } from '#scripts/observations/observations-flush'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'
import { git_followup_flush } from './git-followup-flush'
import { main_sync } from './main-sync'

vi.mock('./git-command', () => ({ git_command: { status: vi.fn() } }))
vi.mock('./main-sync', () => ({ main_sync: { run: vi.fn() } }))
vi.mock('#scripts/observations/observations-flush', () => ({
	observations_flush: { flush: vi.fn() },
}))
vi.mock('#scripts/observations/observation-ledger-home', () => ({
	observation_ledger_home: { is_lane: vi.fn() },
}))

const DIRTY_LEDGER = ` M ${OBSERVATION_LEDGER_PATH}`
const CLEAN_TREE = ''
const OTHER_CHANGE = ' M scripts/git/git-command.ts'
const MAIN_SYNC_SUCCESS = 0
const MAIN_SYNC_FAILURE = 1
const FLUSH_FAILURE = new Error('remote hung up')

const mocked_status = vi.mocked(git_command.status)
const mocked_sync = vi.mocked(main_sync.run)
const mocked_flush = vi.mocked(observations_flush.flush)
const mocked_is_lane = vi.mocked(observation_ledger_home.is_lane)

function warned_text(): string {
	return vi
		.mocked(console.warn)
		.mock.calls.map(([line]) => String(line))
		.join('\n')
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	mocked_status.mockResolvedValue(DIRTY_LEDGER)
	mocked_sync.mockResolvedValue(MAIN_SYNC_SUCCESS)
	mocked_flush.mockResolvedValue('merged observations/2026-09-12-000000')
	mocked_is_lane.mockReturnValue(false)
})

// joshuafolkken/kit#2419: a lane's ledger is the primary checkout's, and `main_sync` refuses inside a
// linked work tree — so the step there printed a recovery a lane could not complete.
describe('flush_ledger_step — inside a lane', () => {
	it('neither reads the tree nor returns to the default branch', async () => {
		mocked_is_lane.mockReturnValue(true)

		await git_followup_flush.flush_ledger_step(true)

		expect(mocked_status).not.toHaveBeenCalled()
		expect(mocked_sync).not.toHaveBeenCalled()
		expect(mocked_flush).not.toHaveBeenCalled()
		expect(warned_text()).toBe('')
	})
})

describe('flush_ledger_step — when the ledger holds a pending append', () => {
	it('returns to the default branch and flushes', async () => {
		await git_followup_flush.flush_ledger_step(true)

		expect(mocked_sync).toHaveBeenCalledOnce()
		expect(mocked_flush).toHaveBeenCalledOnce()
	})
})

describe('flush_ledger_step — when there is nothing to flush', () => {
	it('short-circuits on a clean tree without touching the branch', async () => {
		mocked_status.mockResolvedValue(CLEAN_TREE)

		await git_followup_flush.flush_ledger_step(true)

		expect(mocked_sync).not.toHaveBeenCalled()
		expect(mocked_flush).not.toHaveBeenCalled()
	})

	it('short-circuits when only other files changed', async () => {
		mocked_status.mockResolvedValue(OTHER_CHANGE)

		await git_followup_flush.flush_ledger_step(true)

		expect(mocked_sync).not.toHaveBeenCalled()
	})
})

describe('flush_ledger_step — on a run that merged nothing', () => {
	// A --no-merge run is still holding an open issue, so it neither reads the tree nor flushes.
	it('does nothing, so the tree is never read', async () => {
		await git_followup_flush.flush_ledger_step(false)

		expect(mocked_status).not.toHaveBeenCalled()
		expect(mocked_sync).not.toHaveBeenCalled()
	})
})

describe('flush_ledger_step — when the default-branch return fails', () => {
	beforeEach(() => {
		mocked_sync.mockResolvedValue(MAIN_SYNC_FAILURE)
	})

	it('does not flush', async () => {
		await git_followup_flush.flush_ledger_step(true)

		expect(mocked_flush).not.toHaveBeenCalled()
	})

	it('reports the failure rather than rejecting', async () => {
		await expect(git_followup_flush.flush_ledger_step(true)).resolves.toBeUndefined()
	})
})

// joshuafolkken/kit#1539: past the merge, a flush failure is cleanup that did not finish — not a run
// that failed — so it must not take the merge, the epic close and the hold release down with it.
describe('flush_ledger_step — when the flush itself fails after the merge', () => {
	beforeEach(() => {
		mocked_flush.mockRejectedValue(FLUSH_FAILURE)
	})

	it('does not reject', async () => {
		await expect(git_followup_flush.flush_ledger_step(true)).resolves.toBeUndefined()
	})

	it('names the step and its recovery command', async () => {
		await git_followup_flush.flush_ledger_step(true)

		expect(warned_text()).toContain('The observation ledger flush')
		expect(warned_text()).toContain('pnpm josh observations:flush')
	})
})
