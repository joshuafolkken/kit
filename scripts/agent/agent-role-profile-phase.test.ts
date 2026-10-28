import { describe, expect, it } from 'vitest'
import { agent_role_profile, type AgentProfile, type ProfileResult } from './agent-role-profile'

const { DEFAULT_PROFILES, IMPLEMENTATION_PHASE, OPENAI_PROFILES, PRE_GATE_PHASE, WORKER } =
	agent_role_profile
const ANTHROPIC_ENV = { CLAUDE_CODE_SESSION_ID: 'claude-session' }
const OPENAI_ENV = { CODEX_THREAD_ID: 'codex-thread' }
const SHIP_MODEL = 'claude-sonnet-5-5'
const SHIP_ENV = { ...ANTHROPIC_ENV, JOSH_WORKER_SHIP_MODEL: SHIP_MODEL }
const ROLE_MODEL_ENV = { ...ANTHROPIC_ENV, JOSH_WORKER_MODEL: 'claude-opus-x' }
const UNSAFE_SHIP_ENV = { ...ANTHROPIC_ENV, JOSH_WORKER_SHIP_MODEL: 'son\u{0}net' }

function profile_of(result: ProfileResult): AgentProfile {
	if (result.kind === 'rejected') throw new Error(result.note)

	return result.profile
}

function model_for(environment: Record<string, string>, phase?: string): string {
	return profile_of(agent_role_profile.resolve(WORKER, environment, phase)).model
}

// joshuafolkken/kit#5343: the ship phase may run on a model of its own, applied where `SHIP_EFFORT` is.
describe('phase-resolved model', () => {
	it('keeps the role model in the pre-gate phase when the ship key is unset', () => {
		expect(model_for(ANTHROPIC_ENV, PRE_GATE_PHASE)).toBe(DEFAULT_PROFILES.worker.model)
	})

	it('runs the pre-gate phase on the ship model when its key is set', () => {
		expect(model_for(SHIP_ENV, PRE_GATE_PHASE)).toBe(SHIP_MODEL)
	})

	it('lets the ship key win over the role model key in the pre-gate phase', () => {
		expect(model_for({ ...ROLE_MODEL_ENV, ...SHIP_ENV }, PRE_GATE_PHASE)).toBe(SHIP_MODEL)
	})

	it('leaves the implementation phase and a phase-less call on the role model', () => {
		expect(model_for(SHIP_ENV, IMPLEMENTATION_PHASE)).toBe(DEFAULT_PROFILES.worker.model)
		expect(model_for(SHIP_ENV)).toBe(DEFAULT_PROFILES.worker.model)
	})

	it('ignores the ship key in an OpenAI session', () => {
		const environment = { ...OPENAI_ENV, JOSH_WORKER_SHIP_MODEL: SHIP_MODEL }

		expect(model_for(environment, PRE_GATE_PHASE)).toBe(OPENAI_PROFILES.worker.model)
	})

	it('rejects an unsafe ship model', () => {
		const result = agent_role_profile.resolve(WORKER, UNSAFE_SHIP_ENV, PRE_GATE_PHASE)

		expect(result).toMatchObject({ kind: 'rejected' })
		expect(JSON.stringify(result)).toContain('JOSH_WORKER_SHIP_MODEL')
	})
})

describe('with_phase', () => {
	const base = DEFAULT_PROFILES.worker

	it('applies the phase effort to a stored profile and keeps its model', () => {
		const adjusted = profile_of(agent_role_profile.with_phase(base, PRE_GATE_PHASE, ANTHROPIC_ENV))

		expect(adjusted).toMatchObject({ model: base.model, effort: 'low' })
	})

	it('lets an env override win over the phase for a stored profile', () => {
		const environment = { ...ANTHROPIC_ENV, JOSH_WORKER_EFFORT: 'xhigh' }

		expect(
			profile_of(agent_role_profile.with_phase(base, PRE_GATE_PHASE, environment)).effort,
		).toBe('xhigh')
	})

	it('moves a stored profile to the ship model when the ship key is set', () => {
		const adjusted = profile_of(agent_role_profile.with_phase(base, PRE_GATE_PHASE, SHIP_ENV))

		expect(adjusted).toMatchObject({ model: SHIP_MODEL, effort: 'low' })
	})

	it('keeps the stored model against the role model key', () => {
		const adjusted = profile_of(agent_role_profile.with_phase(base, PRE_GATE_PHASE, ROLE_MODEL_ENV))

		expect(adjusted.model).toBe(base.model)
	})

	it('keeps a stored OpenAI profile on its model', () => {
		const stored = OPENAI_PROFILES.worker

		expect(profile_of(agent_role_profile.with_phase(stored, PRE_GATE_PHASE, SHIP_ENV)).model).toBe(
			stored.model,
		)
	})

	it('rejects an unsafe ship model on a stored profile', () => {
		expect(agent_role_profile.with_phase(base, PRE_GATE_PHASE, UNSAFE_SHIP_ENV)).toMatchObject({
			kind: 'rejected',
		})
	})
})
