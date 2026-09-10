import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_wake } from './run-wake'
import { run_wake_cli } from './run-wake-cli'

// joshuafolkken/kit#1719. Two things are pinned here: standard output is one verdict token on every
// path, and a person can find the supervisor and stop it — the last acceptance criterion, and the one
// that decides whether an unattended mechanism is one a person still controls.

vi.mock('#scripts/git/git-command', () => ({
	git_command: { git_directories: vi.fn(), status: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const git_directories = vi.mocked(git_command.git_directories)

const TEST_PREFIX = 'run-wake-cli-test-'
const scratch = mkdtempSync(path.join(tmpdir(), TEST_PREFIX))
const WORKTREE = path.join(scratch, 'worktree.git')
const REPOSITORY = path.join(scratch, 'repository.git')
const INVOCATION = 'backlogrun --max 5 --idle 30'
const NOW = new Date('2026-09-10T12:00:00.000Z')
const DEAD_START = 'a start time no live process has'
const SUCCESS = 0
const FAILURE = 1
const LOOP_FLAG = '--loop'
const INTERVAL_FLAG = '--interval'

const out: Array<string> = []
const errors: Array<string> = []

function wake_target(): string {
	return run_wake.wake_path(REPOSITORY)
}

function carry_target(): string {
	return run_carry.carry_path(REPOSITORY)
}

// Written as a stamp rather than through `begin_carry`, because what these cases turn on is a record
// that has already been counted into and cut — the state a supervisor actually meets.
function write_carry(is_handed_off: boolean): void {
	stamp_file.remove_stamp(carry_target())
	stamp_file.write_stamp(carry_target(), {
		invocation: INVOCATION,
		started_at: new Date().toISOString(),
		merged: 3,
		filed: 1,
		cuts: 2,
		is_handed_off,
	})
}

beforeEach(() => {
	out.length = 0
	errors.length = 0
	vi.spyOn(console, 'info').mockImplementation((text: string) => {
		out.push(text)
	})
	vi.spyOn(console, 'error').mockImplementation((text: string) => {
		errors.push(text)
	})
	git_directories.mockResolvedValue([WORKTREE, REPOSITORY])
	run_wake.remove_wake(wake_target())
	run_carry.end_carry(carry_target())
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
})

describe('josh run:wake — the stdout contract', () => {
	it('refuses an invocation naming no verb', async () => {
		expect(await run_wake_cli.run([])).toBe(FAILURE)
		expect(errors).toContain(run_wake_cli.USAGE)
	})

	it('refuses two verbs at once rather than guessing an order', async () => {
		expect(await run_wake_cli.run(['--start', '--stop'])).toBe(FAILURE)
		expect(errors).toContain(run_wake_cli.USAGE)
	})

	it('refuses an interval that is not a whole positive number of seconds', async () => {
		expect(await run_wake_cli.run([LOOP_FLAG, INTERVAL_FLAG, '0'])).toBe(FAILURE)
	})

	// `setTimeout` clamps a delay past 2^31−1 ms to one millisecond, so an interval large enough to
	// look like "poll rarely" produces the busy loop the lower bound exists to prevent.
	it('refuses an interval large enough to wrap round to a busy loop', async () => {
		expect(await run_wake_cli.run([LOOP_FLAG, INTERVAL_FLAG, '3000000'])).toBe(FAILURE)
	})

	it('prints exactly one token on standard output', async () => {
		await run_wake_cli.run(['--list'])

		expect(out).toHaveLength(1)
	})
})

describe('josh run:wake --start', () => {
	// Starting a supervisor over a run that is not carrying anything would produce a `started` that
	// ends a second later, which is worse than a refusal naming the reason.
	it('refuses when nothing is carrying a budget here', async () => {
		expect(await run_wake_cli.run(['--start'])).toBe(FAILURE)
		expect(out).toStrictEqual([run_wake_cli.NONE_VERDICT])
	})

	it('refuses when a supervisor is already running', async () => {
		write_carry(true)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))

		expect(await run_wake_cli.run(['--start'])).toBe(SUCCESS)
		expect(out).toStrictEqual([run_wake_cli.RUNNING_VERDICT])
	})
})

describe('josh run:wake --list — a person can see what is running', () => {
	it('says so when no supervisor is running', async () => {
		expect(await run_wake_cli.run(['--list'])).toBe(SUCCESS)
		expect(out).toStrictEqual([run_wake_cli.NONE_VERDICT])
	})

	it('names the invocation, the process and the way to stop it', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))

		expect(await run_wake_cli.run(['--list'])).toBe(SUCCESS)
		expect(out).toStrictEqual([run_wake_cli.SUPERVISING_VERDICT])
		expect(errors.join('\n')).toContain(INVOCATION)
		expect(errors.join('\n')).toContain('pnpm josh run:wake --stop')
	})

	// A caller branching on the one stdout token — the documented use — must not read `supervising`
	// for a supervisor that a crash or a reboot took away.
	it('says stale rather than supervising when the recorded process is gone', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), {
			...run_wake.fresh_wake(INVOCATION, NOW),
			pid: 0,
			process_start: DEAD_START,
		})

		expect(await run_wake_cli.run(['--list'])).toBe(SUCCESS)
		expect(out).toStrictEqual([run_wake_cli.STALE_VERDICT])
	})

	// The count and the carry record's `cuts` being equal is the invariant; printing them together is
	// what makes it checkable rather than merely argued.
	it('reports the wake count beside the run’s cut count', async () => {
		write_carry(false)
		const woken = run_wake.count_wake(run_wake.fresh_wake(INVOCATION, NOW), NOW, 99)

		run_wake.write_wake(wake_target(), woken)
		await run_wake_cli.run(['--list'])

		expect(errors.join('\n')).toContain('woke 1 session(s) across 2 cut(s)')
	})
})

describe('josh run:wake --stop — a person can stop it', () => {
	it('says so when there is nothing to stop', async () => {
		expect(await run_wake_cli.run(['--stop'])).toBe(SUCCESS)
		expect(out).toStrictEqual([run_wake_cli.NONE_VERDICT])
	})

	// Removing the record is the stop signal the loop reads, so the record must be gone afterwards
	// whether or not the process could be signalled.
	it('removes the record, which is what ends the loop', async () => {
		run_wake.write_wake(wake_target(), {
			...run_wake.fresh_wake(INVOCATION, NOW),
			pid: 0,
			process_start: DEAD_START,
		})

		expect(await run_wake_cli.run(['--stop'])).toBe(SUCCESS)
		expect(out).toStrictEqual([run_wake_cli.STOPPED_VERDICT])
		expect(run_wake.read_wake(wake_target())).toBeUndefined()
	})
})

describe('josh run:wake — no repository', () => {
	it('answers unknown rather than acting when the repository cannot be resolved', async () => {
		git_directories.mockResolvedValue([])

		expect(await run_wake_cli.run(['--list'])).toBe(FAILURE)
		expect(out).toStrictEqual([run_wake_cli.UNKNOWN_VERDICT])
	})
})
