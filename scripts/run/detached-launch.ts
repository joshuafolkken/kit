import { spawn, type SpawnOptions } from 'node:child_process'
import { closeSync, constants, openSync, writeSync } from 'node:fs'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { stamp_file } from '#scripts/josh/stamp-file'

// Starting a process that outlives this one, and keeping what it writes.
//
// **It was `run-wake-session.ts`'s until a second caller needed it** (joshuafolkken/kit#1749). The
// supervisor was the only thing launching a detached session, so the launcher and the
// `backlogrun`-specific invocation parsing sat in one file; a delegated child launched into a lane
// needs exactly the launcher and none of the parsing. Copying it across would be the clone
// `CLAUDE.md` prohibits — and this is the shape of clone that fails silently, because the copy that
// drifts is the one that forgets to strip the parent session's environment and dies at its first API
// request with nothing naming the cause (joshuafolkken/kit#1760).
//
// **What is shared is the mechanism, never the argument vector.** Each caller composes its own
// `LaunchArgv` out of its own constants and validated values — `run-wake-session.ts` rebuilds a
// `backlogrun` invocation, `lane-dispatch.ts` composes a `fullrun #<N>` out of a digits-only issue
// number — and this module refuses one that carries anything a command line has no business holding.

const NO_PID_NOTE = 'the process started without a pid'
const UNSAFE_NOTE =
	'the wake command or its arguments contain characters that are not safe to execute'

// **The agent CLI is a constant, not configuration, and it is one constant rather than two**
// (joshuafolkken/kit#1749). `run:wake` fixed the binary here for a reason that holds identically for a
// dispatched child — this runs unattended, in the person's own checkout with the person's own
// credentials, so which binary runs must not be reachable from an environment variable. A second
// launcher declaring its own copy would be free to drift from the one that was reviewed.
//
// **Neither vector carries `--dangerously-skip-permissions`.** What a headless session may do is the
// checkout's own `.claude/settings.json` to decide; a launcher that disarmed every permission check
// would take that decision away from the person, silently, on a machine nobody is watching.
const AGENT_COMMAND = 'claude'
// `-p` is a headless session: the invocation is the prompt, and nothing waits on a terminal.
const AGENT_FLAGS: ReadonlyArray<string> = ['-p']

// **The inputs that reach `spawn` are validated rather than trusted, and that is a control rather than
// a formality.** Two things already bound this — the argument vector never goes through a shell, so
// there is no shell to inject into, and the invocation travels as exactly one argv element rather than
// being interpolated into a command string — but neither is visible at the call site, and "it cannot be
// exploited the way this is written today" is an argument, not a check. A later edit that added
// `shell: true` would silently turn both into nothing.
//
// A NUL byte is what `execve` treats as the end of a string, so a value carrying one executes as a
// prefix of itself; the other control characters have no business in a command line and their presence
// means the value did not come from where it was supposed to.
//
// Scanned by code point rather than matched by a regular expression: a character class over this
// range has to carry the control characters themselves, which puts unreadable bytes in a source file
// for no gain.
const FIRST_PRINTABLE_CODE = 0x20
const DELETE_CODE = 0x7f
const FIRST_CODE_POINT = 0
const MAX_ARGUMENT_LENGTH = 4096
const EMPTY_LENGTH = 0

interface LaunchArgv {
	command: string
	args: ReadonlyArray<string>
}

type LaunchResult = { kind: 'launched'; pid: number } | { kind: 'failed'; note: string }

interface LaunchRequest {
	argv: LaunchArgv
	cwd: string
	// Where to keep what the child writes. **Absent means the output is discarded**, which is what every
	// launch did before joshuafolkken/kit#1746 and what a caller with nowhere to write still gets — the
	// log is an improvement on the diagnosis, never a precondition for starting a session.
	log_path?: string | undefined
	// Extra variables to set on the child, spread **after** the parent-session strip below, so a caller
	// can hand the child a fact the inherited environment does not carry — a dispatched lane child's mark
	// among them (joshuafolkken/kit#1904). Setting it here rather than mutating `process.env` keeps the
	// launcher's own environment untouched, and spreading it last means an explicit value wins over an
	// inherited one of the same name.
	env?: Readonly<Record<string, string | undefined>>
}

function is_control_character(character: string): boolean {
	const code = character.codePointAt(FIRST_CODE_POINT) ?? FIRST_PRINTABLE_CODE

	return code < FIRST_PRINTABLE_CODE || code === DELETE_CODE
}

// Iterated rather than spread into an array: spreading a string is flagged for decomposing rich
// characters, and nothing here needs a copy of it.
function has_control_character(value: string): boolean {
	for (const character of value) {
		if (is_control_character(character)) return true
	}

	return false
}

function is_safe_length(value: string): boolean {
	return value.length > EMPTY_LENGTH && value.length <= MAX_ARGUMENT_LENGTH
}

function is_safe_value(value: string): boolean {
	return is_safe_length(value) && !has_control_character(value)
}

// The single gate every argument vector passes before it reaches the operating system, whoever
// composed it.
function is_safe_argv(argv: LaunchArgv): boolean {
	return is_safe_value(argv.command) && argv.args.every((value) => is_safe_value(value))
}

// **The invocation goes on the command line last and as one argument**, never interpolated into a
// command string: it is the prompt the headless session is given, not a list of arguments to the agent
// CLI. Each caller is responsible for composing that one string out of its own constants and validated
// values — this function only places it.
function agent_argv(invocation: string): LaunchArgv {
	return { command: AGENT_COMMAND, args: [...AGENT_FLAGS, invocation] }
}

function note_of(error: unknown): string {
	return error instanceof Error ? error.message : JSON.stringify(error)
}

function launched(pid: number): LaunchResult {
	return { kind: 'launched', pid }
}

// **Appended to without following a symlink, and refused unless the file is this account's own.** The
// path is deterministic — the temp directory plus a digest of the repository — so on a shared `/tmp`
// anyone who knows the checkout can work it out and pre-create it. `O_NOFOLLOW` is what stops the
// append landing wherever a symlink pointed, and the ownership test is the second half, against a
// plain file another account left at the same path. It is `stamp_file`'s own test rather than a second
// copy of one, and together the two give this file the defense `write_exclusively` already gives the
// wake and carry records beside it.
//
// `LOG_MODE` applies on creation alone, which is why the ownership test is not redundant: a file this
// account already owns is trusted whatever mode it carries, and one it does not is refused outright.
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const LOG_FLAGS = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW
const LOG_MODE = 0o600

// One line in front of each launch, so the sessions started into one file can be told apart. The
// child's own pid is not known until `spawn` returns, and a header written afterwards would race the
// child's first output; the time and the launching process separate the runs.
function log_header(argv: LaunchArgv): string {
	const stamp = new Date().toISOString()

	return `\n=== ${stamp} · started by process ${String(process.pid)} · ${argv.command} ===\n`
}

function opened_log(log_path: string, on_error: (note: string) => void): number | undefined {
	const descriptor = openSync(log_path, LOG_FLAGS, LOG_MODE)

	if (!stamp_file.is_own_regular_file(log_path)) {
		closeSync(descriptor)
		// Worded for both callers: `ensure_log` reaches this from `--list` and `--stop`, where nothing
		// has been launched and "the session output is discarded" would describe an event that did not
		// happen. What holds on every path is that nothing is kept there.
		on_error(`${log_path} is not this account's own file, so nothing is kept there`)

		return undefined
	}

	return descriptor
}

// **The header is written by the launch and by nothing else.** Opening the file and announcing a
// launch into it were one function until joshuafolkken/kit#1759, which is what made the file's
// existence a side effect of launching: there was no way to obtain the descriptor without also
// claiming a session had started. Split, `ensure_log` below can create the file the moment its path
// is named, and a log nothing has launched into stays empty rather than carrying a header for a
// session that never ran.
//
// **It swallows its own failure, because a log failure is never a failed launch.** In `opened_log`
// this write sat inside `open_log`'s `try`, so a full disk lost the header and started the session
// anyway; reached from `launch`'s `try` it would answer `failed` instead and leave a cut
// `backlogrun` asleep — the one outcome `open_log`'s comment below rules out.
function stamped(
	descriptor: number | undefined,
	argv: LaunchArgv,
	on_error: (note: string) => void,
): void {
	if (descriptor === undefined) return

	try {
		writeSync(descriptor, log_header(argv))
	} catch (error) {
		on_error(`the session log could not be written: ${note_of(error)}`)
	}
}

// **Opening the log is allowed to fail, and a failure is not a failed launch.** A temp directory that
// cannot be written to is a reason to lose the diagnosis, never a reason to leave the run asleep — so
// this answers `undefined` and the spawn goes ahead discarding output, exactly as it did before
// joshuafolkken/kit#1746.
//
// **It says so rather than failing quietly, though.** `--list` and every warning name this path
// unconditionally, so a silent failure would send a person at three in the morning to a file holding
// nothing of this run — the silent diagnosis joshuafolkken/kit#1746 was filed about, arrived at from
// the other side.
function open_log(
	log_path: string | undefined,
	on_error: (note: string) => void,
): number | undefined {
	if (log_path === undefined) return undefined

	try {
		return opened_log(log_path, on_error)
	} catch (error) {
		on_error(`the session log at ${log_path} could not be opened: ${note_of(error)}`)

		return undefined
	}
}

// **The file exists because its path was resolved, not because something launched into it**
// (joshuafolkken/kit#1759). `--list`, the already-running branch of `--start` and every warning name
// this path unconditionally, and until this existed none of the three created anything: the file was
// written only by the process that launched, at the moment it launched. So a supervisor started
// before the log existed — detached, and alive for the hours a `backlogrun` takes — left the path
// named for the whole run with nothing ever at it, and the one report a failure could make went to
// that same absent file. Creating it where it is named is what makes the name a promise the reader
// can check: an empty log says "this supervisor started nothing", which is an answer, where a
// missing one said nothing at all.
//
// **No header is written here**, because nothing has been launched — see `stamped` above.
function ensure_log(log_path: string, on_error: (note: string) => void): void {
	const descriptor = open_log(log_path, on_error)

	if (descriptor !== undefined) closeSync(descriptor)
}

// **`detached` is what puts the child outside the conversation, and discarding its output was never
// part of that** (joshuafolkken/kit#1746). A process left attached is a child of the agent session,
// and the session cut is exactly the moment this has to survive — so a supervisor that the harness
// backgrounds, the way `run:progress` is backgrounded, would die at the one event it exists to handle.
// That argument is about the parent link alone. `stdio: 'ignore'` rode along with it and threw away
// the one record that could say why a woken session exited without claiming the carry record, which is
// the whole of what joshuafolkken/kit#1746 could not diagnose. Pointed at a file, the child is just as
// detached and the output survives it.
//
// **The parent session's environment is removed here, and that is why it is here rather than at each
// call site** (joshuafolkken/kit#1760). A detached child outlives the invocation that spawned it, so a
// loopback proxy exported into that invocation is a dead address by the time the child dials it —
// `ConnectionRefused` at the first API request, with nothing anywhere naming the cause. A second
// launcher that composed its own `SpawnOptions` would be one edit away from that failure.
//
// The `error` listener is not decoration: an unhandled `error` on a child process throws in this
// process, and an agent CLI that is not on `PATH` raises one asynchronously, after `spawn` has
// already returned. It reports rather than decides — the grace window in `run-wake.ts` is what turns a failed
// launch into a verdict, so that one detector covers a missing binary, a session that dies during boot
// and a session that runs without ever picking the run up.
// Lifted out of the call so the `spawn` fits on one line, which is where the suppression below has to
// sit: SonarQube's marker applies to the line the issue is raised on and to nothing else.
function spawn_options(
	cwd: string,
	log: number | undefined,
	environment: Readonly<Record<string, string | undefined>> = {},
): SpawnOptions {
	return {
		cwd,
		detached: true,
		stdio: log === undefined ? 'ignore' : ['ignore', log, log],
		env: { ...process.env, ...agent_session_environment.removed_environment(), ...environment },
	}
}

// **`tssecurity:S8705` is suppressed on the `spawn` line, and this is the reason it is allowed to be.**
// The rule's premise is a shell escape — it fires where untrusted text can become shell syntax. There
// is no shell on this path to escape from: `spawn` is handed a command and an argument **array**,
// `shell` is left at its default of false, so nothing here is ever parsed by `sh`. And every element of
// that array is a constant or an integer the caller composed, because each caller takes the text it was
// handed apart and rebuilds it rather than passing it on.
//
// **It is what was left after the flow was actually broken, not something used instead of breaking
// it.** Three earlier rounds tried to satisfy the rule by inspecting the string harder and moved it not
// at all; the rebuild is what severed the flow, and the same change retired the pattern CodeQL had
// found an exponential backtrack in — **`js/redos` is gone from this file rather than suppressed, and
// this marker covers nothing of it.** What the rule still sees is the shape of a `spawn` reached from a
// file that was read, and that shape is the design: starting a process from a record is the whole of
// what a supervisor does.
//
// Scoped to that one line on the user's explicit instruction of 2026-09-10 (joshuafolkken/kit#1719).
// No project-wide exclusion and no change to the Sonar configuration.
function spawned(
	request: LaunchRequest,
	log: number | undefined,
	on_error: (note: string) => void,
): LaunchResult {
	const { command, args } = request.argv
	const child = spawn(command, [...args], spawn_options(request.cwd, log, request.env)) // NOSONAR — see above

	child.on('error', (error) => {
		on_error(note_of(error))
	})
	child.unref()

	return child.pid === undefined ? { kind: 'failed', note: NO_PID_NOTE } : launched(child.pid)
}

// **The descriptor is closed as soon as the spawn returns, and that loses nothing.** `spawn` forks and
// execs before it returns, so the child already holds its own duplicate of the descriptor by then;
// what is closed here is this process's copy. Left open it would outlive the launch in a supervisor
// that runs for hours and launches once per cut.
function launch(request: LaunchRequest, on_error: (note: string) => void): LaunchResult {
	if (!is_safe_argv(request.argv)) return { kind: 'failed', note: UNSAFE_NOTE }

	const log = open_log(request.log_path, on_error)

	try {
		stamped(log, request.argv, on_error)

		return spawned(request, log, on_error)
	} catch (error) {
		return { kind: 'failed', note: note_of(error) }
	} finally {
		if (log !== undefined) closeSync(log)
	}
}

const detached_launch = {
	AGENT_COMMAND,
	AGENT_FLAGS,
	MAX_ARGUMENT_LENGTH,
	UNSAFE_NOTE,
	agent_argv,
	ensure_log,
	is_safe_argv,
	is_safe_value,
	launch,
	note_of,
}

export type { LaunchArgv, LaunchRequest, LaunchResult }
export { detached_launch }
