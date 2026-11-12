import { epic_bundle_format } from '#scripts/epic/epic-bundle-format'
import { describe, expect, it } from 'vitest'
import { issue_scout_cli } from './issue-scout-cli'

// The scout prints `epic:bundle`'s spread lines through the same formatter, so a draft whose cited
// issues sit in two epics names the recommendation — or its absence — the `ask` headline points at.

const SPREAD = { action: 'ask', epics: [880, 893], candidates: [1, 2], reason: 'spread' } as const

describe('issue_scout_cli.format_epic — an ask answer', () => {
	it('names the recommended epic', () => {
		expect(issue_scout_cli.format_epic({ ...SPREAD, recommended: 893 })).toContain(
			'  Recommended: #893',
		)
	})

	it('says none is recommended on a cycle', () => {
		expect(issue_scout_cli.format_epic(SPREAD)).toContain(epic_bundle_format.NO_RECOMMENDATION_LINE)
	})
})
