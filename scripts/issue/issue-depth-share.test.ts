import {
	DEPTH_0_LABEL,
	DEPTH_1_LABEL,
	DEPTH_2_LABEL,
	depth_label_of,
	EPIC_LABEL,
	INTERRUPT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
} from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import { issue_depth_fixture } from './issue-depth-fixture'
import { issue_depth_share, type DepthCountable } from './issue-depth-share'

const { labelled } = issue_depth_fixture

describe('depth_label_of', () => {
	it('returns the depth label an issue carries', () => {
		expect(depth_label_of(labelled(DEPTH_1_LABEL).labels)).toBe(DEPTH_1_LABEL)
	})

	it('returns undefined when the issue carries no depth label', () => {
		expect(depth_label_of(labelled(EPIC_LABEL).labels)).toBeUndefined()
	})

	it('returns undefined when the issue has no labels at all', () => {
		expect(depth_label_of(undefined)).toBeUndefined()
	})

	it('takes the lowest depth when more than one is present', () => {
		expect(depth_label_of(labelled(DEPTH_2_LABEL, DEPTH_0_LABEL).labels)).toBe(DEPTH_0_LABEL)
	})

	it('matches a label GitHub kept in another casing', () => {
		expect(depth_label_of(labelled('Depth:0').labels)).toBe(DEPTH_0_LABEL)
	})
})

describe('issue_depth_share.summarize — the denominator', () => {
	it('excludes an epic from the denominator and counts it separately', () => {
		const share = issue_depth_share.summarize([labelled(EPIC_LABEL), labelled(DEPTH_0_LABEL)])

		expect(share.denominator).toBe(1)
		expect(share.epics_excluded).toBe(1)
	})

	it('counts a route:tier-a issue like any other', () => {
		const share = issue_depth_share.summarize([labelled(TIER_A_ROUTE_LABEL, DEPTH_1_LABEL)])

		expect(share.denominator).toBe(1)
		expect(share.depth_1).toBe(1)
	})

	it('counts a route:interrupt issue like any other', () => {
		const share = issue_depth_share.summarize([labelled(INTERRUPT_ROUTE_LABEL, DEPTH_0_LABEL)])

		expect(share.denominator).toBe(1)
		expect(share.depth_0).toBe(1)
	})

	it('keeps an unlabelled issue in the denominator and reports it', () => {
		const share = issue_depth_share.summarize([labelled(DEPTH_0_LABEL), labelled()])

		expect(share.denominator).toBe(2)
		expect(share.unlabelled).toBe(1)
		expect(share.share_percent).toBe(50)
	})

	it('reports zero percent for an empty backlog rather than dividing by zero', () => {
		expect(issue_depth_share.summarize([]).share_percent).toBe(0)
	})
})

const listing: ReadonlyArray<DepthCountable> = [
	labelled(EPIC_LABEL),
	labelled(DEPTH_0_LABEL),
	labelled(DEPTH_0_LABEL),
	labelled(DEPTH_0_LABEL),
	labelled(DEPTH_1_LABEL),
	labelled(DEPTH_1_LABEL),
	labelled(DEPTH_2_LABEL),
	labelled(),
]

describe('issue_depth_share.summarize — the figures', () => {
	it('tallies every depth against the non-epic denominator', () => {
		expect(issue_depth_share.summarize(listing)).toStrictEqual({
			denominator: 7,
			depth_0: 3,
			depth_1: 2,
			depth_2: 1,
			unlabelled: 1,
			epics_excluded: 1,
			share_percent: 43,
		})
	})

	// The requirement joshuafolkken/kit#1729 was filed for: two hand counts of the same backlog
	// disagreed, so the measurement has to be a function of the listing and nothing else.
	it('answers identically when the same listing is measured twice', () => {
		expect(issue_depth_share.summarize(listing)).toStrictEqual(issue_depth_share.summarize(listing))
	})

	it('answers identically when the same listing arrives in another order', () => {
		expect(issue_depth_share.summarize(listing.toReversed())).toStrictEqual(
			issue_depth_share.summarize(listing),
		)
	})
})

describe('issue_depth_share — the printed forms', () => {
	it('names every figure in the breakdown line', () => {
		const line = issue_depth_share.format_breakdown(issue_depth_share.summarize(listing))

		expect(line).toContain('denominator 7 open issues')
		expect(line).toContain('epics excluded 1')
		expect(line).toContain(`${DEPTH_0_LABEL} 3`)
		expect(line).toContain('unlabelled 1')
	})

	it('prints the headline as the ratio and the percentage', () => {
		expect(issue_depth_share.format_headline(issue_depth_share.summarize(listing))).toBe(
			'3/7 = 43%',
		)
	})
})
