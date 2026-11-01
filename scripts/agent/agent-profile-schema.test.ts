import { describe, expect, it } from 'vitest'
import { agent_model_alias } from './agent-model-alias'
import { agent_profile_schema, type AgentProfile } from './agent-profile-schema'

const { DEFAULT_PROFILES, OPENAI_PROFILES, REVIEWER, WORKER } = agent_profile_schema
const WORKER_PROFILE: AgentProfile = {
	provider: 'anthropic',
	role: WORKER,
	model: 'claude-opus-5-5',
	effort: 'medium',
}
const REVIEW_ROUND = 2

describe('parse', () => {
	it('returns a valid profile, defaulting the provider to anthropic', () => {
		expect(
			agent_profile_schema.parse({ role: WORKER, model: WORKER_PROFILE.model, effort: 'medium' }),
		).toStrictEqual(WORKER_PROFILE)
	})

	it('refuses a model carrying a control character', () => {
		expect(agent_profile_schema.parse({ ...WORKER_PROFILE, model: 'opus\n--flag' })).toBeUndefined()
	})

	it('refuses a value that is not a profile', () => {
		expect(agent_profile_schema.parse({ ...WORKER_PROFILE, effort: 'extreme' })).toBeUndefined()
		expect(agent_profile_schema.parse('worker')).toBeUndefined()
	})
})

describe('describe', () => {
	it('names every field of the profile with the model alias suffix', () => {
		const suffix = agent_model_alias.suffix_of(WORKER_PROFILE.model)

		expect(agent_profile_schema.describe(WORKER_PROFILE)).toBe(
			`provider=anthropic role=worker model=claude-opus-5-5${suffix} effort=medium`,
		)
	})

	it('prefixes the review round for a review launch', () => {
		const profile = DEFAULT_PROFILES[REVIEWER]

		expect(agent_profile_schema.describe_review(REVIEW_ROUND, profile)).toBe(
			`review round 2 · ${agent_profile_schema.describe(profile)}`,
		)
	})
})

describe('the default profiles', () => {
	it('run each role at the same effort under either provider', () => {
		expect(OPENAI_PROFILES[WORKER].effort).toBe(DEFAULT_PROFILES[WORKER].effort)
		expect(OPENAI_PROFILES[REVIEWER].effort).toBe(DEFAULT_PROFILES[REVIEWER].effort)
	})
})
