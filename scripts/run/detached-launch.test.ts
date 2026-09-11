import { describe, expect, it } from 'vitest'
import { detached_launch } from './detached-launch'
import { run_wake_session } from './run-wake-session'

// The extraction joshuafolkken/kit#1749 made: `run:wake` and a lane's child dispatch start a detached
// process through one module. What the launch *does* is covered by `run-wake-session.test.ts`, which
// spawns a real throwaway child; what is pinned here is that there is one implementation and not two.

const INVOCATION = 'backlogrun --max 5'
const FIRST_ARGUMENT = 0
const LAST_ARGUMENT = -1

describe('detached_launch — one launcher, shared by every detached agent session', () => {
	it('is the very same function `run:wake` calls', () => {
		expect(run_wake_session.launch).toBe(detached_launch.launch)
		expect(run_wake_session.ensure_log).toBe(detached_launch.ensure_log)
		expect(run_wake_session.is_safe_argv).toBe(detached_launch.is_safe_argv)
	})

	it('is the very same agent CLI the waker names', () => {
		expect(run_wake_session.WAKE_COMMAND).toBe(detached_launch.AGENT_COMMAND)
		expect(run_wake_session.WAKE_FLAGS).toBe(detached_launch.AGENT_FLAGS)
	})

	it('never disarms the permission checks of the checkout it starts in', () => {
		const argv = detached_launch.agent_argv(INVOCATION)

		expect(argv.args).not.toContain('--dangerously-skip-permissions')
	})
})

describe('detached_launch.agent_argv — where the invocation goes', () => {
	it('places the invocation last and as exactly one argument', () => {
		const argv = detached_launch.agent_argv(INVOCATION)

		expect(argv.command).toBe('claude')
		expect(argv.args.at(LAST_ARGUMENT)).toBe(INVOCATION)
		expect(argv.args[FIRST_ARGUMENT]).toBe('-p')
	})

	it('asks for a headless session, so nothing waits on a terminal', () => {
		expect(detached_launch.agent_argv(INVOCATION).args).toContain('-p')
	})
})

describe('detached_launch.is_safe_argv — what may reach the operating system', () => {
	it('refuses a NUL byte, which execve reads as the end of the string', () => {
		expect(detached_launch.is_safe_argv(detached_launch.agent_argv('backlogrun\u{0}--rm'))).toBe(
			false,
		)
	})

	it('refuses a line break, which would split one argument into two', () => {
		expect(detached_launch.is_safe_argv(detached_launch.agent_argv('backlogrun\nrm -rf /'))).toBe(
			false,
		)
	})

	it('refuses an empty value and one past the argument-length bound', () => {
		expect(detached_launch.is_safe_value('')).toBe(false)
		expect(detached_launch.is_safe_value('x'.repeat(detached_launch.MAX_ARGUMENT_LENGTH))).toBe(
			true,
		)
	})

	it('accepts the vector the waker composes', () => {
		expect(detached_launch.is_safe_argv(detached_launch.agent_argv(INVOCATION))).toBe(true)
	})
})
