import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { expect, test } from 'vitest'
import { review_brief } from './review-brief'

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
	})

	expect(brief).toContain('role=reviewer model=opus effort=high')
})
