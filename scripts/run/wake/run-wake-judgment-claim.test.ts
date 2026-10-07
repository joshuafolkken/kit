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

// joshuafolkken/kit#3238: a session woken on a judgment branch is handed a record the supervisor has
// already handed off. Followed as the hand-off material words it — claim, act, cut — the session's
// counts land and the supervisor reads the wake as claimed; skipping the claim is refused outright.

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
const CLAIM_PATTERN = /--resume "(?<invocation>[^"]+)" --owner "\$PPID"/u
const SUCCESS = 0
// The woken session's `$PPID`: a live process that is not the supervisor running this suite.
const SESSION_OWNER = String(process.ppid)
const OWNER = ['--owner', SESSION_OWNER]

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

// The supervisor's half of a judgment wake: drive to the branch, hand the record off, and return the
// material the woken session is launched with.
async function wake_on_judgment(): Promise<string> {
	vi.spyOn(josh_command, 'josh_run').mockResolvedValueOnce({ code: SUCCESS, out: DRIVER_OUTPUT })
	const driven = await run_wake_driver.drive(target())

	if (driven.kind !== 'judgment') throw new Error(`expected a judgment, got ${driven.kind}`)
	run_wake_handoff.hand_off(target())

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
	it('is counted as a claimed wake once it follows the material: claim, merge, cut', async () => {
		const material = await wake_on_judgment()
		const invocation = CLAIM_PATTERN.exec(material)?.groups?.['invocation']

		expect(invocation).toBe(INVOCATION)
		expect(await run_carry_cli.run(['--resume', invocation ?? '', ...OWNER])).toBe(SUCCESS)
		expect(supervisor_decision()).toBe('wait')
		expect(await run_carry_cli.run(['--merged', '1', ...OWNER])).toBe(SUCCESS)
		expect(merged_count()).toBe(1)
		expect(await run_carry_cli.run(['--cut', ...OWNER])).toBe(SUCCESS)
		expect(run_carry.read_carry(target())).toMatchObject({ carry: { is_handed_off: true } })
	})

	it('has its merge refused when it skips the claim', async () => {
		await wake_on_judgment()

		expect(await run_carry_cli.run(['--merged', '1', ...OWNER])).not.toBe(SUCCESS)
		expect(merged_count()).toBe(0)
		expect(supervisor_decision()).not.toBe('wait')
	})
})
