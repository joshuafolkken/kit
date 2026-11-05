import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { expect, test } from 'vitest'
import { review_brief } from './review-brief'

const RUBRIC_PATH = '/pkg/prompts/review-rubric.md'

test('a low review brief prints the resolved Sonnet default', () => {
	const resolved = agent_role_profile.resolve_review(1, { CLAUDE_CODE_SESSION_ID: 'session' }, true)
	if (resolved.kind === 'rejected') throw new Error(resolved.note)
	const brief = review_brief.compose({
		level: 'low',
		profile: resolved.profile,
		round: 1,
		tree: {},
		stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
		checkout: { root: '/lane', branch: '6230-lane', head: 'abc' },
		nonce: 'nonce',
		base: 'main',
		rubric_path: RUBRIC_PATH,
	})

	expect(brief).toContain('model=claude-sonnet-5-5 (sonnet) effort=medium')
})

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

	expect(brief).toContain(
		'provider=anthropic role=reviewer model=claude-opus-5-5 (opus) effort=medium',
	)
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

	expect(brief).toContain('provider=openai role=reviewer model=gpt-6.1-sol effort=medium')
})
