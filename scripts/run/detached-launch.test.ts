import { describe, expect, it } from 'vitest'
import { detached_launch, type LaunchArgv } from './detached-launch'
import { run_wake_session } from './run-wake-session'

// The extraction joshuafolkken/kit#1749 made: `run:wake` and a lane's child dispatch start a detached
// process through one module. What the launch *does* is covered by `run-wake-session.test.ts`, which
// spawns a real throwaway child; what is pinned here is that there is one implementation and not two.

const INVOCATION = 'fullrun #1932'
const FIRST_ARGUMENT = 0
const LAST_ARGUMENT = -1
const VERBOSE_FLAG = '--verbose'
const OUTPUT_FORMAT_FLAG = '--output-format'
const STREAM_JSON = 'stream-json'

// The whole vector a dispatch composes when nothing is overridden, kept in one place so the flag
// literals are asserted rather than repeated across the tests below.
const DEFAULT_ARGS: ReadonlyArray<string> = [
	'-p',
	VERBOSE_FLAG,
	OUTPUT_FORMAT_FLAG,
	STREAM_JSON,
	'--model',
	detached_launch.DEFAULT_MODEL,
	'--effort',
	detached_launch.DEFAULT_EFFORT,
	INVOCATION,
]

// The model and effort are resolved from the environment, so the tests pass one explicitly rather than
// mutating `process.env`; an empty object is a run with neither override set.
const NO_OVERRIDES: Readonly<Record<string, string | undefined>> = {}

// `agent_argv` answers with a vector or a rejection; every test but the rejection ones wants the vector,
// so this unwraps it and fails loudly rather than letting an unexpected rejection read as a passing test.
function built(
	invocation: string,
	environment: Readonly<Record<string, string | undefined>> = NO_OVERRIDES,
): LaunchArgv {
	const result = detached_launch.agent_argv(invocation, environment)

	if (result.kind !== 'argv') throw new Error(`expected an argv, got ${result.kind}`)

	return result.argv
}

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
		expect(built(INVOCATION).args).not.toContain('--dangerously-skip-permissions')
	})
})

describe('detached_launch.agent_argv — where the invocation goes', () => {
	it('places the invocation last and as exactly one argument', () => {
		const argv = built(INVOCATION)

		expect(argv.command).toBe('claude')
		expect(argv.args.at(LAST_ARGUMENT)).toBe(INVOCATION)
		expect(argv.args[FIRST_ARGUMENT]).toBe('-p')
	})

	it('asks for a headless session, so nothing waits on a terminal', () => {
		expect(built(INVOCATION).args).toContain('-p')
	})

	// Without streaming a headless session writes nothing until it exits, so a detached child's log stays
	// frozen and `run:liveness` books a working child as stopped (joshuafolkken/kit#1948).
	it('streams the child output as JSON events, so its log grows while it works', () => {
		const argv = built(INVOCATION)
		const format_index = argv.args.indexOf(OUTPUT_FORMAT_FLAG)

		expect(argv.args).toContain(VERBOSE_FLAG)
		expect(format_index).not.toBe(-1)
		expect(argv.args[format_index + 1]).toBe(STREAM_JSON)
	})
})

describe('detached_launch.agent_argv — the model and effort it makes explicit', () => {
	it('passes the default model and effort when neither is overridden', () => {
		expect(built(INVOCATION).args).toStrictEqual(DEFAULT_ARGS)
	})

	it('takes the model and effort from the environment when they are set', () => {
		const argv = built(INVOCATION, {
			[detached_launch.MODEL_ENV_KEY]: 'sonnet',
			[detached_launch.EFFORT_ENV_KEY]: 'high',
		})

		expect(argv.args).toContain('sonnet')
		expect(argv.args).toContain('high')
		expect(argv.args).not.toContain(detached_launch.DEFAULT_MODEL)
	})

	it('treats a blank override as unset and falls back to the default', () => {
		const argv = built(INVOCATION, {
			[detached_launch.MODEL_ENV_KEY]: ' '.repeat(3),
			[detached_launch.EFFORT_ENV_KEY]: '',
		})

		expect(argv.args).toContain(detached_launch.DEFAULT_MODEL)
		expect(argv.args).toContain(detached_launch.DEFAULT_EFFORT)
	})

	it('accepts every permitted effort level', () => {
		for (const effort of detached_launch.ALLOWED_EFFORTS) {
			expect(built(INVOCATION, { [detached_launch.EFFORT_ENV_KEY]: effort }).args).toContain(effort)
		}
	})
})

describe('detached_launch.agent_argv — an override it refuses', () => {
	it('refuses an effort outside the allowlist, naming the value', () => {
		const result = detached_launch.agent_argv(INVOCATION, {
			[detached_launch.EFFORT_ENV_KEY]: 'turbo',
		})

		expect(result.kind).toBe('rejected')
		if (result.kind === 'rejected') expect(result.note).toContain('turbo')
	})

	it('refuses an effort carrying a control character', () => {
		const result = detached_launch.agent_argv(INVOCATION, {
			[detached_launch.EFFORT_ENV_KEY]: 'hi\u{0}gh',
		})

		expect(result.kind).toBe('rejected')
	})

	// A model name is open-ended, so it is not allowlisted; the control-character and length gate every
	// argument passes is what refuses a dangerous one, and it does so at the launch itself.
	it('lets a model through composition but refuses a control character in it at the launch gate', () => {
		const argv = built(INVOCATION, { [detached_launch.MODEL_ENV_KEY]: 'op\u{0}us' })

		expect(detached_launch.is_safe_argv(argv)).toBe(false)
	})
})

describe('detached_launch.is_safe_argv — what may reach the operating system', () => {
	it('refuses a NUL byte, which execve reads as the end of the string', () => {
		expect(detached_launch.is_safe_argv(built('backlogrun\u{0}--rm'))).toBe(false)
	})

	it('refuses a line break, which would split one argument into two', () => {
		expect(detached_launch.is_safe_argv(built('backlogrun\nrm -rf /'))).toBe(false)
	})

	it('refuses an empty value and one past the argument-length bound', () => {
		expect(detached_launch.is_safe_value('')).toBe(false)
		expect(detached_launch.is_safe_value('x'.repeat(detached_launch.MAX_ARGUMENT_LENGTH))).toBe(
			true,
		)
	})

	it('accepts the vector the waker composes', () => {
		expect(detached_launch.is_safe_argv(built(INVOCATION))).toBe(true)
	})
})

describe('detached_launch.log_header — the launch log records the model and effort', () => {
	it('names the model and effort the composed vector carries', () => {
		expect(detached_launch.log_header(built(INVOCATION))).toContain(
			`model=${detached_launch.DEFAULT_MODEL} effort=${detached_launch.DEFAULT_EFFORT}`,
		)
	})

	it('adds no model or effort when the vector carries neither', () => {
		expect(detached_launch.log_header({ command: 'node', args: ['--loop'] })).not.toContain(
			'model=',
		)
	})
})
