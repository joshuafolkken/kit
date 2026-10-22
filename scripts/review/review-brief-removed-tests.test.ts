import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'

// joshuafolkken/kit#4287: a test the change deletes is listed in the brief, so the reviewer accounts
// for it rather than reading the deletion as an ordinary hunk.

const TITLE = 'removed_tests > lists a gone test'
const HEADING = 'Removed tests'

function compose(removed?: ReadonlyArray<string>): string {
	return review_brief.compose({
		level: 'medium',
		profile: agent_role_profile.DEFAULT_PROFILES.reviewer,
		round: 1,
		tree: {},
		stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
		checkout: {
			root: '/lanes/4287',
			branch: '4287-lane',
			head: '0123456789abcdef0123456789abcdef01234567',
		},
		nonce: 'deadbeefcafef00d',
		base: 'fedcba9876543210fedcba9876543210fedcba98',
		rubric_path: '/kit/prompts/review-rubric.md',
		removed_tests: removed,
	})
}

describe('review_brief.compose — removed tests', () => {
	it('lists each removed test as an undisposed row', () => {
		const brief = compose([TITLE])

		expect(brief).toContain(HEADING)
		expect(brief).toContain(`- \`${TITLE}\` — 未記入`)
	})

	it('omits the section when the change removed no test', () => {
		expect(compose([])).not.toContain(HEADING)
	})

	it('omits the section when the list is absent', () => {
		expect(compose()).not.toContain(HEADING)
	})
})
