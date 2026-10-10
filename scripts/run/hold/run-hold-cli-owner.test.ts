import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { process_identity } from '#scripts/josh/process-identity'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_preflight } from '#scripts/run/run-preflight'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_hold, type RunHold } from './run-hold'
import { run_hold_cli } from './run-hold-cli'

// joshuafolkken/kit#3419: a lane child's second `run:entry` answered `busy` to the hold it had taken
// itself. The claim now recognizes its own run by the issue, and a record whose session has ended as
// stale, while a live session's record for another issue still stops the claim.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

vi.mock('#scripts/run/run-preflight', () => ({
	run_preflight: { CLEAN_VERDICT: 'clean', check: vi.fn() },
}))

vi.mock('#scripts/run/tidy/run-tidy-cli', () => ({ run_tidy_cli: { sweep: vi.fn() } }))

const scratch = mkdtempSync(path.join(tmpdir(), 'run-hold-cli-owner-test-'))
const WORKTREE = path.join(scratch, '.git')
const TARGET = run_hold.hold_path(WORKTREE)
const ISSUE = '3419'
const OTHER_ISSUE = '3409'
const TAKEN_AT = new Date().toISOString()
const { DEAD_PID } = process_identity_fixture

const out: Array<string> = []

function record(fields: Partial<RunHold>): void {
	stamp_file.write_stamp(TARGET, { issue: ISSUE, taken_at: TAKEN_AT, pid: DEAD_PID, ...fields })
}

function held_issue(): string | undefined {
	const read = run_hold.read_hold(TARGET)

	return read.kind === 'held' ? read.hold.issue : undefined
}

beforeEach(() => {
	out.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		out.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, WORKTREE])
	vi.mocked(git_command.status).mockResolvedValue('')
	vi.mocked(run_preflight.check).mockResolvedValue({ advice: '', reason: '', verdict: 'clean' })
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	rmSync(TARGET, { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('the same run claiming again', () => {
	it('answers hold and keeps the record it wrote', async () => {
		record({ is_fullrun: true })

		await run_hold_cli.run([ISSUE])

		expect(out).toEqual([run_hold_cli.HOLD_VERDICT])
		expect(run_hold.read_hold(TARGET)).toMatchObject({
			kind: 'held',
			hold: { taken_at: TAKEN_AT, is_fullrun: true },
		})
	})

	it('still answers busy to a second unnumbered claim', async () => {
		record({ issue: run_hold.UNNUMBERED_ISSUE })

		await run_hold_cli.run([])

		expect(out).toEqual([run_hold_cli.BUSY_VERDICT])
	})
})

describe('a record whose session has ended', () => {
	it('is replaced rather than answered busy', async () => {
		record({ owner_pid: DEAD_PID })

		await run_hold_cli.run([OTHER_ISSUE])

		expect([out, held_issue()]).toStrictEqual([[run_hold_cli.HOLD_VERDICT], OTHER_ISSUE])
	})

	it('still stops the claim while a stop mark holds it for a person', async () => {
		record({ owner_pid: DEAD_PID, is_halfrun_stop: true })

		await run_hold_cli.run([OTHER_ISSUE])

		expect([out, held_issue()]).toStrictEqual([[run_hold_cli.BUSY_VERDICT], ISSUE])
	})
})

describe('a record a live session holds for another issue', () => {
	it('answers busy and leaves the record in place', async () => {
		record({ owner_pid: process.pid, owner_start: process_identity.own_start() })

		await run_hold_cli.run([OTHER_ISSUE])

		expect([out, held_issue()]).toStrictEqual([[run_hold_cli.BUSY_VERDICT], ISSUE])
	})
})

describe('the owner a claim records', () => {
	it('is the agent session the environment names', async () => {
		vi.stubEnv('CLAUDE_PID', String(process.pid))

		await run_hold_cli.run([ISSUE])

		expect(run_hold.read_hold(TARGET)).toMatchObject({ hold: { owner_pid: process.pid } })
	})

	it('is absent outside an agent session', async () => {
		vi.stubEnv('CLAUDE_PID', '')

		await run_hold_cli.run([ISSUE])

		const read = run_hold.read_hold(TARGET)

		expect(read.kind === 'held' ? read.hold.owner_pid : DEAD_PID).toBeUndefined()
	})
})
