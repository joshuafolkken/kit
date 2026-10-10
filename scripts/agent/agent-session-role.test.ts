import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { agent_session_role } from './agent-session-role'

describe('agent_session_role', () => {
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
