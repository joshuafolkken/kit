import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { describe, expect, it } from 'vitest'
import { run_wake_session } from './run-wake-session'

// joshuafolkken/kit#1719. What the supervisor spawns is the one place it could widen what may be run,
// so the argument vector is pinned rather than left to reading.

const INVOCATION = 'backlogrun --max 5 --idle 30'
const CLAUDE = 'claude'
const SCRIPT = '/somewhere/run-wake-cli.ts'
const BLANK = ' '.repeat(3)
const OTHER_COMMAND = 'my-agent run'

describe('run_wake_session.to_argv — what the woken session is asked to do', () => {
	it('appends the recorded invocation as one argument, never split on its spaces', () => {
		const argv = run_wake_session.to_argv('claude -p', INVOCATION)

		expect(argv).toStrictEqual({ command: CLAUDE, args: ['-p', INVOCATION] })
	})

	// The person typed the invocation; nothing between the record and the session may add to it.
	it('adds nothing of its own to the arguments', () => {
		const argv = run_wake_session.to_argv(run_wake_session.DEFAULT_WAKE_COMMAND, INVOCATION)

		expect(argv?.args.at(-1)).toBe(INVOCATION)
		expect(argv?.args).toHaveLength(2)
	})

	// `auto-ok` decides what may be run unattended and is a person's to apply. A waker that could
	// write it would be widening its own authorization, so nothing it spawns may mention it.
	it('never names auto-ok anywhere in what it launches', () => {
		const argv = run_wake_session.to_argv(run_wake_session.DEFAULT_WAKE_COMMAND, INVOCATION)

		expect(JSON.stringify(argv)).not.toContain('auto-ok')
	})

	// `eval-session.ts` passes it because that suite runs in a throwaway checkout whose credentials
	// were taken away. This one runs in the person's own repository, so the default must not.
	it('does not disarm permission checks by default', () => {
		expect(run_wake_session.DEFAULT_WAKE_COMMAND).not.toContain('dangerously-skip-permissions')
	})

	it('takes extra leading arguments from the configured command', () => {
		const argv = run_wake_session.to_argv('claude -p --model opus', INVOCATION)

		expect(argv).toStrictEqual({
			command: CLAUDE,
			args: ['-p', '--model', 'opus', INVOCATION],
		})
	})

	it('refuses a configured command that names nothing', () => {
		expect(run_wake_session.to_argv(BLANK, INVOCATION)).toBeUndefined()
	})
})

describe('run_wake_session.configured_command — the default and its override', () => {
	it('uses the conservative default when nothing is configured', () => {
		expect(run_wake_session.configured_command({})).toBe(run_wake_session.DEFAULT_WAKE_COMMAND)
	})

	it('uses the default when the variable is set to blank', () => {
		const environment = { [run_wake_session.WAKE_COMMAND_KEY]: '  ' }

		expect(run_wake_session.configured_command(environment)).toBe(
			run_wake_session.DEFAULT_WAKE_COMMAND,
		)
	})

	it('takes the configured command when one is set', () => {
		const environment = { [run_wake_session.WAKE_COMMAND_KEY]: OTHER_COMMAND }

		expect(run_wake_session.configured_command(environment)).toBe(OTHER_COMMAND)
	})
})

describe('run_wake_session.supervisor_argv — the detached self', () => {
	// Without the runner's own loader flags the detached process starts and fails on the syntax of the
	// TypeScript entry point, which would look exactly like a supervisor that never ran.
	it('carries the runner’s loader flags across to the detached process', () => {
		const argv = run_wake_session.supervisor_argv(SCRIPT)

		expect(argv.command).toBe(process.execPath)
		expect(argv.args.slice(0, process.execArgv.length)).toStrictEqual(process.execArgv)
	})

	it('runs the loop body and names the script it was given', () => {
		const argv = run_wake_session.supervisor_argv(SCRIPT)

		expect(argv.args.at(-1)).toBe(run_wake_session.LOOP_FLAG)
		expect(argv.args.at(-2)).toBe(SCRIPT)
	})

	// `--start --interval 15` accepts the flag, so a supervisor that then polled at the default would
	// be silently ignoring what it was told.
	it('forwards a chosen interval to the detached supervisor', () => {
		const argv = run_wake_session.supervisor_argv(SCRIPT, '15')

		expect(argv.args.slice(-2)).toStrictEqual([run_wake_session.INTERVAL_FLAG, '15'])
	})
})

describe('the parent-session environment is single-sourced', () => {
	// Two copies of this list is the clone that fails silently: the child dials the parent's private
	// socket and the session dies with nothing naming the cause (joshuafolkken/kit#1158).
	it('removes each parent-session variable rather than blanking it', () => {
		const removed = agent_session_environment.removed_environment()

		expect(Object.keys(removed)).toStrictEqual([...agent_session_environment.PARENT_SESSION_KEYS])
		expect(JSON.stringify(removed)).toBe('{}')
	})

	it('names the messaging socket and token, which are the two that kill a child session', () => {
		expect(agent_session_environment.PARENT_SESSION_KEYS).toContain('CLAUDE_CODE_MESSAGING_SOCKET')
		expect(agent_session_environment.PARENT_SESSION_KEYS).toContain('CLAUDE_CODE_MESSAGING_TOKEN')
	})
})
