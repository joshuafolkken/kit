import { describe, expect, it } from 'vitest'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'

const { REVIEWER, SCHEDULER, WORKER } = agent_role_profile
const OPENAI_MODEL = 'gpt-5.6-sol'

function profile(
	role: typeof SCHEDULER | typeof WORKER | typeof REVIEWER,
	environment = {},
): AgentProfile {
	const result = agent_role_profile.resolve(role, environment)

	if (result.kind === 'rejected') throw new Error(result.note)

	return result.profile
}

describe('the role policy defaults', () => {
	it('assigns the requested Anthropic profile to each role', () => {
		expect(profile(SCHEDULER)).toStrictEqual({
			provider: 'anthropic',
			role: SCHEDULER,
			model: 'opus',
			effort: 'high',
		})
		expect(profile(WORKER)).toMatchObject({
			provider: 'anthropic',
			model: 'sonnet',
			effort: 'medium',
		})
		expect(profile(REVIEWER)).toMatchObject({
			provider: 'anthropic',
			model: 'opus',
			effort: 'high',
		})
	})

	it('assigns the requested OpenAI profile to each role', () => {
		const environment = { JOSH_AGENT_PROVIDER: 'openai' }

		expect(profile(SCHEDULER, environment)).toStrictEqual({
			provider: 'openai',
			role: SCHEDULER,
			model: OPENAI_MODEL,
			effort: 'high',
		})
		expect(profile(WORKER, environment)).toMatchObject({ model: OPENAI_MODEL, effort: 'medium' })
		expect(profile(REVIEWER, environment)).toMatchObject({ model: OPENAI_MODEL, effort: 'high' })
	})

	it('keeps Anthropic as the backward-compatible provider', () => {
		expect(profile(WORKER).provider).toBe('anthropic')
	})
})

describe('role-specific overrides', () => {
	it('changes only the role whose keys are set', () => {
		const environment = { JOSH_WORKER_MODEL: 'sonnet', JOSH_WORKER_EFFORT: 'low' }

		expect(profile(WORKER, environment)).toMatchObject({ model: 'sonnet', effort: 'low' })
		expect(profile(SCHEDULER, environment)).toStrictEqual(
			agent_role_profile.DEFAULT_PROFILES.scheduler,
		)
	})

	it('treats a blank role override as unset', () => {
		expect(profile(REVIEWER, { JOSH_REVIEWER_MODEL: ' ', JOSH_REVIEWER_EFFORT: '' })).toStrictEqual(
			agent_role_profile.DEFAULT_PROFILES.reviewer,
		)
	})
})

describe('legacy worker overrides', () => {
	it('uses legacy lane keys only for a worker without new keys', () => {
		const environment = { JOSH_LANE_MODEL: 'legacy', JOSH_LANE_EFFORT: 'xhigh' }

		expect(profile(WORKER, environment)).toMatchObject({ model: 'legacy', effort: 'xhigh' })
		expect(profile(SCHEDULER, environment)).toStrictEqual(
			agent_role_profile.DEFAULT_PROFILES.scheduler,
		)
	})

	it('lets the new worker keys replace legacy values', () => {
		const environment = {
			JOSH_WORKER_MODEL: 'new',
			JOSH_WORKER_EFFORT: 'high',
			JOSH_LANE_MODEL: 'legacy',
			JOSH_LANE_EFFORT: 'low',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'new', effort: 'high' })
	})
})

describe('blank new worker overrides', () => {
	it('uses non-empty legacy values where the corresponding new worker key is blank', () => {
		const environment = {
			JOSH_WORKER_MODEL: ' ',
			JOSH_WORKER_EFFORT: '',
			JOSH_LANE_MODEL: 'legacy',
			JOSH_LANE_EFFORT: 'xhigh',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'legacy', effort: 'xhigh' })
	})

	it('resolves each worker field independently across new and legacy keys', () => {
		const environment = {
			JOSH_WORKER_MODEL: 'new',
			JOSH_WORKER_EFFORT: ' ',
			JOSH_LANE_MODEL: 'legacy',
			JOSH_LANE_EFFORT: 'low',
		}

		expect(profile(WORKER, environment)).toMatchObject({ model: 'new', effort: 'low' })
	})
})

describe('invalid overrides', () => {
	it('rejects an unknown provider without falling back', () => {
		const result = agent_role_profile.resolve(WORKER, { JOSH_AGENT_PROVIDER: 'unknown' })

		expect(result).toMatchObject({ kind: 'rejected' })
		expect(JSON.stringify(result)).toContain('JOSH_AGENT_PROVIDER=unknown')
	})
	it('rejects an effort outside the allowlist without escalating it', () => {
		const result = agent_role_profile.resolve(WORKER, { JOSH_WORKER_EFFORT: 'turbo' })

		expect(result).toMatchObject({ kind: 'rejected' })
		expect(JSON.stringify(result)).toContain('turbo')
	})

	it('rejects control characters in a model', () => {
		expect(
			agent_role_profile.resolve(REVIEWER, { JOSH_REVIEWER_MODEL: 'op\u{0}us' }),
		).toMatchObject({ kind: 'rejected' })
	})
})
