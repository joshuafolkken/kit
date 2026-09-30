import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	git_push_transport,
	KEEPALIVE_SSH_COMMAND,
	PUSH_TIMEOUT_MESSAGE,
	PUSH_TIMEOUT_MS,
	SSH_COMMAND_VARIABLE,
	SSH_LEGACY_VARIABLE,
} from './git-push-transport'

const TIMED_OUT = 'timed-out'
const REJECTED = 'rejected'

// The mock is written the way `git-command.test.ts` writes its own — a hoisted fake rather than
// `vi.mocked(execa)` — because these assertions read the **options** argument, which execa's own
// two-element call signature has no index for.
const execa_mock = vi.hoisted(() => {
	const EXIT_CODE = 1
	const state = {
		// What `git config --get core.sshCommand` answers; empty means the key is unset, which git
		// reports by exiting 1 rather than by printing nothing.
		configured_ssh_command: '',
		// One entry per push attempt, consumed in order; anything past the end succeeds.
		push_outcomes: [] as Array<string>,
		push_calls: [] as Array<{ argument_list: Array<string>; options: unknown }>,
	}

	function to_push_error(outcome: string): Error {
		const is_timed_out = outcome === 'timed-out'

		return Object.assign(new Error(outcome), {
			timedOut: is_timed_out,
			exitCode: is_timed_out ? undefined : EXIT_CODE,
		})
	}

	function read_ssh_config(): { stdout: string } {
		if (state.configured_ssh_command !== '') return { stdout: state.configured_ssh_command }

		throw Object.assign(new Error('key not set'), { exitCode: EXIT_CODE })
	}

	function run_push(argument_list: Array<string>, options: unknown): { stdout: string } {
		state.push_calls.push({ argument_list: [...argument_list], options })
		const outcome = state.push_outcomes.shift() ?? ''

		if (outcome === '') return { stdout: '' }

		throw to_push_error(outcome)
	}

	async function mock_execa(
		_cmd: string,
		argument_list: Array<string>,
		options?: unknown,
	): Promise<{ stdout: string }> {
		return argument_list[0] === 'config' ? read_ssh_config() : run_push(argument_list, options)
	}

	return { EXIT_CODE, state, mock_execa }
})

vi.mock('execa', () => ({ execa: execa_mock.mock_execa }))

const UPSTREAM_ARGS = ['--set-upstream', 'origin', 'feature-branch']
const RETRY_ATTEMPT_COUNT = 2

// Both ssh variables are stubbed empty rather than left alone: a machine that exports either one
// would otherwise fail the keepalive assertions below with no defect present, and `unstubAllEnvs`
// clears a stub rather than a genuinely exported variable.
beforeEach(() => {
	execa_mock.state.configured_ssh_command = ''
	execa_mock.state.push_outcomes = []
	execa_mock.state.push_calls = []
	vi.stubEnv(SSH_COMMAND_VARIABLE, '')
	vi.stubEnv(SSH_LEGACY_VARIABLE, '')
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

// In `afterEach` rather than at the end of each test body: a failing assertion never reaches the end
// of a body, and a leaked stub would turn one regression into several.
afterEach(() => {
	vi.unstubAllEnvs()
})

function first_push_options(): unknown {
	return execa_mock.state.push_calls[0]?.options
}

// joshuafolkken/kit#1251: the push path was the one unbounded network call in this directory, and a
// hang there cost about 9 minutes 50 seconds of a 72-minute run before it was killed by hand.
describe('the push spawn is bounded and kept alive', () => {
	it('passes the timeout budget to execa', async () => {
		await git_push_transport.push([])

		expect(first_push_options()).toMatchObject({ timeout: PUSH_TIMEOUT_MS })
	})

	it('spawns git push with the arguments it was given', async () => {
		await git_push_transport.push(UPSTREAM_ARGS)

		expect(execa_mock.state.push_calls[0]?.argument_list).toStrictEqual(['push', ...UPSTREAM_ARGS])
	})

	it('passes an SSH keepalive so a dead connection is not waited out to the TCP default', async () => {
		await git_push_transport.push([])

		expect(first_push_options()).toMatchObject({
			env: { [SSH_COMMAND_VARIABLE]: KEEPALIVE_SSH_COMMAND },
		})
	})
})

// The keepalive options are OpenSSH's, so they are only ever added to an ssh command this module
// chose itself: appending them to `plink`, or to a wrapper script with a fixed argument list, fails
// on a usage error, and setting the variable at all would override a configured `core.sshCommand`.
describe('an ssh command someone else configured is left alone', () => {
	it('adds nothing when GIT_SSH_COMMAND is already set', async () => {
		vi.stubEnv(SSH_COMMAND_VARIABLE, 'plink -batch')

		await git_push_transport.push([])

		expect(first_push_options()).toStrictEqual({
			stdio: 'inherit',
			timeout: PUSH_TIMEOUT_MS,
			env: {},
		})
	})

	it('adds nothing when core.sshCommand is configured', async () => {
		execa_mock.state.configured_ssh_command = 'ssh -i /keys/id_ed25519'

		await git_push_transport.push([])

		expect(first_push_options()).toMatchObject({ env: {} })
	})

	// The legacy variable is the one git reads *last*, which is exactly why it has to be asked:
	// setting `GIT_SSH_COMMAND` on top of it outranks it, so a PuTTY user would silently get a plain
	// `ssh` instead of the binary they named.
	it('adds nothing when the legacy GIT_SSH is set', async () => {
		vi.stubEnv(SSH_LEGACY_VARIABLE, 'plink.exe')

		await git_push_transport.push([])

		expect(first_push_options()).toMatchObject({ env: {} })
	})

	// The environment variable is honoured over the git config key, which is git's own precedence —
	// so an empty variable must not be read as "something is configured".
	it('keeps the keepalive when the variable is set but empty', async () => {
		vi.stubEnv(SSH_COMMAND_VARIABLE, ' '.repeat(3))

		await git_push_transport.push([])

		expect(first_push_options()).toMatchObject({
			env: { [SSH_COMMAND_VARIABLE]: KEEPALIVE_SSH_COMMAND },
		})
	})
})

describe('a push killed on the budget is retried once', () => {
	it('resolves when the retry succeeds', async () => {
		execa_mock.state.push_outcomes = [TIMED_OUT]

		await expect(git_push_transport.push([])).resolves.toBeUndefined()
		expect(execa_mock.state.push_calls).toHaveLength(RETRY_ATTEMPT_COUNT)
	})

	it('reports the timeout before trying again', async () => {
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		execa_mock.state.push_outcomes = [TIMED_OUT]

		await git_push_transport.push(UPSTREAM_ARGS)

		expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining(PUSH_TIMEOUT_MESSAGE))
	})
})

describe('a push that times out twice fails in a form that can be re-run by hand', () => {
	it('names the timeout rather than whatever git last wrote', async () => {
		execa_mock.state.push_outcomes = [TIMED_OUT, TIMED_OUT]

		await expect(git_push_transport.push(UPSTREAM_ARGS)).rejects.toThrow(PUSH_TIMEOUT_MESSAGE)
	})

	it('carries the exact command in the message', async () => {
		execa_mock.state.push_outcomes = [TIMED_OUT, TIMED_OUT]

		await expect(git_push_transport.push(UPSTREAM_ARGS)).rejects.toThrow(
			`git push ${UPSTREAM_ARGS.join(' ')}`,
		)
	})

	it('stops after the retry rather than trying a third time', async () => {
		execa_mock.state.push_outcomes = [TIMED_OUT, TIMED_OUT]

		await expect(git_push_transport.push([])).rejects.toThrow()
		expect(execa_mock.state.push_calls).toHaveLength(RETRY_ATTEMPT_COUNT)
	})
})

// A push the remote rejected answers the same way every time, so a retry would buy a second wait to
// reach an identical failure — and the 128 fallback in `git_command.push` reads the exit code off
// this error to decide whether to re-push with `--set-upstream`.
describe('a failure that is not a timeout is not retried', () => {
	it('spawns exactly once', async () => {
		execa_mock.state.push_outcomes = [REJECTED]

		await expect(git_push_transport.push([])).rejects.toThrow()
		expect(execa_mock.state.push_calls).toHaveLength(1)
	})

	it('throws with the exit code git reported', async () => {
		execa_mock.state.push_outcomes = [REJECTED]

		await expect(git_push_transport.push([])).rejects.toThrow(
			`exited with code ${String(execa_mock.EXIT_CODE)}`,
		)
	})
})
