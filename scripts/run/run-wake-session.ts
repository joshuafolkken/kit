import { spawn } from 'node:child_process'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'

// How the supervisor starts things: the next agent session, and — at `--start` — its own detached
// self. Both go through one `launch`, because the two differ only in what is being run
// (joshuafolkken/kit#1719).
//
// **The wake command is configurable, and its default is deliberately conservative.**
// `JOSH_WAKE_COMMAND` names the agent CLI and whatever leading arguments it needs; the invocation the
// person typed is appended as the final argument. The default is `claude -p` — a headless session and
// nothing beyond it.
//
// **The default does not carry `--dangerously-skip-permissions`, which `eval-session.ts` does pass.**
// That suite runs in a throwaway checkout with its credentials taken away, and its whole purpose is to
// let an agent try a forbidden tool; this one wakes a session in the person's own repository with the
// person's own credentials. A supervisor that disarmed every permission check by default would be
// taking a decision that is the person's, silently, on a machine nobody is watching — which is the
// case the safe default exists for. Someone who wants it sets it in `JOSH_WAKE_COMMAND`.
//
// **The waker adds nothing to what may be run.** The argument vector is the configured command plus
// the recorded invocation, and nothing here writes a label: `auto-ok` stays a person's to apply, so a
// resumed session is offered exactly the issues the first one was.

const WAKE_COMMAND_KEY = 'JOSH_WAKE_COMMAND'
const DEFAULT_WAKE_COMMAND = 'claude -p'
const LOOP_FLAG = '--loop'
const INTERVAL_FLAG = '--interval'
const WHITESPACE = /\s+/u
const COMMAND_INDEX = 0
const FIRST_ARGUMENT = 1
const NO_PID_NOTE = 'the process started without a pid'

interface WakeArgv {
	command: string
	args: ReadonlyArray<string>
}

type LaunchResult = { kind: 'launched'; pid: number } | { kind: 'failed'; note: string }

interface LaunchRequest {
	argv: WakeArgv
	cwd: string
}

function configured_command(environment: NodeJS.ProcessEnv = process.env): string {
	const configured = environment[WAKE_COMMAND_KEY]

	return configured === undefined || configured.trim() === '' ? DEFAULT_WAKE_COMMAND : configured
}

// The invocation goes last and as one argument, never interpolated into the command string: it is text
// a person typed, and splitting it on whitespace here would turn `backlogrun --max 5` into arguments
// of the CLI rather than the prompt it is.
function to_argv(configured: string, invocation: string): WakeArgv | undefined {
	const words = configured.trim().split(WHITESPACE).filter(Boolean)
	const command = words[COMMAND_INDEX]

	if (command === undefined) return undefined

	return { command, args: [...words.slice(FIRST_ARGUMENT), invocation] }
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

// **`detached` with `stdio: 'ignore'` is what puts the child outside the conversation.** A process
// left attached is a child of the agent session, and the session cut is exactly the moment this has to
// survive — so a supervisor that the harness backgrounds, the way `run:progress` is backgrounded,
// would die at the one event it exists to handle.
//
// The `error` listener is not decoration: an unhandled `error` on a child process throws in this
// process, and a mistyped `JOSH_WAKE_COMMAND` raises one asynchronously, after `spawn` has already
// returned. It reports rather than decides — the grace window in `run-wake.ts` is what turns a failed
// launch into a verdict, so that one detector covers a missing binary, a session that dies during boot
// and a session that runs without ever picking the run up.
function launch(request: LaunchRequest, on_error: (note: string) => void): LaunchResult {
	try {
		const child = spawn(request.argv.command, [...request.argv.args], {
			cwd: request.cwd,
			detached: true,
			stdio: 'ignore',
			env: { ...process.env, ...agent_session_environment.removed_environment() },
		})

		child.on('error', (error) => {
			on_error(note_of(error))
		})
		child.unref()

		return child.pid === undefined ? { kind: 'failed', note: NO_PID_NOTE } : launched(child.pid)
	} catch (error) {
		return { kind: 'failed', note: note_of(error) }
	}
}

const run_wake_session = {
	DEFAULT_WAKE_COMMAND,
	INTERVAL_FLAG,
	LOOP_FLAG,
	WAKE_COMMAND_KEY,
	configured_command,
	launch,
	supervisor_argv,
	to_argv,
}

export type { LaunchRequest, LaunchResult, WakeArgv }
export { run_wake_session }
