import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { expect, test } from 'vitest'
import { review_brief } from './review-brief'

const RUBRIC_PATH = '/pkg/prompts/review-rubric.md'

test('the review brief hands orchestration the resolved reviewer profile', () => {
	const brief = review_brief.compose({
		level: 'medium',
		profile: agent_role_profile.DEFAULT_PROFILES.reviewer,
		round: 1,
		tree: {},
		stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
		checkout: { root: '/lane', branch: '2070-lane', head: 'abc' },
		nonce: 'nonce',
		base: 'main',
		rubric_path: RUBRIC_PATH,
	})

	expect(brief).toContain('provider=anthropic role=reviewer model=claude-opus-5-5 effort=high')
})

test('the review brief hands orchestration the OpenAI reviewer profile', () => {
	const brief = review_brief.compose({
		level: 'medium',
		profile: agent_role_profile.OPENAI_PROFILES.reviewer,
		round: 1,
		tree: {},
		stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
		checkout: { root: '/lane', branch: '2071-lane', head: 'abc' },
		nonce: 'nonce',
		base: 'main',
		rubric_path: RUBRIC_PATH,
	})

	expect(brief).toContain('provider=openai role=reviewer model=gpt-6-sol effort=high')
})
