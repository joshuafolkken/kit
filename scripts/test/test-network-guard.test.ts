import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT, platform_temporary } from '#scripts/josh/platform-temporary'
import { run_event_stream } from '#scripts/run/run-event-stream'
import { execaSync } from 'execa'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { test_network_guard } from './test-network-guard'
import { GUARD_LOG_KEY } from './unit-guard-environment'

// joshuafolkken/kit#1353. Every defect this guard can have fails *open*: a shim that cannot run, a
// record that cannot be read and a clean run are indistinguishable from the outside, and each one
// reports the suite green while the calls keep going out. So the shim is generated, written,
// executed and read back rather than inspected as text, and `disarm` is exercised on all three of
// its answers.

const BLOCKED_EXIT_CODE = 1
const TEMP_PREFIX = 'josh-network-guard-'
// A checkout under `/Users/o'brien` is not exotic, and an unquoted path there leaves the shim a
// shell syntax error that records nothing (review round 1 of joshuafolkken/kit#1353).
const APOSTROPHE_PREFIX = "josh-network-guard-o'brien-"
const API_ARGUMENTS = ['api', 'repos/joshuafolkken/kit/issues/1']
const ONE_CALL = 'gh api one'
const ANOTHER_CALL = 'gh api two'
const VERSION_CALL = 'gh --version'
const RECORDED_LINE = 'gh api repos/joshuafolkken/kit/issues/1'
const FETCH_ARGUMENTS = ['fetch', 'origin']
// A read that touches nothing outside the checkout, so it must reach the real binary.
const LOCAL_ARGUMENTS = ['rev-parse', '--is-inside-work-tree']
const RECORDED_FETCH = 'git fetch origin'
const TEMPORARY_ROOT_NAME = 'records'
// A name no `PATH` entry can hold, so the "not found" answer is exercised without depending on what
// this machine happens to have installed.
const ABSENT_BINARY = 'josh-no-such-binary-1515'

const directories: Array<string> = []

// Tracked rather than removed inline: `disarm` removes the directory its log sits in, so a case that
// asserts on `disarm` has nothing left to clean, and one that does not still must not leak.
function temporary_directory(prefix: string = TEMP_PREFIX): string {
	const directory = mkdtempSync(path.join(tmpdir(), prefix))

	directories.push(directory)

	return directory
}

afterEach(() => {
	for (const directory of directories) rmSync(directory, { recursive: true, force: true })
	directories.length = 0
})

// `arm` writes to the worker's own environment, and a case that armed a scratch guard must hand the
// rest of the worker back the real one — a leaked record path sends another test's findings nowhere.
const ARMED_KEYS: ReadonlyArray<string> = ['PATH', GUARD_LOG_KEY, platform_temporary.TEMP_ROOT_KEY]

function snapshot_environment(): Record<string, string | undefined> {
	return Object.fromEntries(ARMED_KEYS.map((key) => [key, process.env[key]]))
}

function restore_environment(snapshot: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) Reflect.deleteProperty(process.env, key)
		else process.env[key] = value
	}
}

// A temp root inside a tracked scratch directory. `arm`'s default is the real run's root keyed on
// this worker's pid, which nothing would remove.
function scratch_temporary_root(): string {
	return path.join(temporary_directory(), TEMPORARY_ROOT_NAME)
}

// A guard installed in a directory of its own, answering with that directory — the one thing every
// call takes, since the shim and its record both live inside it.
function armed_directory(prefix: string = TEMP_PREFIX): string {
	const directory = temporary_directory(prefix)

	test_network_guard.install_shim(directory)

	return directory
}

interface ShimRun {
	exit_code: number | undefined
	stderr: string
	log: string
}

function shim_of(directory: string, name: string = test_network_guard.SHIM_NAME): string {
	return path.join(directory, name)
}

// One armed directory, one spawn against the shim named in it, and everything the assertions read
// back. Both shims go through it — the binary differs and nothing else does.
function spawn_shim(name: string, args: ReadonlyArray<string>, prefix: string): ShimRun {
	const directory = armed_directory(prefix)
	const result = execaSync(shim_of(directory, name), args, { reject: false })

	return {
		exit_code: result.exitCode,
		stderr: result.stderr,
		log: readFileSync(test_network_guard.log_in(directory), 'utf8'),
	}
}

function run_shim(prefix: string = TEMP_PREFIX): ShimRun {
	return spawn_shim(test_network_guard.SHIM_NAME, API_ARGUMENTS, prefix)
}

function run_git(...args: Array<string>): ShimRun {
	return spawn_shim(test_network_guard.GIT_SHIM_NAME, args, TEMP_PREFIX)
}

describe('test_network_guard — what the shim does when it is spawned', () => {
	// One spawn for three assertions: the run is deterministic, and spawning a process is the most
	// expensive thing in this file by two orders of magnitude.
	let blocked: ShimRun

	beforeAll(() => {
		blocked = run_shim()
	})

	it('records the invocation it stood in for', () => {
		expect(blocked.log).toContain(RECORDED_LINE)
	})

	// Exiting 0 would be read as a repository that answered nothing, which is the shape the original
	// defect wore for as long as it went unnoticed.
	it('fails rather than passing as an empty answer', () => {
		expect(blocked.exit_code).toBe(BLOCKED_EXIT_CODE)
	})

	// Asserted on the spawned process's own stderr, not on the generated text: a redirect that lost
	// `>&2` would leave a text assertion green while the developer saw nothing.
	it('says why on stderr', () => {
		expect(blocked.stderr).toContain(test_network_guard.BLOCKED_MESSAGE)
	})

	it('still records from a path containing an apostrophe', () => {
		expect(run_shim(APOSTROPHE_PREFIX).log).toContain(RECORDED_LINE)
	})
})

// joshuafolkken/kit#1515: guarding `gh` alone left `git` as the other way out of the machine, and
// `git-pr-followup.test.ts` walked through it — a live `git fetch` per test, 4.1s each against a 10s
// timeout. This shim cannot simply refuse, the way the `gh` one does: half the suite reads its own
// repository with local `git`, so what is asserted here is the split — the network subcommands are
// refused and everything else reaches the real binary.
describe('test_network_guard — the git shim, which blocks by subcommand', () => {
	// The half that must keep working: a shim that refused this would stop the suite rather than the
	// network. Asserted through a real spawn — `exec`ing the wrong path fails here and nowhere in the
	// generated text.
	it('hands a local subcommand to the real binary', () => {
		const passed_through = run_git(...LOCAL_ARGUMENTS)

		expect(passed_through.exit_code).toBe(0)
		expect(passed_through.log).toBe('')
	})

	it('refuses and records a subcommand that opens a connection', () => {
		const blocked = run_git(...FETCH_ARGUMENTS)

		expect(blocked.exit_code).toBe(BLOCKED_EXIT_CODE)
		expect(blocked.log).toContain(RECORDED_FETCH)
		expect(blocked.stderr).toContain(test_network_guard.BLOCKED_MESSAGE)
	})

	// The regression the argument scan exists for. Reading `$1` as the subcommand finds `-C`, then the
	// directory after it, and lets the fetch through — silently, which is the only failure mode of this
	// guard that matters.
	it('still sees the subcommand behind a global option that takes a value', () => {
		expect(run_git('-C', tmpdir(), ...FETCH_ARGUMENTS).exit_code).toBe(BLOCKED_EXIT_CODE)
	})

	// The same option in its one-word spelling, which must *not* swallow the word after it.
	it('reads a local subcommand behind an inline option value', () => {
		expect(run_git('-c', 'user.name=nobody', ...LOCAL_ARGUMENTS).exit_code).toBe(0)
	})
})

describe('test_network_guard.resolve_binary — finding the real one', () => {
	it('finds the binary the shim has to hand its arguments to', () => {
		expect(test_network_guard.GIT_BINARY).toBeDefined()
	})

	// The branch that skips installing the git shim. It must answer "not found" rather than a path that
	// does not exist, or the shim would `exec` nothing and fail every local `git` in the suite.
	it('answers undefined rather than a path for a binary that is not there', () => {
		expect(test_network_guard.resolve_binary(ABSENT_BINARY)).toBeUndefined()
	})
})

// **The one case that is about this very run.** Everything else spawns a shim built for the test;
// this asks whether the suite it is running inside is actually behind one. A guard that installed
// nothing reports every run clean, so a green suite proves nothing until this passes.
describe('test_network_guard — armed for the run this test is part of', () => {
	it('resolves git through an armed guard directory', () => {
		const first_entry = (process.env['PATH'] ?? '').split(path.delimiter)[0] ?? ''

		expect(first_entry).toContain(test_network_guard.GUARD_PREFIX)
		expect(existsSync(shim_of(first_entry, test_network_guard.GIT_SHIM_NAME))).toBe(true)
	})
})

describe('test_network_guard.disarm — the three answers it has to tell apart', () => {
	it('throws when a call was recorded', () => {
		const directory = armed_directory()

		execaSync(shim_of(directory), API_ARGUMENTS, { reject: false })

		expect(() => {
			test_network_guard.disarm(directory)
		}).toThrow(test_network_guard.VIOLATION_HEADING)
	})

	it('says nothing when the run made no call', () => {
		expect(() => {
			test_network_guard.disarm(armed_directory())
		}).not.toThrow()
	})

	// The failure mode the whole guard exists to avoid: an unreadable record must not read as "no
	// violations", or the guard reports clean about a run it knows nothing about.
	it('throws rather than passing when its own record cannot be read', () => {
		const never_armed = temporary_directory()

		expect(() => {
			test_network_guard.disarm(never_armed)
		}).toThrow(test_network_guard.UNREADABLE_LOG_HEADING)
	})
})

describe('test_network_guard.arm — what the workers inherit', () => {
	it('puts the shim in front of the real gh on PATH', () => {
		const original = snapshot_environment()
		const directory = temporary_directory()

		try {
			test_network_guard.arm(directory, scratch_temporary_root())

			expect(process.env['PATH']).toBe(`${directory}${path.delimiter}${original['PATH'] ?? ''}`)
		} finally {
			restore_environment(original)
		}
	})

	// joshuafolkken/kit#2494: the in-process Telegram guard has no baked-in path, so it reads the record
	// from here, and the host-shared records follow the temp root it points at.
	it('hands the workers the record and a temp root of their own', () => {
		const original = snapshot_environment()
		const directory = temporary_directory()
		const temporary_root = scratch_temporary_root()

		try {
			test_network_guard.arm(directory, temporary_root)

			expect(process.env[GUARD_LOG_KEY]).toBe(test_network_guard.log_in(directory))
			expect(process.env[platform_temporary.TEMP_ROOT_KEY]).toBe(temporary_root)
			expect(existsSync(temporary_root)).toBe(true)
		} finally {
			restore_environment(original)
		}
	})
})

// The run's own records — the run event stream the parent session relays among them — must land in
// the armed temp root, never in the host's real one (joshuafolkken/kit#2494).
describe('test_network_guard — the records this run writes', () => {
	it('keys the run event stream under the armed temp root', () => {
		const stream = run_event_stream.target_of(process.cwd())

		expect(path.dirname(stream)).toBe(PLATFORM_TEMP_ROOT)
		expect(path.basename(PLATFORM_TEMP_ROOT).startsWith(test_network_guard.GUARD_PREFIX)).toBe(true)
		expect(path.dirname(PLATFORM_TEMP_ROOT)).toBe(
			platform_temporary.resolve_temporary_root(process.platform),
		)
	})
})

describe('test_network_guard.calls_of — reading the record back', () => {
	// An empty log and a log of one blank line must not read the same: the second would fail a run
	// that made no call at all.
	it('reads an empty log as no calls', () => {
		expect(test_network_guard.calls_of('\n \n')).toStrictEqual([])
	})

	it('keeps every recorded call', () => {
		expect(test_network_guard.calls_of(`${ONE_CALL}\n${ANOTHER_CALL}\n`)).toStrictEqual([
			ONE_CALL,
			ANOTHER_CALL,
		])
	})
})

describe('test_network_guard.describe_violations — what the failure says', () => {
	// One loop repeated forty times is one defect, and forty identical lines hide the second one.
	it('counts a repeated call rather than listing it again', () => {
		const described = test_network_guard.describe_violations([ONE_CALL, ONE_CALL])

		expect(described).toContain(`2x  ${ONE_CALL}`)
	})

	it('names each distinct call', () => {
		const described = test_network_guard.describe_violations([ONE_CALL, VERSION_CALL])

		expect(described).toContain(ONE_CALL)
		expect(described).toContain(VERSION_CALL)
	})

	it('leads with what the reader has to do about it', () => {
		expect(test_network_guard.describe_violations([ONE_CALL]).split('\n', 1)[0]).toBe(
			test_network_guard.VIOLATION_HEADING,
		)
	})
})
