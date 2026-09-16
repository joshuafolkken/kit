import { describe, expect, it, vi } from 'vitest'
import { agent_diagnostics, type DiagnosticPorts } from './agent-diagnostics'
import { agent_role_profile } from './agent-role-profile'

const OPENAI_WORKER = agent_role_profile.OPENAI_PROFILES.worker
const NOT_LOGGED_IN = 'Not logged in'

function ports(outcome: ReturnType<DiagnosticPorts['run']>): DiagnosticPorts {
	return { run: vi.fn().mockReturnValue(outcome) }
}

describe('OpenAI launch diagnostics', () => {
	it('accepts an authenticated Codex CLI after exactly one check', () => {
		const fake = ports({ status: 0, stdout: 'Logged in' })

		expect(agent_diagnostics.check(OPENAI_WORKER, fake)).toStrictEqual({ kind: 'ready' })
		expect(fake.run).toHaveBeenCalledTimes(1)
		expect(fake.run).toHaveBeenCalledWith('codex', ['login', 'status'])
	})

	it('reports a missing CLI without retry or provider fallback', () => {
		const fake = ports({ status: undefined, error: new Error('spawn codex ENOENT') })
		const result = agent_diagnostics.check(OPENAI_WORKER, fake)

		expect(result.kind === 'rejected' && result.note).toContain('ENOENT')
		expect(fake.run).toHaveBeenCalledTimes(1)
	})

	it('reports missing authentication without retry', () => {
		const fake = ports({ status: 1, stderr: NOT_LOGGED_IN })
		const result = agent_diagnostics.check(OPENAI_WORKER, fake)

		expect(result.kind === 'rejected' && result.note).toContain(NOT_LOGGED_IN)
		expect(fake.run).toHaveBeenCalledTimes(1)
	})
})
