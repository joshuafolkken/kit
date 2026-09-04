import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// The unit suite must not reach the network, and until joshuafolkken/kit#1353 nothing said so out
// loud. One test in `epic-bundle-cli.test.ts` mocked the listing read but not the per-issue relation
// read, so `fetch_backlog` called through to a live `gh api` against real issues — 768ms against its
// 26 siblings' 0–1ms, and a CI failure at the 10-second test timeout that had nothing to do with
// the change under test (PR #1351). Three more in `doctor-report.test.ts` drove `doctor.main()`
// without stubbing the Dependabot read and spawned `gh api …/automated-security-fixes` for real.
//
// Fixing those four is the repair; this file is what keeps it repaired. A one-off audit answers for
// the suite as it stands today and for nothing after it — and the failure mode is invisible by
// construction, because a test that calls through still *passes*, just slowly and against whatever
// GitHub happens to answer.
//
// **The guard is a `PATH` shim rather than a module mock.** `gh` is spawned from at least four
// places (`git-gh-exec.ts`, `gh-spawn.ts`, `git-gh-check.ts`, `repo-setting.ts`) through both
// `execa` and `execaSync`, and a test may also spawn a CLI subprocess that spawns `gh` in turn —
// which is exactly how the `doctor` cases reached the network. Intercepting the binary catches every
// one of those shapes, including the ones nobody thought of; mocking a module catches only the
// import graph the mock was written against.
//
// It is deliberately not `gh-subcommand-guard.ts`. That one reads source text and proves a call was
// *written*; this one observes the run and proves a call was *made*.
//
// **Every failure mode here has to be loud, because the guard's own defects fail open.** A shim that
// cannot run, a log that cannot be read and a clean run all look alike from the outside — so the
// path is quoted rather than interpolated, and an unreadable record throws instead of reading as
// "no violations".
//
// **On Windows it guards nothing, knowingly.** PATH resolution there selects `gh.exe` / `gh.cmd` and
// never a `#!/bin/sh` file named `gh`, so the suite would reach the network with the guard reporting
// clean. CI and every current checkout are POSIX; a `.cmd` companion is what to add if that changes.

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// Keyed by the process that armed it. `josh gate`'s unit step and a `josh test:related` run can be
// in flight in the same checkout at once, and one shared log means the second run truncates the
// first one's records and then inherits whatever the other recorded.
const GUARD_DIRECTORY = path.join(
	PROJECT_ROOT,
	'node_modules',
	'.cache',
	`unit-network-guard-${String(process.pid)}`,
)
const LOG_FILE = path.join(GUARD_DIRECTORY, 'gh-calls.log')
// The binary being stood in for. Single-sourced because it is two things at once: the file name that
// has to shadow the real one on `PATH`, and the word each recorded line starts with.
const SHIM_NAME = 'gh'
// Owner-writable, everyone-executable: the shim is spawned by the test workers, never edited.
const SHIM_MODE = 0o755

const BLOCKED_MESSAGE = 'josh: the unit suite must not spawn gh — mock the read instead'
const VIOLATION_HEADING =
	'The unit suite spawned gh, which makes a live network call. Mock the read in the test that made it:'
const UNREADABLE_LOG_HEADING =
	'The unit-suite network guard could not read its own record, so the run proves nothing:'

// One `sh` word, quoted. A path holding an apostrophe would otherwise close the quote and leave the
// shim a syntax error — and that fails *open*: the shim writes nothing, the log reads empty, and a
// run in which every call went out is reported clean.
const SINGLE_QUOTE = "'"

function quoted(value: string): string {
	// `sh` has no escape inside single quotes, so an apostrophe is written by closing the quote,
	// emitting an escaped one, and opening a new quote: `'\''`.
	return SINGLE_QUOTE + value.replaceAll("'", String.raw`'\''`) + SINGLE_QUOTE
}

// The shim records the invocation and fails, so a caller that ignores the exit code still leaves a
// trace. `exit 1` rather than `exit 0`: a spawn that succeeds with empty output is indistinguishable
// from a repository that answers nothing, and the reads here degrade that into "unreadable" — which
// is what let the original defect pass as a green test for as long as it did.
function shim_script(log_file: string): string {
	return [
		'#!/bin/sh',
		String.raw`printf '%s\n' "${SHIM_NAME} $*" >> ${quoted(log_file)}`,
		`echo ${quoted(BLOCKED_MESSAGE)} >&2`,
		'exit 1',
		'',
	].join('\n')
}

// The recorded invocations, blank lines dropped. Split out from the read so the parsing is testable
// without a run: an empty log and a log of one empty line must not read the same.
function calls_of(log_text: string): Array<string> {
	return log_text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
}

// Each distinct command once, with its count — a single loop repeated 40 times is one defect, and a
// list of 40 identical lines hides the second one under it.
function describe_violations(calls: ReadonlyArray<string>): string {
	const counts = new Map<string, number>()

	for (const call of calls) counts.set(call, (counts.get(call) ?? 0) + 1)

	const lines = [...counts].map(([call, count]) => `  ${String(count)}x  ${call}`)

	return [VIOLATION_HEADING, ...lines].join('\n')
}

// The shim, written where it will be spawned from. Shared with this module's own test rather than
// re-written there: a test that builds its own copy proves that copy works and says nothing about
// the one the suite actually runs behind.
function install_shim(directory: string = GUARD_DIRECTORY, log_file: string = LOG_FILE): string {
	const shim_file = path.join(directory, SHIM_NAME)

	mkdirSync(directory, { recursive: true })
	writeFileSync(log_file, '')
	writeFileSync(shim_file, shim_script(log_file))
	chmodSync(shim_file, SHIM_MODE)

	return shim_file
}

// `undefined` for a record that could not be read, which is not the same answer as an empty one:
// the shim runs in its own process and the test workers are processes again, so the only evidence
// this side has is the file — and "the file is not there" says nothing about what the run did.
function read_log(log_file: string): string | undefined {
	try {
		return readFileSync(log_file, 'utf8')
	} catch {
		return undefined
	}
}

function recorded_calls(log_file: string = LOG_FILE): Array<string> {
	return calls_of(read_log(log_file) ?? '')
}

// `globalSetup` runs before any worker is forked, so the workers inherit this `PATH` and every `gh`
// they spawn — directly or through a CLI subprocess of their own — resolves to the shim.
function arm(directory: string = GUARD_DIRECTORY, log_file: string = LOG_FILE): void {
	install_shim(directory, log_file)
	process.env['PATH'] = `${directory}${path.delimiter}${process.env['PATH'] ?? ''}`
}

// Thrown rather than logged: a warning on a suite that already exited 0 is a warning nobody reads,
// which is the state joshuafolkken/kit#1353 was filed from. The directory goes either way, so a
// failing run does not leave the next one reading its records.
function disarm(log_file: string = LOG_FILE): void {
	const log_text = read_log(log_file)

	try {
		if (log_text === undefined) throw new Error(`${UNREADABLE_LOG_HEADING} ${log_file}`)

		const calls = calls_of(log_text)

		if (calls.length > 0) throw new Error(describe_violations(calls))
	} finally {
		rmSync(path.dirname(log_file), { recursive: true, force: true })
	}
}

// Vitest's `globalSetup` contract: a named `setup` whose return value becomes the teardown.
function setup(): () => void {
	arm()

	return disarm
}

const test_network_guard = {
	BLOCKED_MESSAGE,
	GUARD_DIRECTORY,
	LOG_FILE,
	SHIM_NAME,
	UNREADABLE_LOG_HEADING,
	VIOLATION_HEADING,
	arm,
	calls_of,
	describe_violations,
	disarm,
	install_shim,
	recorded_calls,
	shim_script,
}

export { setup, test_network_guard }
