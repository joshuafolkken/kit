import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { agent_session_role } from './agent-session-role'

describe('agent_session_role', () => {
	it.each(['gpt-6.1-sol', 'gpt-6.1-astra', 'claude-fable-5-1'])(
		'uses launcher roles independently of model %s',
		(model) => {
			for (const role of ['scheduler', 'reviewer', undefined, 'unknown', 'worker']) {
				const source = { [agent_session_role.KEY]: role, model }

				expect(agent_session_role.can_implement(source)).toBe(role === 'worker')
				expect(agent_session_role.scope_line(source)).toContain(
					role === 'worker' ? 'implementation is permitted' : 'operations only',
				)
			}
		},
	)

	it('reads the reviewer fragment as a reviewer session', () => {
		const source = agent_session_role.env_for(agent_role_profile.REVIEWER)

		expect(agent_session_role.is_reviewer(source)).toBe(true)
	})

	it.each([
		['absent mark', {}],
		['worker', agent_session_role.env_for(agent_role_profile.WORKER)],
		['scheduler', agent_session_role.env_for(agent_role_profile.SCHEDULER)],
		['unknown value', { [agent_session_role.KEY]: '1' }],
	])('reads an %s as a session that is not a reviewer', (_name, source) => {
		expect(agent_session_role.is_reviewer(source)).toBe(false)
	})
})
