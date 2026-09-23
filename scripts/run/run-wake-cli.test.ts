import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterAll, beforeEach, describe, expect, it, test, vi } from 'vitest'
import { run_carry } from './run-carry'
import { run_event_stream } from './run-event-stream'
import { run_wake } from './run-wake'
import { run_wake_cli } from './run-wake-cli'
import { run_wake_session } from './run-wake-session'

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
const OUTPUT_LABEL = 'output: '
const SUPERVISOR_PID = 4242
const SID = '11111111-1111-4111-8111-111111111111'

const out: Array<string> = []
const errors: Array<string> = []

function wake_target(): string {
	return run_wake.wake_path(REPOSITORY)
}

function carry_target(): string {
	return run_carry.carry_path(REPOSITORY)
}

// It is keyed on the scratch repository but written into the real temp directory, so it is removed
// with the records rather than by the scratch tree's own teardown.
function log_target(): string {
	return run_wake.wake_log_path(REPOSITORY)
}

// The run's event stream, keyed on the same directory `resolve_context` resolves — the primary
// checkout, whose own git directory is this common one (joshuafolkken/kit#2207).
function event_target(): string {
	return run_event_stream.target_of(REPOSITORY)
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
	rmSync(log_target(), { force: true })
	rmSync(event_target(), { force: true })
})

afterAll(() => {
	rmSync(scratch, { force: true, recursive: true })
	rmSync(log_target(), { force: true })
	rmSync(event_target(), { force: true })
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

	it('rejects an invalid scheduler profile before claiming that a supervisor started', async () => {
		write_carry(true)
		process.env['JOSH_SCHEDULER_EFFORT'] = 'turbo'

		try {
			expect(await run_wake_cli.run(['--start'])).toBe(FAILURE)
			expect(out).toStrictEqual([run_wake_cli.FAILED_VERDICT])
			expect(errors.join('\n')).toContain('JOSH_SCHEDULER_EFFORT=turbo')
			expect(run_wake.read_wake(wake_target())).toBeUndefined()
		} finally {
			delete process.env['JOSH_SCHEDULER_EFFORT']
		}
	})
})

test('start passes the inferred provider marker to the detached supervisor', async () => {
	write_carry(true)
	const launch = vi.spyOn(run_wake_session, 'launch').mockReturnValue({
		kind: 'launched',
		pid: SUPERVISOR_PID,
	})

	expect(await run_wake_cli.run(['--start'])).toBe(SUCCESS)
	expect(launch).toHaveBeenCalledWith(
		expect.objectContaining({ env: { CLAUDE_CODE_CHILD_SESSION: 'run-wake-supervisor' } }),
		expect.any(Function),
	)
	launch.mockRestore()
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
		const claimed = run_wake.count_claim(
			run_wake.count_wake(run_wake.fresh_wake(INVOCATION, NOW), NOW, 99, SID),
		)

		run_wake.write_wake(wake_target(), claimed)
		await run_wake_cli.run(['--list'])

		expect(errors.join('\n')).toContain('woke 1 session(s) across 2 cut(s)')
	})
})

// joshuafolkken/kit#2207: after a cut the ambient surface is the run's event stream, followed from
// `--list`, with `tail -F` on the raw stream named as a recovery path rather than the ambient one.
describe('josh run:wake --list — the ambient surface across the cut', () => {
	it('names the follow reader and the stream to recover from across the cut', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))

		expect(await run_wake_cli.run(['--list'])).toBe(SUCCESS)
		expect(errors.join('\n')).toContain('pnpm josh run:event --follow')
		expect(errors.join('\n')).toContain(`tail -F ${event_target()}`)
	})
})

describe('josh run:wake --list — the scheduler profile', () => {
	it('reports the profile recorded when the supervisor claimed the run', async () => {
		write_carry(false)
		const profile = agent_role_profile.DEFAULT_PROFILES.scheduler

		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW, profile))
		await run_wake_cli.run(['--list'])

		expect(errors.join('\n')).toContain(agent_role_profile.describe(profile))
	})
})

// joshuafolkken/kit#2207. A headless parent woken after a cut appends its progress to the run's event
// stream, so `--list` relays the newest event it holds — a person's one window onto the run once they
// are no longer the parent session, and the degenerate last-event read of the stream the attached
// session follows.
describe('josh run:wake --list — the woken session’s progress', () => {
	const AT = NOW.toISOString()
	const TEXT = '#1904 merged'
	const KIND = run_event_stream.EVENT_KIND.MERGE

	it('relays the newest event and keeps standard output one token', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))
		run_event_stream.append(event_target(), KIND, TEXT, AT)
		const line = run_event_stream.format_event({ pos: 1, at: AT, kind: KIND, text: TEXT })

		expect(await run_wake_cli.run(['--list'])).toBe(SUCCESS)
		expect(out).toStrictEqual([run_wake_cli.SUPERVISING_VERDICT])
		expect(errors.join('\n')).toContain(`progress: ${line}`)
	})

	// Before the first event there is no line, and "progress: (none)" on every pre-event listing is one
	// a reader stops seeing — so it is omitted, the way a count of zero outstanding launches is.
	it('says nothing about progress before the first event', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))

		await run_wake_cli.run(['--list'])

		expect(errors.join('\n')).not.toContain('progress:')
	})
})

// joshuafolkken/kit#1746. `--list` is what a person checking on a stalled backlog reads, so what it
// leaves out is what they cannot see.
describe('josh run:wake --list — what a stalled cut looks like', () => {
	// During the incident this line was the only thing a person could have read, and it said one wake
	// against one cut for forty minutes while nothing had ever arrived.
	it('reports the launches still outstanding, so a stalled cut is visible while it stalls', async () => {
		write_carry(true)
		run_wake.write_wake(
			wake_target(),
			run_wake.count_wake(run_wake.fresh_wake(INVOCATION, NOW), NOW, 99, SID),
		)

		await run_wake_cli.run(['--list'])

		expect(errors.join('\n')).toContain('woke 0 session(s) across 2 cut(s)')
		expect(errors.join('\n')).toContain('1 launch(es) outstanding')
	})

	// A path nobody is told is a file nobody reads, and reading it is the whole point of keeping it.
	it('names where the woken sessions’ output is kept', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))

		await run_wake_cli.run(['--list'])

		expect(errors.join('\n')).toContain(log_target())
	})

	// Nothing is outstanding before the first launch, and a line saying "0 outstanding" on every listing
	// is one a reader stops seeing.
	it('says nothing about outstanding launches where none is', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))

		await run_wake_cli.run(['--list'])

		expect(errors.join('\n')).not.toContain('outstanding')
	})
})

// joshuafolkken/kit#1746. `backlogrun.md` promises that a failure is visible rather than silent, and
// only one of the five reasons a supervisor can stop on was wired to the notification — so a run left
// asleep by an expired or unreadable carry record reached nobody at all.
describe('josh run:wake — which stops reach a person', () => {
	it('warns on the stops that leave a carried run with nobody watching it', () => {
		expect(run_wake_cli.stop_body('failed')).toBeDefined()
		expect(run_wake_cli.stop_body('expired')).toBeDefined()
		expect(run_wake_cli.stop_body('unreadable')).toBeDefined()
	})

	// The run finished, or a person stopped the supervisor themselves. A warning channel that fires on
	// those is one that stops being read.
	it('stays silent where nothing went wrong', () => {
		expect(run_wake_cli.stop_body('ended')).toBeUndefined()
		expect(run_wake_cli.stop_body('stopped')).toBeUndefined()
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

// joshuafolkken/kit#1759. The path was never wrong — `--list` and the launch read the same value from
// the same function. What was missing is the file: it was created only by the process that launched,
// at the moment it launched, so every verb that names the path without launching named one that need
// not exist.
describe('josh run:wake — the log exists at the path it names', () => {
	it('names a path that exists, so the listing can be acted on', async () => {
		write_carry(false)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, NOW))

		await run_wake_cli.run(['--list'])

		const named = errors.join('\n').split(OUTPUT_LABEL, 2)[1]?.split('\n', 1)[0]

		expect(named).toBe(log_target())
		expect(existsSync(log_target())).toBe(true)
	})

	// The already-running branch of `--start` prints the same listing and launches nothing, so it is
	// the path on which the file used to be named without anything ever creating it.
	it('leaves the log in place for a `--start` that found a supervisor already running', async () => {
		write_carry(true)
		run_wake.write_wake(wake_target(), run_wake.fresh_wake(INVOCATION, new Date()))

		expect(await run_wake_cli.run(['--start'])).toBe(SUCCESS)
		expect(existsSync(log_target())).toBe(true)
	})

	// Nothing to supervise is still a repository whose log path is resolvable, and an empty file there
	// is the honest answer rather than an absent one.
	it('creates the log even where there is no supervisor to list', async () => {
		await run_wake_cli.run(['--list'])

		expect(readFileSync(log_target(), 'utf8')).toBe('')
	})
})
