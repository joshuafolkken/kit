import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { claude_agent_argv, type ClaudeArgv } from '#scripts/agent/claude-agent-argv'
import { run_wake_session } from '#scripts/run/wake/run-wake-session'
import { describe, expect, it } from 'vitest'
import { detached_launch } from './detached-launch'

const INVOCATION = 'fullrun #2070'
const PROFILE = agent_role_profile.DEFAULT_PROFILES.worker

function built(invocation: string = INVOCATION): ClaudeArgv {
	return claude_agent_argv.build(invocation, PROFILE)
}

describe('the shared detached launcher', () => {
	it('is the same process mechanism the wake supervisor calls', () => {
		expect(run_wake_session.launch).toBe(detached_launch.launch)
		expect(run_wake_session.ensure_log).toBe(detached_launch.ensure_log)
		expect(run_wake_session.is_safe_argv).toBe(detached_launch.is_safe_argv)
	})

	it('does not own a provider command or model policy', () => {
		expect(Object.keys(detached_launch)).not.toContain('agent_argv')
		expect(Object.keys(detached_launch)).not.toContain('DEFAULT_MODEL')
	})
})

describe('the argv safety gate', () => {
	it('refuses control characters and empty arguments', () => {
		expect(detached_launch.is_safe_argv(built('backlogrun\u{0}--rm'))).toBe(false)
		expect(detached_launch.is_safe_argv(built('backlogrun\t--rm'))).toBe(false)
		expect(detached_launch.is_safe_value('')).toBe(false)
	})

	// joshuafolkken/kit#3964: a ship-stop prompt carries the failed output's lines.
	it('lets line breaks into an agent vector prompt and nowhere else', () => {
		const argv = built('Fix the gate failure\nFAIL gate\nfullrun #2070')

		expect(detached_launch.is_safe_argv(argv)).toBe(true)
		expect(detached_launch.is_safe_argv({ ...argv, args: ['--model\n', ...argv.args] })).toBe(false)
		expect(detached_launch.is_safe_argv({ command: 'node', args: ['a\nb'] })).toBe(false)
		const oversized = built(`a\n${'x'.repeat(agent_role_profile.MAX_VALUE_LENGTH)}`)

		expect(detached_launch.is_safe_argv(oversized)).toBe(false)
	})

	it('accepts a vector composed by the Claude adapter', () => {
		expect(detached_launch.is_safe_argv(built())).toBe(true)
	})
})

describe('the launch log header', () => {
	it('records the role, model and effort from launch metadata', () => {
		expect(detached_launch.log_header(built(), PROFILE)).toContain(
			agent_role_profile.describe(PROFILE),
		)
	})

	it('adds no profile to a provider-independent process launch', () => {
		expect(detached_launch.log_header({ command: 'node', args: ['--loop'] })).not.toContain('role=')
	})
})
