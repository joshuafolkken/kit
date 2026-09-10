import { spawn, type SpawnOptions } from 'node:child_process'
import { closeSync, constants, openSync, writeSync } from 'node:fs'
import { backlog_budget_cli } from '#scripts/backlog/backlog-budget-cli'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { stamp_file } from '#scripts/josh/stamp-file'

// How the supervisor starts things: the next agent session, and — at `--start` — its own detached
// self. Both go through one `launch`, because the two differ only in what is being run
// (joshuafolkken/kit#1719).
//
// **The agent CLI is a constant, not configuration, and that is the second decision this file makes.**
// It was an environment variable first (`JOSH_WAKE_COMMAND`), which put the choice of *which binary
// runs* in reach of anything that can set an environment — and this binary runs unattended, overnight,
// in the person's own checkout with the person's own credentials. Shape-checking the name does not
// address that; removing the choice does. `eval-session.ts` already hard-codes the same binary for the
// same reason, so this is the shape this repository already uses rather than a new restriction.
// Supporting a second agent is its own decision, with its own security thinking, and belongs in an
// Issue of its own rather than in a variable nobody reviewed.
//
// **It does not carry `--dangerously-skip-permissions`, which `eval-session.ts` does pass.**
// That suite runs in a throwaway checkout with its credentials taken away, and its whole purpose is to
// let an agent try a forbidden tool; this one wakes a session in the person's own repository with the
// person's own credentials. A supervisor that disarmed every permission check by default would be
// taking a decision that is the person's, silently, on a machine nobody is watching — which is the
// case this default exists for.
//
// **The waker adds nothing to what may be run.** The argument vector is the constant command plus an
// invocation rebuilt to say exactly what the record said, and nothing here writes a label: `auto-ok`
// stays a person's to apply, so a woken session is offered by exactly the rules the first one was. A
// pool that grew across the seam is `backlogrun.md` → "What one invocation approves", not the
// waker's doing (joshuafolkken/kit#1675).

// The agent CLI, resolved through `PATH` exactly as `eval-session.ts` resolves it.
const WAKE_COMMAND = 'claude'
// `-p` is a headless session: the invocation is the prompt, and nothing waits on a terminal.
const WAKE_FLAGS: ReadonlyArray<string> = ['-p']
const LOOP_FLAG = '--loop'
const INTERVAL_FLAG = '--interval'
const NO_PID_NOTE = 'the process started without a pid'
const UNSAFE_NOTE =
	'the wake command or its arguments contain characters that are not safe to execute'

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
// **The invocation is taken apart and rebuilt, rather than inspected and handed on.** This supervisor
// wakes a `backlogrun` and nothing else, so everything that may reach the operating system is
// enumerable: one command word, two flag names, and an integer for each. Reading the record as tokens
// and composing a fresh string out of constants and validated integers means the text the record held
// never reaches `spawn` at all.
//
// **A stricter check is not a break in the flow, and that is why three of them changed nothing.**
// Validating the characters, fixing the binary as a constant and matching against a pattern all left
// the recorded string flowing into the call; taint tracking follows where a value goes, not how hard
// it was looked at on the way. Composing the argument from constants is what actually severs it — and
// it retires the pattern the previous shape needed, whose alternation CodeQL found could backtrack
// exponentially (joshuafolkken/kit#1719).
const INVOCATION_COMMAND = 'backlogrun'
// The flags this supervisor knows how to carry across a session cut. A token is compared against these
// and the **constant that matched** is what goes into the rebuilt invocation, never the token itself:
// the two are equal as text and differ in where they came from, and here the origin is the whole point.
const KNOWN_FLAGS: ReadonlyArray<string> = ['--max', '--idle']
const TOKEN_SEPARATOR = ' '
const FIRST_TOKEN = 0
const FIRST_FLAG_INDEX = 1
const VALUE_OFFSET = 1
const FLAG_PAIR_LENGTH = 2
const MAX_ARGUMENT_LENGTH = 4096
const EMPTY_LENGTH = 0

interface WakeArgv {
	command: string
	args: ReadonlyArray<string>
}

// One flag of a parsed invocation: a name taken from `KNOWN_FLAGS` and a number. Neither field can
// hold text that came out of the record, which is what makes rebuilding from it safe by construction.
interface InvocationPart {
	flag: string
	value: number
}

type InvocationParts = ReadonlyArray<InvocationPart>

type LaunchResult = { kind: 'launched'; pid: number } | { kind: 'failed'; note: string }

interface LaunchRequest {
	argv: WakeArgv
	cwd: string
	// Where to keep what the child writes. **Absent means the output is discarded**, which is what every
	// launch did before joshuafolkken/kit#1746 and what a caller with nowhere to write still gets — the
	// log is an improvement on the diagnosis, never a precondition for starting a session.
	log_path?: string | undefined
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

// The single gate every argument vector passes before it reaches the operating system, whether it came
// from configuration or from this module's own `supervisor_argv`.
function is_safe_argv(argv: WakeArgv): boolean {
	return is_safe_value(argv.command) && argv.args.every((value) => is_safe_value(value))
}

// Returns the constant that the token equals, so that what is carried forward is this file's own text.
function known_flag(token: string): string | undefined {
	return KNOWN_FLAGS.find((flag) => flag === token)
}

// **The integer check is `backlog:budget`'s own, imported rather than restated.** It is the command
// this invocation is going to be handed to, so a second copy of the rule here would be free to drift
// from the one that actually reads the number.
function invocation_part(token: string, raw: string | undefined): InvocationPart | undefined {
	const flag = known_flag(token)
	const value = backlog_budget_cli.to_count(raw)

	if (flag === undefined || value === undefined) return undefined

	return { flag, value }
}

// **An unknown flag is refused, never dropped.** Dropping one would wake a session running to a budget
// the person did not declare the first time `backlogrun` grows a flag this list has not caught up with
// — which is the failure that is hardest to notice, because the session runs and looks fine.
function invocation_parts(tokens: ReadonlyArray<string>): InvocationParts | undefined {
	const parts: Array<InvocationPart> = []

	for (let index = FIRST_FLAG_INDEX; index < tokens.length; index += FLAG_PAIR_LENGTH) {
		const part = invocation_part(tokens[index] ?? '', tokens[index + VALUE_OFFSET])

		if (part === undefined) return undefined

		parts.push(part)
	}

	return parts
}

// A space is the only separator that can survive `is_safe_value`, which has already refused every
// control character — so the split needs no pattern, and the file is left with no regular expression
// for a backtracking analysis to find.
function tokens_of(invocation: string): ReadonlyArray<string> {
	return invocation.split(TOKEN_SEPARATOR).filter((token) => token.length > EMPTY_LENGTH)
}

function rebuilt_invocation(parts: InvocationParts): string {
	const rendered = parts.map((part) => `${part.flag} ${String(part.value)}`)

	return [INVOCATION_COMMAND, ...rendered].join(TOKEN_SEPARATOR)
}

function parsed_invocation(invocation: string): string | undefined {
	const tokens = tokens_of(invocation)

	if (tokens[FIRST_TOKEN] !== INVOCATION_COMMAND) return undefined

	const parts = invocation_parts(tokens)

	return parts === undefined ? undefined : rebuilt_invocation(parts)
}

// **What comes back is always the rebuilt text, and it is refused unless it matches the record.** The
// two requirements are separate. Returning the rebuilt string is what severs the flow from the file;
// requiring it to match is what keeps the wake usable, because the woken session hands its prompt
// straight back to `run:carry --begin`, where `is_handed_off_to` compares it to the record character
// for character. A record the rebuild would rewrite — odd spacing, or a value written `05` — is
// therefore refused here, and the supervisor stops at once with a note, where waking on it would launch
// three sessions that each decline to claim the record and take half an hour to say so.
//
// It goes on the command line last and as one argument, never interpolated into a command string: it is
// the prompt the woken session is given, not a list of arguments to the agent CLI. The split happens
// here, to read the record; the pieces are one argument again before they leave.
function safe_invocation(invocation: string): string | undefined {
	if (!is_safe_value(invocation)) return undefined

	const rebuilt = parsed_invocation(invocation)

	return rebuilt === invocation ? rebuilt : undefined
}

function wake_argv(invocation: string): WakeArgv | undefined {
	const matched = safe_invocation(invocation)

	if (matched === undefined) return undefined

	return { command: WAKE_COMMAND, args: [...WAKE_FLAGS, matched] }
}

// Re-invoking this very script under the same runner, which is what makes the supervisor outlive the
// session that started it. `execArgv` is carried across rather than dropped, because the loader flags
// are what let the runner execute a TypeScript entry point at all — without them the detached process
// starts and immediately fails on the syntax.
//
// **The interval is forwarded rather than dropped.** `--start --interval 15` accepts the flag, so a
// supervisor that then polled at the default would be silently ignoring what it was told.
function supervisor_argv(script_path: string, interval?: string): WakeArgv {
	const chosen = interval === undefined ? [] : [INTERVAL_FLAG, interval]

	return {
		command: process.execPath,
		args: [...process.execArgv, script_path, LOOP_FLAG, ...chosen],
	}
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

// One line in front of each launch, so the three sessions started for a single lost cut can be told
// apart inside a file they all append to. The child's own pid is not known until `spawn` returns, and
// a header written afterwards would race the child's first output; the time and the launching process
// separate the runs, and `--list` names the last pid.
function log_header(argv: WakeArgv): string {
	const stamp = new Date().toISOString()

	return `\n=== ${stamp} · started by process ${String(process.pid)} · ${argv.command} ===\n`
}

function opened_log(
	log_path: string,
	argv: WakeArgv,
	on_error: (note: string) => void,
): number | undefined {
	const descriptor = openSync(log_path, LOG_FLAGS, LOG_MODE)

	if (!stamp_file.is_own_regular_file(log_path)) {
		closeSync(descriptor)
		on_error(`${log_path} is not this account's own file, so the session output is discarded`)

		return undefined
	}

	writeSync(descriptor, log_header(argv))

	return descriptor
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
	argv: WakeArgv,
	on_error: (note: string) => void,
): number | undefined {
	if (log_path === undefined) return undefined

	try {
		return opened_log(log_path, argv, on_error)
	} catch (error) {
		on_error(`the session log at ${log_path} could not be opened: ${note_of(error)}`)

		return undefined
	}
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
// The `error` listener is not decoration: an unhandled `error` on a child process throws in this
// process, and an agent CLI that is not on `PATH` raises one asynchronously, after `spawn` has
// already returned. It reports rather than decides — the grace window in `run-wake.ts` is what turns a failed
// launch into a verdict, so that one detector covers a missing binary, a session that dies during boot
// and a session that runs without ever picking the run up.
// Lifted out of the call so the `spawn` fits on one line, which is where the suppression below has to
// sit: SonarQube's marker applies to the line the issue is raised on and to nothing else.
function spawn_options(cwd: string, log: number | undefined): SpawnOptions {
	return {
		cwd,
		detached: true,
		stdio: log === undefined ? 'ignore' : ['ignore', log, log],
		env: { ...process.env, ...agent_session_environment.removed_environment() },
	}
}

// **`tssecurity:S8705` is suppressed on the `spawn` line, and this is the reason it is allowed to be.**
// The rule's premise is a shell escape — it fires where untrusted text can become shell syntax. There
// is no shell on this path to escape from: `spawn` is handed a command and an argument **array**,
// `shell` is left at its default of false, so nothing here is ever parsed by `sh`. And every element of
// that array is a constant or an integer this module composed, because `safe_invocation` takes the
// recorded invocation apart and rebuilds it rather than passing it on.
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
	const child = spawn(command, [...args], spawn_options(request.cwd, log)) // NOSONAR — see above

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

	const log = open_log(request.log_path, request.argv, on_error)

	try {
		return spawned(request, log, on_error)
	} catch (error) {
		return { kind: 'failed', note: note_of(error) }
	} finally {
		if (log !== undefined) closeSync(log)
	}
}

const run_wake_session = {
	INTERVAL_FLAG,
	LOOP_FLAG,
	WAKE_COMMAND,
	WAKE_FLAGS,
	is_safe_argv,
	launch,
	supervisor_argv,
	wake_argv,
}

export type { LaunchRequest, LaunchResult, WakeArgv }
export { run_wake_session }
