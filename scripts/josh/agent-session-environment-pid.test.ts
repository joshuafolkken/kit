import { describe, expect, it } from 'vitest'
import { agent_session_environment } from './agent-session-environment'

// Pins the session pid a run hold and a carry record take as their owner when none is named.

const SESSION_PID = 51_724

function pid_of(value: string | undefined): number | undefined {
	return agent_session_environment.session_pid({ [agent_session_environment.AGENT_PID_KEY]: value })
}

describe('agent_session_environment.session_pid', () => {
	it('reads the pid the session exports', () => {
		expect(pid_of(String(SESSION_PID))).toBe(SESSION_PID)
	})

	it.each([undefined, '', '0', '-1', '1.5', 'abc'])('reads no pid from %j', (value) => {
		expect(pid_of(value)).toBeUndefined()
	})
})

describe('agent_session_environment.own_session_pid', () => {
	const exported = { [agent_session_environment.AGENT_PID_KEY]: String(SESSION_PID) }

	it('reads the pid beside the session id that marks it as the caller', () => {
		const own = { ...exported, [agent_session_environment.SESSION_ID_KEY]: 'own-session' }

		expect(agent_session_environment.own_session_pid(own)).toBe(SESSION_PID)
	})

	it('reads no pid inherited by a launch that stripped the session id', () => {
		expect(agent_session_environment.own_session_pid(exported)).toBeUndefined()
	})
})
