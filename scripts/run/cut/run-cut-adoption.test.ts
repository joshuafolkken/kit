import { agent_provider } from '#scripts/agent/agent-provider'
import { agent_session_environment } from '#scripts/josh/agent-session-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_adoption } from './run-cut-adoption'

const SESSION = 'cut-adopter'
const CLAUDE_KEY = agent_session_environment.SESSION_ID_KEY

afterEach(() => vi.unstubAllEnvs())

function set_session(key: string, value: string | undefined): void {
	for (const parent of agent_session_environment.PARENT_SESSION_KEYS) vi.stubEnv(parent, undefined)
	vi.stubEnv(agent_provider.CODEX_SESSION_KEY, undefined)
	vi.stubEnv(key, value)
}

describe('run_cut_adoption session identity', () => {
	it.each([
		[CLAUDE_KEY, 'anthropic'],
		[agent_provider.CODEX_SESSION_KEY, 'openai'],
	])('uses the stable session exported by %s', (key, provider) => {
		set_session(key, SESSION)

		expect(run_cut_adoption.session()).toBe(`${provider}:${SESSION}`)
	})

	it.each([
		[CLAUDE_KEY, undefined],
		[CLAUDE_KEY, ''],
		[CLAUDE_KEY, ' \t '],
		[agent_provider.CODEX_SESSION_KEY, undefined],
		[agent_provider.CODEX_SESSION_KEY, ''],
		[agent_provider.CODEX_SESSION_KEY, ' '],
	])('does not guess an identity from %s=%j', (key, value) => {
		set_session(key, value)

		expect(run_cut_adoption.session()).toBeUndefined()
	})

	it('trims the Claude session identity', () => {
		set_session(CLAUDE_KEY, ` ${SESSION} `)

		expect(run_cut_adoption.session()).toBe(`anthropic:${SESSION}`)
	})

	it('refuses conflicting session identities', () => {
		set_session(CLAUDE_KEY, SESSION)
		vi.stubEnv(agent_provider.CODEX_SESSION_KEY, SESSION)

		expect(run_cut_adoption.session()).toBeUndefined()
	})
})

describe('run_cut_adoption replacement', () => {
	it('requires the same issue and branch even for the adopting session', () => {
		set_session(agent_provider.CODEX_SESSION_KEY, SESSION)
		const cut = run_cut.fresh_cut(
			{ issue: '5482', branch: '5482-lane', phase: run_cut.PRE_GATE_PHASE },
			new Date(),
		)
		const adopted = { ...cut, is_handed_off: false, adopted_session: run_cut_adoption.session() }
		const next = { ...cut, phase: run_cut.IMPLEMENTATION_PHASE }

		expect(run_cut_adoption.can_replace(adopted, next)).toBe(true)
		expect(run_cut_adoption.can_replace(adopted, { ...next, issue: '1' })).toBe(false)
		expect(run_cut_adoption.can_replace(adopted, { ...next, branch: 'foreign' })).toBe(false)
	})
})
