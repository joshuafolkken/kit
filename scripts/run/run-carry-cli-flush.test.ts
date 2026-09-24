import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'

// joshuafolkken/kit#2492: `--end` makes the batch's one ledger flush while its record is still there, so
// the lanes' per-issue ledger pull requests collapse into one. The flush is mocked; what it does is
// `run-carry-flush.test.ts`'s, and only the wiring — once, and never for a record already gone — is here.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('./run-carry-flush', () => ({
	run_carry_flush: { flush_ledger: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('./run-stop-notify', () => ({
	run_stop_notify: { plan: vi.fn(), announce: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const { run_carry_flush } = await import('./run-carry-flush')
const git_directories = vi.mocked(git_command.git_directories)
const flush_ledger = vi.mocked(run_carry_flush.flush_ledger)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-flush-cli-test-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const OK = 0

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	flush_ledger.mockClear()
	run_carry.end_carry(run_carry.carry_path(REPOSITORY))
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('run:carry --end — the batch flushes its ledger once, at its end', () => {
	it('flushes once when a record is there to end', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])

		expect(await run_carry_cli.run(['--end'])).toBe(OK)
		expect(flush_ledger).toHaveBeenCalledOnce()
	})

	it('does not flush again on a second --end, whose record is already gone', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--end'])
		await run_carry_cli.run(['--end'])

		expect(flush_ledger).toHaveBeenCalledOnce()
	})

	it('flushes on a stopped end as well as a clean one', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--end', '--stopped', 'backlog drained'])

		expect(flush_ledger).toHaveBeenCalledOnce()
	})

	it('clears the record before the flush starts, so a flush cut short never leaves it standing', async () => {
		const kinds_at_flush: Array<string> = []

		flush_ledger.mockImplementationOnce(async () => {
			kinds_at_flush.push(run_carry.read_carry(run_carry.carry_path(REPOSITORY)).kind)
			await Promise.resolve()
		})
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--end'])

		expect(kinds_at_flush).toStrictEqual(['none'])
	})

	it('never flushes from a begin or a count', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--merged', '1'])

		expect(flush_ledger).not.toHaveBeenCalled()
	})
})
