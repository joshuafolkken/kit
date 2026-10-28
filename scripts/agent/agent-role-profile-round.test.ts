import { describe, expect, it } from 'vitest'
import { agent_role_profile, type AgentEnvironment, type AgentProfile } from './agent-role-profile'

// joshuafolkken/kit#3926: the round-2 verification pass resolves a reviewer profile of its own.

const { DEFAULT_PROFILES, VERIFICATION_PROFILES } = agent_role_profile
const ANTHROPIC_ENV = { CLAUDE_CODE_SESSION_ID: 'claude-session' }
const OPENAI_ENV = { CODEX_THREAD_ID: 'codex-thread' }
const ROUND_ONE = 1
const ROUND_TWO = 2
const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const FABLE = 'claude-fable-5-1'
const HAIKU = 'claude-haiku-4-5-20251001'
const VERIFICATION = {
	JOSH_REVIEWER_VERIFICATION_MODEL: HAIKU,
	JOSH_REVIEWER_VERIFICATION_EFFORT: 'medium',
}
const REVIEWER = { JOSH_REVIEWER_MODEL: FABLE, JOSH_REVIEWER_EFFORT: 'max' }

function review_profile(round: number, environment: AgentEnvironment = {}): AgentProfile {
	const result = agent_role_profile.resolve_review(round, { ...ANTHROPIC_ENV, ...environment })

	if (result.kind === 'rejected') throw new Error(result.note)

	return result.profile
}

describe('the review round defaults', () => {
	it('resolves round 1 exactly as the reviewer role does', () => {
		expect(review_profile(ROUND_ONE)).toStrictEqual(DEFAULT_PROFILES.reviewer)
	})

	it('resolves a later round to the verification profile', () => {
		expect(review_profile(ROUND_TWO)).toStrictEqual(VERIFICATION_PROFILES.anthropic)
	})

	// joshuafolkken/kit#5106: round 1 runs at medium, the verification pass stays at high.
	it('runs an Anthropic round 1 on Opus at medium', () => {
		expect(review_profile(ROUND_ONE)).toMatchObject({ model: OPUS, effort: 'medium' })
	})

	it('runs an Anthropic verification round on Sonnet at high', () => {
		expect(review_profile(ROUND_TWO)).toMatchObject({ model: SONNET, effort: 'high' })
	})

	it('resolves an OpenAI verification round to the OpenAI reviewer at high', () => {
		const result = agent_role_profile.resolve_review(ROUND_TWO, OPENAI_ENV)

		expect(result).toStrictEqual({ kind: 'profile', profile: VERIFICATION_PROFILES.openai })
		expect(VERIFICATION_PROFILES.openai).toMatchObject({ model: 'gpt-6.1-sol', effort: 'high' })
	})

	it('runs an OpenAI round 1 at medium', () => {
		const result = agent_role_profile.resolve_review(ROUND_ONE, OPENAI_ENV)

		expect(result).toMatchObject({ profile: { provider: 'openai', effort: 'medium' } })
	})
})

describe('the review round override order', () => {
	it('lets the verification keys decide a later round over the reviewer keys', () => {
		expect(review_profile(ROUND_TWO, { ...REVIEWER, ...VERIFICATION })).toMatchObject({
			model: HAIKU,
			effort: 'medium',
		})
	})

	it('falls back to the reviewer keys for a later round with no verification keys', () => {
		expect(review_profile(ROUND_TWO, REVIEWER)).toMatchObject({ model: FABLE, effort: 'max' })
	})

	it('leaves round 1 to the reviewer keys alone', () => {
		expect(review_profile(ROUND_ONE, VERIFICATION)).toStrictEqual(DEFAULT_PROFILES.reviewer)
	})
})

describe('the review round override refusals', () => {
	it('names the verification key when its effort is refused', () => {
		const result = agent_role_profile.resolve_review(ROUND_TWO, {
			...ANTHROPIC_ENV,
			JOSH_REVIEWER_VERIFICATION_EFFORT: 'extreme',
		})

		expect(result).toStrictEqual({
			kind: 'rejected',
			note: 'JOSH_REVIEWER_VERIFICATION_EFFORT=extreme is not an allowed effort, so the agent was not started',
		})
	})

	it('passes no Anthropic model override to an OpenAI verification round', () => {
		const result = agent_role_profile.resolve_review(ROUND_TWO, { ...OPENAI_ENV, ...VERIFICATION })

		expect(result).toMatchObject({ profile: { model: VERIFICATION_PROFILES.openai.model } })
	})
})

describe('describe_review', () => {
	it('names the round beside the profile', () => {
		expect(agent_role_profile.describe_review(ROUND_TWO, DEFAULT_PROFILES.reviewer)).toBe(
			'review round 2 · provider=anthropic role=reviewer model=claude-opus-5-5 effort=medium',
		)
	})
})
