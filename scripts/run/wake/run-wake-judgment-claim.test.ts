import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { josh_command } from '#scripts/josh/josh-run'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_carry_cli } from '#scripts/run/carry/run-carry-cli'
import { run_carry_cli_fixture } from '#scripts/run/carry/run-carry-cli-fixture'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_driver } from './run-wake-driver'
import { run_wake_handoff } from './run-wake-handoff'

// joshuafolkken/kit#3238, joshuafolkken/kit#5743: a session woken on a judgment branch is handed a
// record the supervisor has already adopted for it. Followed as the hand-off material words it — act,
// then the turn-end's cut, no claim — the session's counts land and the supervisor reads the wake as
// claimed; a count from any other live process is refused.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const scratch = mkdtempSync(path.join(tmpdir(), 'run-wake-judgment-claim-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --idle 0'
const DRIVER_OUTPUT = 'watch\nresume: --owner 1'
const SUCCESS = 0
// The woken session's own process: a live process that is not the supervisor running this suite.
const SESSION_PID = process.ppid
const OWNER = ['--owner', String(SESSION_PID)]
// The supervisor's own process, which is not the session.
const FOREIGN_OWNER = ['--owner', String(process.pid)]
const SESSION = { worktree: WORKTREE, session_id: 'woken', provider: 'anthropic' } as const

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

// The supervisor's half of a judgment wake: drive to the branch, adopt the record for the session
// before its launch, move the owner to the launched process, and return the material it is woken with.
async function wake_on_judgment(): Promise<string> {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValueOnce({ code: SUCCESS, out: DRIVER_OUTPUT })
	const driven = await run_wake_driver.drive(target())

	if (driven.kind !== 'judgment') throw new Error(`expected a judgment, got ${driven.kind}`)
	const owner = run_wake_handoff.session_owner(SESSION)

	run_wake_handoff.hand_to(target(), owner)
	run_wake_handoff.hand_on(target(), owner, SESSION_PID)

	return driven.material
}

function supervisor_decision(): string {
	const read = run_carry.read_carry(target())
	const is_owner_live = read.kind === 'carried' && run_carry.is_owner_live(read.carry)

	return run_wake.decide({
		read,
		woke_at: new Date().toISOString(),
		attempts: 1,
		is_owner_live,
		now: new Date(),
	}).kind
}

function merged_count(): number | undefined {
	const read = run_carry.read_carry(target())

	return read.kind === 'carried' ? read.carry.merged : undefined
}

beforeEach(() => {
	vi.restoreAllMocks()
	run_carry_cli_fixture.hold_verdict()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	run_carry.end_carry(target())
	run_carry.begin_carry(target(), INVOCATION, run_carry.NO_OWNER, new Date())
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(scratch, { force: true, recursive: true })
})

describe('a session woken on a judgment branch', () => {
	it('is counted as a claimed wake once it follows the material with no claim: merge, cut', async () => {
		const material = await wake_on_judgment()

		expect(material).not.toContain('--resume')
		expect(supervisor_decision()).toBe('wait')
		expect(await run_carry_cli.run(['--merged', '1', ...OWNER])).toBe(SUCCESS)
		expect(merged_count()).toBe(1)
		expect(await run_carry_cli.run(['--cut', ...OWNER])).toBe(SUCCESS)
		expect(run_carry.read_carry(target())).toMatchObject({ carry: { is_handed_off: true } })
	})

	it('still answers a session that claims with --resume as before', async () => {
		await wake_on_judgment()

		expect(await run_carry_cli.run(['--resume', INVOCATION, ...OWNER])).toBe(SUCCESS)
		expect(supervisor_decision()).toBe('wait')
		expect(await run_carry_cli.run(['--merged', '1', ...OWNER])).toBe(SUCCESS)
		expect(merged_count()).toBe(1)
	})

	it('refuses a count from a live process that is not the woken session', async () => {
		await wake_on_judgment()

		expect(await run_carry_cli.run(['--merged', '1', ...FOREIGN_OWNER])).not.toBe(SUCCESS)
		expect(merged_count()).toBe(0)
	})
})
