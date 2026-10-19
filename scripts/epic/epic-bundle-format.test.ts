import { describe, expect, it } from 'vitest'
import type { BacklogIssue, BundleDecision } from './epic-bundle'
import { epic_bundle_format } from './epic-bundle-format'

// The verdict wording is asserted end to end in `epic-bundle-cli.test.ts`; what this file fixes is the
// member selection `--apply` shares with the printed order.

const REPO = 'joshuafolkken/kit'

function issue(number: number): BacklogIssue {
	return { number, repo: REPO, body: '', blocked_by: [] }
}

const DECISION: BundleDecision = {
	action: 'create_epic',
	epics: [],
	candidates: [890, 892],
	reason: 'They reference each other.',
}

describe('epic_bundle_format.members_of', () => {
	it('keeps only the backlog rows the verdict names, in backlog order', () => {
		const members = epic_bundle_format.members_of(DECISION, [issue(892), issue(891), issue(890)])

		expect(members.map((member) => member.number)).toStrictEqual([892, 890])
	})
})

describe('epic_bundle_format.format_decision', () => {
	it('prints the children and the undeclared order for a placing verdict', () => {
		const report = epic_bundle_format.format_decision(
			DECISION,
			issue(894),
			[issue(890), issue(892)],
			true,
		)

		expect(report).toContain('  Children: #890, #892, #894')
		expect(report).toContain('Order: none declared')
	})
})
