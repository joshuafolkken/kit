import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { describe, expect, it } from 'vitest'
import { run_wake_session } from './run-wake-session'

// joshuafolkken/kit#1719. What the supervisor spawns is the one place it could widen what may be run,
// so the argument vector is pinned rather than left to reading.

const INVOCATION = 'backlogrun --max 5 --idle 30'
const SCRIPT = '/somewhere/run-wake-cli.ts'
const SKIP_PERMISSIONS = 'dangerously-skip-permissions'

describe('run_wake_session.wake_argv — what the woken session is asked to do', () => {
	it('runs the agent CLI headless with the recorded invocation as its prompt', () => {
		expect(run_wake_session.wake_argv(INVOCATION)).toStrictEqual({
			command: run_wake_session.WAKE_COMMAND,
			args: ['-p', INVOCATION],
		})
	})

	// The person typed the invocation; nothing between the record and the session may add to it.
	it('appends the invocation as one argument, never split on its spaces', () => {
		const argv = run_wake_session.wake_argv(INVOCATION)

		expect(argv?.args.at(-1)).toBe(INVOCATION)
		expect(argv?.args).toHaveLength(2)
	})

	// `auto-ok` decides what may be run unattended and is a person's to apply. A waker that could
	// write it would be widening its own authorization, so nothing it spawns may mention it.
	it('never names auto-ok anywhere in what it launches', () => {
		expect(JSON.stringify(run_wake_session.wake_argv(INVOCATION))).not.toContain('auto-ok')
	})

	// `eval-session.ts` passes it because that suite runs in a throwaway checkout whose credentials
	// were taken away. This one runs in the person's own repository, so it must not.
	it('does not disarm permission checks', () => {
		const argv = JSON.stringify(run_wake_session.wake_argv(INVOCATION))

		expect(argv).not.toContain(SKIP_PERMISSIONS)
	})

	// The binary was an environment variable first, which put the choice of what runs unattended with
	// the person's credentials in reach of anything that can set an environment. `eval-session.ts`
	// hard-codes the same binary for the same reason.
	it('takes the agent CLI from a constant rather than from the environment', () => {
		expect(run_wake_session.WAKE_COMMAND).toBe('claude')
		expect(JSON.stringify(run_wake_session)).not.toContain('JOSH_WAKE_COMMAND')
	})
})

// Nothing here is exploitable as the code stands — `spawn` is given an argument vector and never a
// shell — but "it cannot be exploited the way this is written today" is an argument rather than a
// check, and an edit that added `shell: true` would silently turn it into nothing.
describe('run_wake_session — what may reach the operating system', () => {
	// `execve` treats a NUL as the end of a string, so a value carrying one runs as a prefix of
	// itself — the argument that runs is not the argument that was checked.
	it('refuses an invocation carrying a NUL byte', () => {
		expect(run_wake_session.wake_argv(`${INVOCATION}\u{0}--rm`)).toBeUndefined()
	})

	it('refuses an invocation carrying any other control character', () => {
		expect(run_wake_session.wake_argv(`${INVOCATION}\nrm -rf /`)).toBeUndefined()
	})

	it('refuses an empty invocation', () => {
		expect(run_wake_session.wake_argv('')).toBeUndefined()
	})

	it('accepts an ordinary invocation, spaces and dashes and all', () => {
		expect(run_wake_session.wake_argv(INVOCATION)).toBeDefined()
	})

	// The gate sits at the call itself, so it holds for what this module builds as well.
	it('accepts the supervisor’s own argument vector', () => {
		expect(run_wake_session.is_safe_argv(run_wake_session.supervisor_argv(SCRIPT, '15'))).toBe(true)
	})

	it('refuses to launch an argument vector that does not pass', () => {
		const result = run_wake_session.launch(
			{ argv: { command: 'claude\u{0}', args: [] }, cwd: '.' },
			() => undefined,
		)

		expect(result.kind).toBe('failed')
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
