import {
	accessSync,
	chmodSync,
	constants,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shim_shell } from './shim-shell'
import { test_repository_guard, type WriteGuard } from './test-repository-guard'

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
// **`git` is guarded too, and differently** (joshuafolkken/kit#1515). Guarding `gh` alone left the
// other way out of the machine wide open: `git-pr-followup.test.ts` and its stages suite drove
// `notify_completion`, whose release count fetches `origin/<default>` for real — 4.1s per test on the
// machine it was found on, fifteen tests in one file, against a 10s test timeout. The two files were
// half the unit suite's wall clock and failed the pre-push gate non-deterministically, on an idle
// machine as readily as under parallel load: 63.7s of wall clock against 14.9 CPU-seconds, three
// quarters of it spent waiting rather than computing. That is the same defect this file's header
// describes for `gh`, wearing a different binary's name, and the same one-off-audit argument applies
// — so the mechanism is reused rather than a second one written.
//
// **The `git` shim blocks by subcommand and passes everything else through**, which is the one way it
// differs from the `gh` shim. `gh` has no business in the unit suite at all, so its shim blocks
// outright; `git` is how half these tests read the repository they are about — `status`, `log`,
// `rev-parse`, the worktree machinery the lane suites drive — and a shim that refused those would
// stop the suite rather than the network. Only the subcommands that open a connection are refused,
// and the rest `exec` the real binary at the absolute path resolved before `PATH` was touched, so a
// subprocess that spawns `git` in turn is still behind the shim.
//
// **The `git` shim also refuses a write into the repository the suite is running in**
// (joshuafolkken/kit#1530). That is a second dimension rather than a second guard: the arming, the
// `PATH` shim, the shared record and the teardown that throws are all this file's, and only the `sh`
// that decides comes from `test-repository-guard.ts`, which is where the defect, the two findings
// and what is deliberately left unguarded are written down. Sharing the record is what lets one run
// report both kinds — `describe_violations` puts each under its own heading rather than filing a
// stray commit under "mock the read".
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
//
// The prefix is named on its own because two readers need it without rebuilding the whole path: a
// test recognizing an armed directory on `PATH` — the pid in it is `globalSetup`'s, and a worker
// asking has a different one — and `resolve_binary`, which must not find a shim where it is looking
// for the real binary.
const GUARD_PREFIX = 'unit-network-guard-'
const GUARD_DIRECTORY = path.join(
	PROJECT_ROOT,
	'node_modules',
	'.cache',
	`${GUARD_PREFIX}${String(process.pid)}`,
)
// One record for both shims. Each line starts with the binary's own name, so a mixed run still says
// which call was which, and one log means `disarm` has one place to look.
const LOG_NAME = 'network-calls.log'
// The binaries being stood in for. Single-sourced because each is two things at once: the file name
// that has to shadow the real one on `PATH`, and the word each recorded line starts with.
const SHIM_NAME = 'gh'
const GIT_SHIM_NAME = 'git'
// Owner-writable, everyone-executable: the shim is spawned by the test workers, never edited.
const SHIM_MODE = 0o755

// The `git` subcommands that open a connection. Everything absent from this list is local and is
// handed to the real binary untouched — see the header on why this shim blocks by subcommand where
// the `gh` one blocks outright.
//
// **`remote`, `submodule` and `archive` are refused whole, though each has local spellings.**
// `remote update` and `remote prune` reach the network while `remote -v` does not; `submodule update`
// fetches while `submodule status` does not; `archive --remote=` does while a plain `archive` does
// not. Splitting on the flag would put that judgement inside a `sh` `case`, and getting it wrong there
// fails **open** — the call goes out and the log stays empty, which is the one failure mode this file
// exists to make impossible. Refusing the whole subcommand fails closed instead, and costs nothing
// real: the unit suite has no business shelling out to any of them, and none of the repository's
// tests does.
const GIT_NETWORK_SUBCOMMANDS: ReadonlyArray<string> = [
	'archive',
	'clone',
	'fetch',
	'ls-remote',
	'pull',
	'push',
	'remote',
	'send-email',
	'submodule',
]
// Git's global options that take their value as a *separate* word. Without them `git -C <dir> fetch`
// reads `<dir>` as the subcommand, finds it on no list, and lets the fetch through — which is the
// precise shape of failure this guard exists to notice. The `--option=value` spellings need no entry:
// they are one word, and the `-*` arm already skips them.
const GIT_VALUE_OPTIONS: ReadonlyArray<string> = [
	'-C',
	'-c',
	'--git-dir',
	'--namespace',
	'--super-prefix',
	'--work-tree',
]

const BLOCKED_MESSAGE = 'josh: the unit suite must not reach the network — mock the read instead'
const VIOLATION_HEADING =
	'The unit suite made a live network call. Mock the read in the test that made it:'
const UNREADABLE_LOG_HEADING =
	'The unit-suite network guard could not read its own record, so the run proves nothing:'

// The three lines a block writes, shared by both shims so a `git` violation is recorded, explained
// and failed exactly as a `gh` one is. `$*` rather than `$@` because the record is a line of prose
// for a person to read, not something re-executed.
function blocking_lines(log_file: string, name: string): Array<string> {
	return [
		shim_shell.record_line(log_file, `${name} $*`),
		`echo ${shim_shell.quoted(BLOCKED_MESSAGE)} >&2`,
		'exit 1',
	]
}

// The shim records the invocation and fails, so a caller that ignores the exit code still leaves a
// trace. `exit 1` rather than `exit 0`: a spawn that succeeds with empty output is indistinguishable
// from a repository that answers nothing, and the reads here degrade that into "unreadable" — which
// is what let the original defect pass as a green test for as long as it did.
function shim_script(log_file: string): string {
	return ['#!/bin/sh', ...blocking_lines(log_file, SHIM_NAME), ''].join('\n')
}

// The `git` shim: find the subcommand, refuse it if it opens a connection, otherwise `exec` the real
// binary. **The scan is what makes it correct rather than the list** — git accepts its own global
// options before the subcommand, so the first word is not necessarily the subcommand, and a shim that
// read `$1` would pass `git -C <dir> fetch` straight through. `skip` consumes the value of an option
// that takes one; `-*` skips the rest; the first bare word is the subcommand, and reaching it without
// a match ends the scan.
//
// `exec` rather than a call, so the real `git`'s exit code and signals are the shim's own — a caller
// checking either must not be able to tell the shim is there.
// The writing arm, from joshuafolkken/kit#1530. Unlike the network arm it does not refuse on sight:
// the `sh` it splices in decides, and `break` ends the scan when it lets the command through — the
// subcommand has been found either way.
function guarded_arm(
	subcommands: ReadonlyArray<string>,
	body: ReadonlyArray<string>,
): Array<string> {
	return [
		`\t\t${subcommands.join('|')})`,
		...body.map((line) => `\t\t\t${line}`),
		'\t\t\tbreak',
		'\t\t\t;;',
	]
}

// The two arms from joshuafolkken/kit#1530. Unlike the network arm neither refuses on sight — the
// `sh` spliced in decides — and each ends in `break`, because the subcommand has been found whether
// or not it was let through.
function git_write_arms(guard: WriteGuard): Array<string> {
	return [
		...guarded_arm(
			test_repository_guard.GIT_WRITING_SUBCOMMANDS,
			test_repository_guard.write_guard_lines(guard),
		),
		...guarded_arm(
			test_repository_guard.GIT_AMBIGUOUS_SUBCOMMANDS,
			test_repository_guard.environment_guard_lines(guard.log_file),
		),
	]
}

// The scan itself: `skip` consumes the value of an option that takes one, `guard_seen` counts the
// words git's own global options took, and the first bare word ends it.
function git_scan_lines(guard: WriteGuard): Array<string> {
	return [
		'for arg in "$@"; do',
		'\tif [ "$skip" = 1 ]; then skip=0; guard_seen=$((guard_seen + 1)); continue; fi',
		'\tcase "$arg" in',
		`\t\t${GIT_VALUE_OPTIONS.join('|')}) skip=1 ;;`,
		`\t\t${GIT_NETWORK_SUBCOMMANDS.join('|')})`,
		...blocking_lines(guard.log_file, GIT_SHIM_NAME).map((line) => `\t\t\t${line}`),
		'\t\t\t;;',
		...git_write_arms(guard),
		'\t\t-*) ;;',
		'\t\t*) break ;;',
		'\tesac',
		'\tguard_seen=$((guard_seen + 1))',
		'done',
	]
}

function git_shim_script(
	log_file: string,
	git_binary: string,
	guarded_directory: string | undefined,
): string {
	return [
		'#!/bin/sh',
		...test_repository_guard.prelude_lines(git_binary, guarded_directory),
		'skip=0',
		'guard_seen=0',
		...git_scan_lines({ guarded_directory, log_file }),
		`exec ${shim_shell.quoted(git_binary)} "$@"`,
		'',
	].join('\n')
}

// The real binary, found by walking `PATH` the way the shell would, and written into the shim as an
// absolute path. That is what lets `PATH` keep the guard directory in front: a subprocess spawned by
// a test inherits the shim rather than escaping to the real `git` behind it.
//
// **An armed guard directory is skipped, and that is not belt-and-braces.** `arm` puts one at the
// front of `PATH` and every test worker inherits it, so this module loaded inside a worker would find
// `<guard>/git` — and a shim built from that answer `exec`s a shim, which at the default directory is
// itself: an unbounded loop, and a `GIT_BINARY` assertion that proves only that the shim exists.
function is_guard_directory(directory: string): boolean {
	return path.basename(directory).startsWith(GUARD_PREFIX)
}

function is_executable(candidate: string): boolean {
	try {
		accessSync(candidate, constants.X_OK)

		return true
	} catch {
		return false
	}
}

function holds_binary(directory: string, name: string): boolean {
	return !is_guard_directory(directory) && is_executable(path.join(directory, name))
}

function resolve_binary(
	name: string,
	search_path: string = process.env['PATH'] ?? '',
): string | undefined {
	const directory = search_path.split(path.delimiter).find((entry) => holds_binary(entry, name))

	return directory === undefined ? undefined : path.join(directory, name)
}

const GIT_BINARY = resolve_binary(GIT_SHIM_NAME)

// The repository a write is refused against, resolved once here rather than in the shim: the answer
// is the same for every call of the run, and asking git for it costs a process. `undefined` where
// `PROJECT_ROOT` is not a repository at all — see `test-repository-guard.ts` on why that leaves the
// inherited-environment finding armed and only the resolution one out.
const GUARDED_GIT_DIRECTORY = test_repository_guard.guarded_git_directory(GIT_BINARY, PROJECT_ROOT)

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
function counted_lines(calls: ReadonlyArray<string>): Array<string> {
	const counts = new Map<string, number>()

	for (const call of calls) counts.set(call, (counts.get(call) ?? 0) + 1)

	return [...counts].map(([call, count]) => `  ${String(count)}x  ${call}`)
}

// A heading and its calls, or nothing at all when there are none.
function section(heading: string, calls: ReadonlyArray<string>): Array<string> {
	return calls.length === 0 ? [] : [heading, ...counted_lines(calls)]
}

// One section per kind. The two guards share one record, so a run that both reached the network and
// wrote into its own repository has to report each under its own heading — filing one under the
// other's would tell the reader to mock a read that was never made (joshuafolkken/kit#1530).
function describe_violations(calls: ReadonlyArray<string>): string {
	const writes = calls.filter((call) => test_repository_guard.is_write_violation(call))
	const network = calls.filter((call) => !test_repository_guard.is_write_violation(call))

	return [
		...section(VIOLATION_HEADING, network),
		...section(test_repository_guard.WRITE_VIOLATION_HEADING, writes),
	].join('\n')
}

// One armed guard is one directory holding both the shim and its record, so the directory is the
// only thing any of the calls below take. Derived rather than passed alongside it: a `disarm` given
// a log file that lived somewhere else would recursively delete whatever directory that was in.
function log_in(directory: string): string {
	return path.join(directory, LOG_NAME)
}

function write_executable(shim_file: string, script: string): void {
	writeFileSync(shim_file, script)
	chmodSync(shim_file, SHIM_MODE)
}

// **Skipped rather than faked when the real `git` cannot be found.** A shim with nothing to `exec`
// would fail every local `git` in the suite, which is a far worse answer than leaving this one binary
// unguarded — and it cannot happen in a checkout, since finding no `git` here means there was no
// `git` to clone with. The branch is a safety net, not a supported mode.
function install_git_shim(directory: string, guarded_directory: string | undefined): void {
	if (GIT_BINARY === undefined) return

	write_executable(
		path.join(directory, GIT_SHIM_NAME),
		git_shim_script(log_in(directory), GIT_BINARY, guarded_directory),
	)
}

// The shims, written where they will be spawned from. Shared with this module's own test rather than
// re-written there: a test that builds its own copy proves that copy works and says nothing about
// the one the suite actually runs behind.
// **`undefined` here means "there is no repository to guard", and a parameter default could not say
// that** — a JavaScript default fires on an explicit `undefined` too, so a caller asking for the
// no-repository shim silently got one guarding the real checkout, and the branch that omits the
// resolver had no test at all (review round 2 of joshuafolkken/kit#1530). The default lives in the
// wrapper below instead, where it is applied rather than defaulted.
function install_shim_guarding(directory: string, guarded_directory: string | undefined): string {
	const shim_file = path.join(directory, SHIM_NAME)

	mkdirSync(directory, { recursive: true })
	writeFileSync(log_in(directory), '')
	write_executable(shim_file, shim_script(log_in(directory)))
	install_git_shim(directory, guarded_directory)

	return shim_file
}

function install_shim(directory: string = GUARD_DIRECTORY): string {
	return install_shim_guarding(directory, GUARDED_GIT_DIRECTORY)
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

// `globalSetup` runs before any worker is forked, so the workers inherit this `PATH` and every `gh`
// and `git` they spawn — directly or through a CLI subprocess of their own — resolves to a shim.
function arm(directory: string = GUARD_DIRECTORY): void {
	install_shim(directory)
	process.env['PATH'] = `${directory}${path.delimiter}${process.env['PATH'] ?? ''}`
}

// Thrown rather than logged: a warning on a suite that already exited 0 is a warning nobody reads,
// which is the state joshuafolkken/kit#1353 was filed from. The directory goes either way, so a
// failing run does not leave the next one reading its records.
function disarm(directory: string = GUARD_DIRECTORY): void {
	const log_text = read_log(log_in(directory))

	try {
		if (log_text === undefined) throw new Error(`${UNREADABLE_LOG_HEADING} ${log_in(directory)}`)

		const calls = calls_of(log_text)

		if (calls.length > 0) throw new Error(describe_violations(calls))
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

// Vitest's `globalSetup` contract: a named `setup` whose return value becomes the teardown.
function setup(): () => void {
	arm()

	return disarm
}

const test_network_guard = {
	BLOCKED_MESSAGE,
	GIT_BINARY,
	GIT_NETWORK_SUBCOMMANDS,
	GIT_SHIM_NAME,
	GIT_VALUE_OPTIONS,
	GUARDED_GIT_DIRECTORY,
	GUARD_DIRECTORY,
	GUARD_PREFIX,
	SHIM_NAME,
	UNREADABLE_LOG_HEADING,
	VIOLATION_HEADING,
	arm,
	calls_of,
	describe_violations,
	disarm,
	git_shim_script,
	install_shim,
	install_shim_guarding,
	log_in,
	resolve_binary,
	shim_script,
}

export { setup, test_network_guard }
