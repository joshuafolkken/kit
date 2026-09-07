import { execa } from 'execa'
import type { Scenario } from './eval-scenario'

// One headless Claude session per scenario. `--verbose` is not optional decoration: `-p` refuses
// `--output-format stream-json` without it, and the stream is the only place the tool calls appear.
const CLAUDE_BIN = 'claude'

// `--dangerously-skip-permissions` is what makes the run unattended, and a scenario measuring whether
// the agent reaches for a forbidden tool has to let it try. That makes the blast radius the thing to
// bound, and the throwaway cwd bounds only the filesystem — a session inheriting this shell's
// credentials could file a real GitHub Issue, and `upstream-interrupt` puts the agent in front of the
// one rule that says to file one without asking. So the credentials are taken away instead: `gh` is
// pointed at an empty config directory and the token variables are cleared, which leaves the *call*
// observable — it is still recorded in the transcript — while the write itself cannot land.
const SCRUBBED_ENV: Readonly<Record<string, string>> = {
	GH_TOKEN: '',
	GITHUB_TOKEN: '',
	GH_ENTERPRISE_TOKEN: '',
	GITHUB_ENTERPRISE_TOKEN: '',
}

// Cleared to empty is not the same as absent, and these four need to be *absent*. execa runs with
// `extendEnv: true` by default, so the child inherits this process's whole environment and every one
// of these names the *parent* Claude session: `CLAUDE_CODE_MESSAGING_SOCKET` is a UNIX socket only
// the parent listens on, `CLAUDE_CODE_MESSAGING_TOKEN` is that socket's credential, and the two
// session identifiers claim the parent's session as the child's own. Inherited, the child dials the
// parent's private socket, is refused, and the session dies as `API Error: Unable to connect to API
// (ConnectionRefused)` — which the harness could only report as `unmeasured`. Measured under
// joshuafolkken/kit#1158: removing them restored 5/5 held in 54 seconds, and lowering
// `JOSH_EVAL_CONCURRENCY` — the suspected cause before this one was found — made it worse.
//
// `undefined` rather than `''` because an empty socket path is still a socket path to whatever reads
// it; Node's spawn omits an environment key whose value is `undefined`, which is the only way to hand
// the child an environment that does not have the variable at all.
const PARENT_SESSION_KEYS: ReadonlyArray<string> = [
	'CLAUDE_CODE_MESSAGING_SOCKET',
	'CLAUDE_CODE_MESSAGING_TOKEN',
	'CLAUDE_CODE_SESSION_ID',
	'CLAUDE_CODE_CHILD_SESSION',
]

const GH_CONFIG_KEY = 'GH_CONFIG_DIR'
const SPAWN_FAILURE_EXIT_CODE = -1
// A stalled session holds its pool slot with no output and never reaches the retry that exists for
// exactly that case. Generous enough for a ten-turn scenario, short enough to end a hang.
const SESSION_TIMEOUT_MS = 600_000

// execa sets `timedOut` when its own `timeout` killed the process. Read from the result rather than
// inferred from exit 143, which any SIGTERM produces.
function is_timeout_result(result: { timedOut?: boolean | undefined }): boolean {
	return result.timedOut === true
}

// execa names the signal that terminated a process; anything else — including an empty string — is
// not a kill. One definition, because `spawn_failure_note` asks the same question and a second
// spelling of it let `signal: ''` count as a kill there and as no signal here, which dropped the
// signal name and the message together (joshuafolkken/kit#1005).
function read_signal(result: { signal?: string | undefined }): string | undefined {
	return typeof result.signal === 'string' && result.signal !== '' ? result.signal : undefined
}

// execa says nothing on stderr when the binary itself could not be started, so the reason is taken
// from the error it reports instead — otherwise the report names a failure with no cause.
//
// **Only for that case.** A process killed by a signal also has no exit code, and execa's message for
// one is `<prefix>: <the whole escaped command>` — for this suite, the entire scenario prompt printed
// where a diagnosis belongs. A kill is recognized by its signal and named from that instead, so this
// message is used only when nothing ever started (joshuafolkken/kit#1001).
function spawn_failure_note(result: {
	exitCode?: number | undefined
	message?: string | undefined
	timedOut?: boolean | undefined
	signal?: string | undefined
}): string {
	if (is_timeout_result(result) || result.exitCode !== undefined) return ''
	if (read_signal(result) !== undefined) return ''

	return result.message ?? `could not start ${CLAUDE_BIN}`
}

interface SessionResult {
	transcript: string
	exit_code: number
	stderr: string
	// Whether the timeout above is what ended it. Carried out because the exit code cannot say: execa
	// reports no exit code at all for a signal-terminated process, so a timeout is otherwise
	// indistinguishable from a failed spawn (joshuafolkken/kit#1001).
	is_timed_out: boolean
	// The signal that killed it, when one did. A session ended by the OOM killer or by a harness
	// watchdog is neither a timeout nor a spawn failure, and saying which signal arrived is the only
	// thing that separates it from both.
	signal: string | undefined
}

function session_arguments(scenario: Scenario, model: string): ReadonlyArray<string> {
	return [
		'-p',
		scenario.prompt,
		'--output-format',
		'stream-json',
		'--verbose',
		'--max-turns',
		String(scenario.max_turns),
		'--model',
		model,
		'--dangerously-skip-permissions',
	]
}

function removed_environment(): Record<string, undefined> {
	return Object.fromEntries(PARENT_SESSION_KEYS.map((key) => [key, undefined]))
}

function session_environment(sandbox_path: string): Record<string, string | undefined> {
	return {
		...removed_environment(),
		...SCRUBBED_ENV,
		[GH_CONFIG_KEY]: `${sandbox_path}/.gh-config`,
	}
}

// The exit code and stderr are carried out rather than dropped. A session that never ran — a missing
// CLI, an expired login, an overloaded API — produces an empty transcript, which looks exactly like
// an agent that declined to act; without these two fields the runner reports that as a rule failing.
async function run_session(
	scenario: Scenario,
	sandbox_path: string,
	model: string,
): Promise<SessionResult> {
	const result = await execa(CLAUDE_BIN, session_arguments(scenario, model), {
		cwd: sandbox_path,
		reject: false,
		env: session_environment(sandbox_path),
		// Closed rather than left as a pipe. The CLI reads stdin for piped input and, on an open pipe
		// nothing ever writes to, waits three seconds before starting — long enough to change what the
		// session does, and the harness never has anything to send it.
		stdin: 'ignore',
		// The transcript is one JSON object per line and a long scenario produces many; the default
		// buffer limit truncates mid-line, which reads as a scenario that stopped calling tools.
		maxBuffer: Infinity,
		timeout: SESSION_TIMEOUT_MS,
	})

	return {
		transcript: result.stdout,
		// An absent exit code is a process that never ran — a missing `claude` on PATH is the one that
		// matters — so it reads as a failure. Defaulting it to zero made that look like a healthy
		// session that simply called nothing, which is a verdict about the rule rather than the setup.
		exit_code: result.exitCode ?? SPAWN_FAILURE_EXIT_CODE,
		stderr: result.stderr === '' ? spawn_failure_note(result) : result.stderr,
		is_timed_out: is_timeout_result(result),
		signal: read_signal(result),
	}
}

const eval_session = {
	PARENT_SESSION_KEYS,
	run_session,
	session_arguments,
	session_environment,
	spawn_failure_note,
}

export { eval_session }
export type { SessionResult }
