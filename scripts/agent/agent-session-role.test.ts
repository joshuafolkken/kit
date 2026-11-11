import { describe, expect, it } from 'vitest'
import { agent_role_profile } from './agent-role-profile'
import { agent_session_role } from './agent-session-role'

const ABSENT_MARK = 'absent mark'

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
		[ABSENT_MARK, {}],
		['worker', agent_session_role.env_for(agent_role_profile.WORKER)],
		['scheduler', agent_session_role.env_for(agent_role_profile.SCHEDULER)],
		['unknown value', { [agent_session_role.KEY]: '1' }],
	])('reads an %s as a session that is not a reviewer', (_name, source) => {
		expect(agent_session_role.is_reviewer(source)).toBe(false)
	})

	// joshuafolkken/kit#6901: the consultation main line is told apart by its launch, not its model.
	it.each([
		['worker', agent_session_role.env_for(agent_role_profile.WORKER), true],
		['reviewer', agent_session_role.env_for(agent_role_profile.REVIEWER), true],
		['scheduler', agent_session_role.env_for(agent_role_profile.SCHEDULER), true],
		[ABSENT_MARK, {}, false],
		['empty mark', { [agent_session_role.KEY]: '' }, false],
	])('reads a %s session as launched: %s', (_name, source, expected) => {
		expect(agent_session_role.is_launched(source)).toBe(expected)
	})
})

// joshuafolkken/kit#7293: the consultation scope must not read as unconditional filing permission.
describe('agent_session_role.scope_line', () => {
	it('grants filing only on the user’s explicit instruction outside a worker lane', () => {
		const line = agent_session_role.scope_line({})

		expect(line).toContain('filing only on the user’s explicit instruction')
		expect(line).not.toContain('consultation, filing and operations')
	})
})
