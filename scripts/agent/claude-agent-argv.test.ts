import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { claude_agent_argv } from './claude-agent-argv'

const INVOCATION = 'fullrun #2070'
const CLAUDE_ENV = { CLAUDE_CODE_SESSION_ID: 'session' }

describe('Claude argv construction', () => {
	it('puts an already-resolved profile and the invocation on the command line', () => {
		const profile = agent_role_profile.DEFAULT_PROFILES.worker
		const argv = claude_agent_argv.build(INVOCATION, profile)

		expect(argv.command).toBe('claude')
		expect(argv.args).toContain(profile.model)
		expect(argv.args).toContain(profile.effort)
		expect(argv.args.at(-1)).toBe(INVOCATION)
	})

	it('resolves exactly the requested role', () => {
		const result = claude_agent_argv.resolve(INVOCATION, agent_role_profile.REVIEWER, CLAUDE_ENV)

		expect(result).toMatchObject({
			kind: 'argv',
			profile: agent_role_profile.DEFAULT_PROFILES.reviewer,
		})
	})

	it('resolves the balanced worker profile onto the command line', () => {
		const result = claude_agent_argv.resolve(INVOCATION, agent_role_profile.WORKER, CLAUDE_ENV)

		expect(result).toMatchObject({
			kind: 'argv',
			profile: { provider: 'anthropic', role: 'worker', model: 'opus', effort: 'medium' },
		})
		if (result.kind === 'argv') expect(result.argv.args).toContain('opus')
	})

	it('passes no permission-bypass flag', () => {
		const argv = claude_agent_argv.build(INVOCATION, agent_role_profile.DEFAULT_PROFILES.worker)

		expect(argv.args).not.toContain('--dangerously-skip-permissions')
	})

	it('keeps detached output streaming for liveness checks', () => {
		const argv = claude_agent_argv.build(INVOCATION, agent_role_profile.DEFAULT_PROFILES.worker)

		expect(argv.args).toContain('--verbose')
		expect(argv.args).toContain('stream-json')
	})
})

// **The resume build carries `--resume <session_id>`** (joshuafolkken/kit#2317), so an outage
// re-dispatch continues the disconnected child's stored session rather than opening a new one.
describe('Claude resume argv construction', () => {
	const SESSION = '1d34ae8b-6f89-44b7-9f0f-42a67c44e650'

	it('puts --resume and the session id ahead of the model flags', () => {
		const profile = agent_role_profile.DEFAULT_PROFILES.worker
		const argv = claude_agent_argv.build_resume(INVOCATION, profile, SESSION)

		expect(argv.args).toContain('--resume')
		expect(argv.args[argv.args.indexOf('--resume') + 1]).toBe(SESSION)
		expect(argv.args.indexOf('--resume')).toBeLessThan(argv.args.indexOf('--model'))
	})

	it('keeps the invocation last so the liveness poll still matches', () => {
		const argv = claude_agent_argv.build_resume(
			INVOCATION,
			agent_role_profile.DEFAULT_PROFILES.worker,
			SESSION,
		)

		expect(argv.args.at(-1)).toBe(INVOCATION)
	})
})
