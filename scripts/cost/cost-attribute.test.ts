import { describe, expect, it } from 'vitest'
import { cost_attribute } from './cost-attribute'
import { cost_usage, type UsageRecord } from './cost-usage'

const ISSUE_BRANCH = '962-report-the-token-and-credit-cost-of-a-run'
const NEXT_BRANCH = '963-single-source-the-three-ai-documents'

function record(branch: string, request_id = branch): UsageRecord {
	return { request_id, model: 'claude-opus-5', branch, totals: cost_usage.EMPTY_TOTALS }
}

describe('cost_attribute.issue_from_branch', () => {
	it('reads the issue number a josh branch starts with', () => {
		expect(cost_attribute.issue_from_branch(ISSUE_BRANCH)).toBe(962)
	})

	it('reads no issue from the default branch', () => {
		expect(cost_attribute.issue_from_branch('main')).toBe(cost_attribute.UNATTRIBUTED_KEY)
	})

	it('reads no issue from a branch that merely contains digits', () => {
		expect(cost_attribute.issue_from_branch('feature-962-thing')).toBe(
			cost_attribute.UNATTRIBUTED_KEY,
		)
	})
})

describe('cost_attribute.attribute', () => {
	// A child is implemented on the default branch — `josh git` only creates the branch at commit
	// time — so the requests that did the work were made before the branch existed.
	it('attributes work done on the default branch to the issue branch that follows it', () => {
		const attributed = cost_attribute.attribute([
			record('main', 'a'),
			record('main', 'b'),
			record(ISSUE_BRANCH),
		])

		expect(attributed).toStrictEqual([962, 962, 962])
	})

	it('attributes the tail after a merge to the issue that preceded it', () => {
		const attributed = cost_attribute.attribute([record(ISSUE_BRANCH), record('main', 'after')])

		expect(attributed).toStrictEqual([962, 962])
	})

	it('splits a session that ran two issues at the boundary', () => {
		const attributed = cost_attribute.attribute([
			record('main', 'pre-962'),
			record(ISSUE_BRANCH),
			record('main', 'between'),
			record(NEXT_BRANCH),
		])

		expect(attributed).toStrictEqual([962, 962, 963, 963])
	})

	it('leaves a session that never touched an issue branch unattributed', () => {
		expect(cost_attribute.attribute([record('main', 'a')])).toStrictEqual([
			cost_attribute.UNATTRIBUTED_KEY,
		])
	})
})

describe('cost_attribute.group_by_issue', () => {
	it('buckets the records by issue in number order', () => {
		const groups = cost_attribute.group_by_issue([record(NEXT_BRANCH), record(ISSUE_BRANCH)])

		expect(groups.map((group) => group.issue)).toStrictEqual([962, 963])
	})

	it('keeps unattributed records as their own bucket', () => {
		const groups = cost_attribute.group_by_issue([record('main', 'a')])

		expect(groups).toHaveLength(1)
		expect(groups[0]?.issue).toBe(cost_attribute.UNATTRIBUTED_KEY)
	})
})

describe('cost_attribute.records_for_issue', () => {
	it('returns every record the issue is charged for', () => {
		const records = cost_attribute.records_for_issue(
			[record('main', 'pre'), record(ISSUE_BRANCH), record(NEXT_BRANCH)],
			962,
		)

		expect(records.map((entry) => entry.request_id)).toStrictEqual(['pre', ISSUE_BRANCH])
	})

	// `josh time` attributes timed spans through this same walk (joshuafolkken/kit#1268). The
	// alternative was a second copy of the fill-forward rule over a different element type, and the
	// drift between the two would make `josh cost --issue` and `josh time --issue` disagree about
	// which issue a run belonged to.
	it('attributes anything carrying a branch, not only a usage record', () => {
		const spans = [
			{ branch: 'main', tag: 'pre' },
			{ branch: ISSUE_BRANCH, tag: 'on-branch' },
			{ branch: NEXT_BRANCH, tag: 'after' },
		]

		expect(cost_attribute.records_for_issue(spans, 962).map((span) => span.tag)).toStrictEqual([
			'pre',
			'on-branch',
		])
	})
})
