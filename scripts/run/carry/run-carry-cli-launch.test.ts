import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { backlogrun_launch } from '#scripts/backlog/backlogrun-launch'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_carry_cli } from './run-carry-cli'
import { run_carry_cli_fixture } from './run-carry-cli-fixture'

// joshuafolkken/kit#3696: `--begin` starts the run's clock where `josh backlogrun` launched its owner,
// so the board's `⏰` does not restart at the claim, and says the run is planning. A run with no launch
// of its own — one typed inside a session — still starts at its own `--begin`.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))
vi.mock('./run-carry-stash', () => ({ run_carry_stash: { report_orphans: vi.fn() } }))

const { git_command } = await import('#scripts/git/git-command')

const scratch = mkdtempSync(path.join(tmpdir(), 'run-carry-cli-launch-test-'))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5'
const OWNER = String(process.pid)
const LAUNCHED = new Date('2026-10-12T09:00:00.000Z')
const BEGIN = ['--begin', INVOCATION, '--owner', OWNER]

function target(): string {
	return run_carry.carry_path(REPOSITORY)
}

function event_target(): string {
	return run_event_stream.target_of(REPOSITORY)
}

function started_at(): string | undefined {
	const read = run_carry.read_carry(target())

	return read.kind === 'carried' ? read.carry.started_at : undefined
}

function stages(): ReadonlyArray<string> {
	return run_event_stream
		.read_events(event_target())
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.SETUP)
		.map((event) => event.text)
}

function clear(): void {
	rmSync(target(), { force: true })
	rmSync(event_target(), { force: true })
}

beforeEach(() => {
	run_carry_cli_fixture.hold_verdict()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.mocked(git_command.git_directories).mockResolvedValue([WORKTREE, REPOSITORY])
	clear()
})

afterEach(() => {
	vi.restoreAllMocks()
	clear()
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('run:carry --begin under a launch', () => {
	it('starts the run when its owner was launched, asking for this repository and owner', async () => {
		const started_for = vi.spyOn(backlogrun_launch, 'started_for').mockReturnValue(LAUNCHED)

		expect(await run_carry_cli.run(BEGIN)).toBe(0)
		expect(started_for).toHaveBeenCalledExactlyOnceWith(REPOSITORY, process.pid)
		expect(started_at()).toBe(LAUNCHED.toISOString())
	})

	it('starts the run now where no launch is this owner’s', async () => {
		vi.spyOn(backlogrun_launch, 'started_for').mockReturnValue(undefined)
		const before = Date.now()

		await run_carry_cli.run(BEGIN)

		expect(Date.parse(started_at() ?? '')).toBeGreaterThanOrEqual(before)
	})

	it('starts the run now with no launch record at all, as a run typed in a session does', async () => {
		const before = Date.now()

		await run_carry_cli.run(['--begin', INVOCATION])

		expect(Date.parse(started_at() ?? '')).toBeGreaterThanOrEqual(before)
	})
})

// joshuafolkken/kit#5516: the launch already handed the record to the supervisor.
function handed_off(): void {
	run_carry.apply_change(target(), run_carry.fresh_carry(INVOCATION, { pid: 1 }, LAUNCHED), {
		cuts: 1,
	})
}

describe('run:carry --begin from the launched parent', () => {
	it('answers driving and leaves the record handed off', async () => {
		handed_off()
		vi.spyOn(backlogrun_launch, 'running_parent').mockReturnValue(process.pid)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await run_carry_cli.run(BEGIN)).toBe(0)
		expect(info).toHaveBeenCalledWith('driving')
		expect(run_carry.read_carry(target())).toMatchObject({ carry: { is_handed_off: true } })
	})

	it('still resumes the record for a session the launch did not start', async () => {
		handed_off()
		vi.spyOn(backlogrun_launch, 'running_parent').mockReturnValue(undefined)

		expect(await run_carry_cli.run(BEGIN)).toBe(0)
		expect(run_carry.read_carry(target())).toMatchObject({ carry: { is_handed_off: false } })
	})
})

describe('run:carry --begin setup stage', () => {
	it('says the run is planning once it has begun', async () => {
		await run_carry_cli.run(BEGIN)

		expect(stages()).toStrictEqual([run_event_setup.STAGE.PLANNING])
	})

	it('says nothing more when the same invocation is typed over a standing record', async () => {
		await run_carry_cli.run(BEGIN)
		await run_carry_cli.run(BEGIN)

		expect(stages()).toHaveLength(1)
	})

	it('says nothing when it resumes a record a cut handed off', async () => {
		const carry = run_carry.fresh_carry(INVOCATION, run_carry.NO_OWNER, LAUNCHED)

		run_carry.apply_change(target(), carry, { cuts: 1 })

		expect(await run_carry_cli.run(['--begin', INVOCATION])).toBe(0)
		expect(stages()).toStrictEqual([])
		expect(started_at()).toBe(LAUNCHED.toISOString())
	})
})
