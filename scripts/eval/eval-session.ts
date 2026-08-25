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

const GH_CONFIG_KEY = 'GH_CONFIG_DIR'
const SPAWN_FAILURE_EXIT_CODE = -1
// A stalled session blocks the whole sequential suite with no output and never reaches the retry that
// exists for exactly that case. Generous enough for a ten-turn scenario, short enough to end a hang.
const SESSION_TIMEOUT_MS = 600_000

// execa says nothing on stderr when the binary itself could not be started, so the reason is taken
// from the error it reports instead — otherwise the report names a failure with no cause.
function spawn_failure_note(result: {
	exitCode?: number | undefined
	message?: string | undefined
}): string {
	return result.exitCode === undefined ? (result.message ?? `could not start ${CLAUDE_BIN}`) : ''
}

interface SessionResult {
	transcript: string
	exit_code: number
	stderr: string
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

function session_environment(sandbox_path: string): Record<string, string> {
	return { ...SCRUBBED_ENV, [GH_CONFIG_KEY]: `${sandbox_path}/.gh-config` }
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
	}
}

const eval_session = { run_session, session_arguments, session_environment }

export { eval_session }
export type { SessionResult }
