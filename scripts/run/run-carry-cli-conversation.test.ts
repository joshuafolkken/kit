import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'
import { run_carry_cli_fixture } from './run-carry-cli-fixture'

// joshuafolkken/kit#3137, through the command a session actually types. `backlogrun #2847` began its
// record with `--owner "$PPID"` from a conversation whose process a VS Code restart then replaced; the
// conversation resumed in a new process, and the record — owned by a pid that had died — was taken
// over as a crash. The conversation is the session the environment names, so `--owner` records its
// transcript, and the resumed conversation is the owner whatever its new pid.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('./run-carry-stash', () => ({ run_carry_stash: { report_orphans: vi.fn() } }))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const { DEAD_PID } = process_identity_fixture

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-cli-conversation-test-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun #2847'
const SESSION_ID = 'conversation-3137'
const OTHER_SESSION_ID = 'another-conversation'

const out: Array<string> = []

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

function write_transcript(): void {
	const [directory] = cost_transcript.transcript_directories(process.cwd(), scratch)

	if (directory === undefined) throw new Error('no transcript directory for this checkout')

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `${SESSION_ID}.jsonl`), '{}\n')
}

function owner_pid(): number | undefined {
	const read = run_carry.read_carry(target())

	return read.kind === 'carried' ? read.carry.owner_pid : undefined
}

beforeEach(() => {
	run_carry_cli_fixture.hold_verdict()
	out.length = 0
	vi.spyOn(console, 'info').mockImplementation((text: string) => {
		out.push(text)
	})
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.stubEnv('HOME', scratch)
	vi.stubEnv('CLAUDE_CODE_SESSION_ID', SESSION_ID)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	write_transcript()
	run_carry.end_carry(target())
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	rmSync(target(), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('a record whose owner process restarted inside the same conversation', () => {
	it('refuses another session beginning over it', async () => {
		await run_carry_cli.run(['--begin', INVOCATION, '--owner', String(DEAD_PID)])
		vi.stubEnv('CLAUDE_CODE_SESSION_ID', OTHER_SESSION_ID)
		out.length = 0

		expect(await run_carry_cli.run(['--begin', INVOCATION, '--owner', String(process.pid)])).toBe(1)
		expect(out).toStrictEqual([run_carry_cli.BUSY_VERDICT])
	})

	it('lets the resumed conversation count, and moves the owner to its new process', async () => {
		await run_carry_cli.run(['--begin', INVOCATION, '--owner', String(DEAD_PID)])
		out.length = 0

		expect(await run_carry_cli.run(['--filed', '1', '--owner', String(process.pid)])).toBe(0)
		expect(out).toStrictEqual([run_carry_cli.COUNTED_VERDICT])
		expect(owner_pid()).toBe(process.pid)
	})
})
