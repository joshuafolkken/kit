import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { run_preflight } from '#scripts/run/run-preflight'
import { run_tidy_cli } from '#scripts/run/tidy/run-tidy-cli'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

vi.mock('#scripts/run/run-preflight', () => ({
	run_preflight: { CLEAN_VERDICT: 'clean', check: vi.fn() },
}))

vi.mock('#scripts/run/tidy/run-tidy-cli', () => ({ run_tidy_cli: { sweep: vi.fn() } }))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))

const sweep = vi.mocked(run_tidy_cli.sweep)
const scratch = mkdtempSync(path.join(tmpdir(), 'run-hold-cli-tidy-test-'))
const WORKTREE = path.join(scratch, '.git')
const ISSUE = '2701'
const OTHER_ISSUE = '2700'
const RECLAIM_DECISION = {
	advice: 'Stash first',
	reason: 'Uncommitted',
	verdict: 'reclaim',
} as const

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
	vi.mocked(git_command.status).mockResolvedValue('')
	vi.mocked(run_preflight.check).mockResolvedValue({ advice: '', reason: '', verdict: 'clean' })
})

afterEach(() => {
	vi.clearAllMocks()
	vi.restoreAllMocks()
	rmSync(run_hold.hold_path(WORKTREE), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

// joshuafolkken/kit#2701: merged lanes and stashes are swept at every run start, which is the claim.
describe('the merged-residue sweep after a claim', () => {
	it('sweeps once the tree is held', async () => {
		await run_hold_cli.run([ISSUE])

		expect(sweep).toHaveBeenCalledOnce()
	})

	it('does not sweep when the preflight stops the claim', async () => {
		vi.mocked(run_preflight.check).mockResolvedValue(RECLAIM_DECISION)

		await run_hold_cli.run([ISSUE])

		expect(sweep).not.toHaveBeenCalled()
	})

	it('does not sweep when another run holds the tree', async () => {
		await run_hold_cli.run([OTHER_ISSUE])
		sweep.mockClear()

		await run_hold_cli.run([ISSUE])

		expect(sweep).not.toHaveBeenCalled()
	})

	it('does not sweep on a release', async () => {
		await run_hold_cli.run(['--release', ISSUE])

		expect(sweep).not.toHaveBeenCalled()
	})
})
