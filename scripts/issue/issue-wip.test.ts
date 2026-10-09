import { describe, expect, it } from 'vitest'
import { issue_wip } from './issue-wip'

// joshuafolkken/kit#3181: `josh issue:file` counts the target's open Issues against the WIP cap and
// holds a filing past it unless the route or `--over-cap` declares it exempt.

const CAP = issue_wip.WIP_CAP
const OVER = CAP + 1
const REPO = 'joshuafolkken/kit'
const NO_ROUTE = { route: undefined, is_over_cap: false }

describe('issue_wip.verdict_of — the cap against the count', () => {
	it('is within at exactly the cap', () => {
		expect(issue_wip.verdict_of(CAP, NO_ROUTE)).toBe('within')
	})

	it('holds a filing past the cap with no exemption declared', () => {
		expect(issue_wip.verdict_of(OVER, NO_ROUTE)).toBe(issue_wip.HELD)
	})

	it('holds the review cap branch-2 route, which is discretionary', () => {
		expect(issue_wip.verdict_of(OVER, { route: 'route:review-cap', is_over_cap: false })).toBe(
			issue_wip.HELD,
		)
	})

	it.each(['route:tier-a', 'route:split', 'route:interrupt'])('exempts %s', (route) => {
		expect(issue_wip.verdict_of(OVER, { route, is_over_cap: false })).toBe('exempt')
	})

	it('exempts a filing declared with --over-cap', () => {
		expect(issue_wip.verdict_of(OVER, { route: undefined, is_over_cap: true })).toBe('exempt')
	})
})

describe('issue_wip.count_line and count_of', () => {
	it('prints the count, the repository, the cap and the verdict', () => {
		expect(issue_wip.count_line(OVER, REPO, issue_wip.HELD)).toBe(
			`wip: ${String(OVER)} open in ${REPO} · cap ${String(CAP)} · held`,
		)
	})

	it('counts the rows of a listing', () => {
		expect(issue_wip.count_of('[{"number":1},{"number":2}]')).toBe(2)
	})

	it.each(['{}', 'not json'])('reads %j as unreadable rather than zero', (json) => {
		expect(issue_wip.count_of(json)).toBeUndefined()
	})
})

describe('issue_wip.HELD_MESSAGE — the exemption question', () => {
	it.each([
		'close one first',
		'nothing honestly closable means do not file',
		'a verification answers wrongly',
		'a documented workflow cannot complete',
		'data is lost or written outside the repository',
		'--route interrupt',
		'--over-cap',
		'prompts/collaboration-workflow/wip-cap.md',
	])('states %j', (marker) => {
		expect(issue_wip.HELD_MESSAGE).toContain(marker)
	})
})
