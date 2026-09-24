import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'

// joshuafolkken/kit#2136: `--end --stopped` pushes one ⏸️ confirmation as it clears the record, so a
// person learns a headless run halted after a session cut. The send is mocked, so the wiring — and the
// dedup a removed record gives for free — is pinned without a Telegram. The record state machine itself
// is `run-carry-cli.test.ts`'s; only the stop push lives here, off that file's line budget.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('./run-carry-flush', () => ({
	run_carry_flush: { flush_ledger: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('./run-carry-stash', () => ({ run_carry_stash: { report_orphans: vi.fn() } }))
vi.mock('#scripts/git/telegram-notify', () => ({
	telegram_notify: { confirm: vi.fn().mockResolvedValue(true) },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)
const { telegram_notify } = await import('#scripts/git/telegram-notify')
const confirm = vi.mocked(telegram_notify.confirm)

const TEST_PREFIX = 'run-carry-stop-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	confirm.mockClear()
	run_carry.end_carry(target())
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(target(), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('a stop announced to the person after a session cut', () => {
	it('pushes one confirmation when a stop reason ends a carried run', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])

		const code = await run_carry_cli.run(['--end', '--stopped', 'every remaining child is blocked'])

		expect(code).toBe(0)
		expect(confirm).toHaveBeenCalledTimes(1)
	})

	it('stays silent on a clean end that names no stop', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])

		await run_carry_cli.run(['--end'])

		expect(confirm).not.toHaveBeenCalled()
	})

	it('sends once and not again when the cleared record is ended a second time', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--end', '--stopped', 'blocked'])
		expect(confirm).toHaveBeenCalledTimes(1)

		await run_carry_cli.run(['--end', '--stopped', 'blocked'])

		expect(confirm).toHaveBeenCalledTimes(1)
	})
})
