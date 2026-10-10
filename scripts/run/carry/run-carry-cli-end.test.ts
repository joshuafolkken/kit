import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'
import { run_carry_cli_fixture } from './run-carry-cli-fixture'
import { run_carry_ended } from './run-carry-ended'

// What `--end` does once per invocation, on the read of a record that is still there.
//
// joshuafolkken/kit#2919: `--end` used to flush every lane's ledger lines from the primary checkout in
// one pull request (joshuafolkken/kit#2492); another run's stash took those lines first and the flush
// found nothing. Each lane now merges its own lines with its own pull request, so `--end` flushes
// nothing — and running the flush command at all would be the old route coming back.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('#scripts/josh/josh-run', () => ({
	josh_command: { josh_run: vi.fn().mockResolvedValue({ code: 0, out: '' }) },
}))
vi.mock('./run-carry-stash', () => ({
	run_carry_stash: { report_orphans: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('#scripts/run/run-stop-notify', () => ({
	run_stop_notify: { plan: vi.fn(), announce: vi.fn() },
}))
vi.mock('#scripts/run/merge/run-merge-collect', () => ({
	run_merge_collect: { collect_merged: vi.fn().mockResolvedValue(undefined) },
}))

const { git_command } = await import('#scripts/git/git-command')
const { josh_command } = await import('#scripts/josh/josh-run')
const { run_carry_stash } = await import('./run-carry-stash')
const git_directories = vi.mocked(git_command.git_directories)
const josh_run = vi.mocked(josh_command.josh_run)
const report_orphans = vi.mocked(run_carry_stash.report_orphans)
const { run_merge_collect } = await import('#scripts/run/merge/run-merge-collect')
const collect_merged = vi.mocked(run_merge_collect.collect_merged)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-end-cli-test-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const OK = 0

beforeEach(() => {
	run_carry_cli_fixture.hold_verdict()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	josh_run.mockClear()
	report_orphans.mockClear()
	run_carry.end_carry(run_carry.carry_path(REPOSITORY))
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

describe('run:carry --end — the batch flushes no ledger at its end', () => {
	it('ends the record without running the observation ledger flush', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])

		expect(await run_carry_cli.run(['--end'])).toBe(OK)
		expect(run_carry.read_carry(run_carry.carry_path(REPOSITORY)).kind).toBe('none')
		expect(josh_run).not.toHaveBeenCalled()
	})

	it('runs no flush on a stopped end either', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--end', '--stopped', 'backlog drained'])

		expect(josh_run).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#3439: the run `--end` removes stays readable as the last ended run for `run:board`.
describe('run:carry --end — the ended run is recorded', () => {
	it('records the ended run’s invocation and start, and keeps it over a second --end', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		const read = run_carry.read_carry(run_carry.carry_path(REPOSITORY))
		const started_at = read.kind === 'carried' ? read.carry.started_at : 'missing'

		await run_carry_cli.run(['--end'])
		await run_carry_cli.run(['--end'])

		const ended = run_carry_ended.read_ended(run_carry_ended.ended_path(REPOSITORY))

		expect(ended).toMatchObject({ invocation: INVOCATION, started_at })
		expect(Date.parse(ended?.ended_at ?? '')).toBeGreaterThanOrEqual(Date.parse(started_at))
	})

	it('still clears the carry record when the ended run cannot be recorded', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		const record_ended = vi.spyOn(run_carry_ended, 'record_ended').mockImplementation(() => {
			throw new Error('ENOSPC')
		})

		const code = await run_carry_cli.run(['--end'])

		record_ended.mockRestore()

		expect(code).toBe(OK)
		expect(run_carry.read_carry(run_carry.carry_path(REPOSITORY)).kind).toBe('none')
	})
})

// joshuafolkken/kit#3451: a lane that merged while no driver watched it is collected at the run's end.
describe('run:carry --end — the run’s merged lanes are collected first', () => {
	it('collects while the record is still there to count the merges', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		collect_merged.mockImplementationOnce(async () => {
			expect(run_carry.read_carry(run_carry.carry_path(REPOSITORY)).kind).toBe('carried')
		})

		expect(await run_carry_cli.run(['--end'])).toBe(OK)
		expect(collect_merged).toHaveBeenCalledWith(REPOSITORY)
	})
})

// joshuafolkken/kit#2505: the closed-issue stash report rides the same once-per-invocation read.
describe('run:carry --end — the batch reports closed-issue stashes once, at its end', () => {
	it('reports once when a record is there to end, and not again on a second --end', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--end'])
		await run_carry_cli.run(['--end'])

		expect(report_orphans).toHaveBeenCalledOnce()
	})

	it('never reports from a begin or a count', async () => {
		await run_carry_cli.run(['--begin', INVOCATION])
		await run_carry_cli.run(['--merged', '1'])

		expect(report_orphans).not.toHaveBeenCalled()
	})
})
