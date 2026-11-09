import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { INTERRUPT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_ledger_issues } from './hook-ledger-issues'

// joshuafolkken/kit#6664: the `route:interrupt` Issues, open and closed, filed since the period's start;
// an unreadable listing stays `undefined` so the column prints `unknown`, not 0.

const START = Date.parse('2026-11-02T12:00:00.000Z')

afterEach(() => {
	vi.restoreAllMocks()
})

function listing(by_state: Readonly<Record<string, string | undefined>>, is_capped = false): void {
	vi.spyOn(git_gh_issue_list, 'issue_list').mockImplementation(async (request) => {
		const json = by_state[request.state ?? 'open']

		return await { json, is_capped }
	})
}

describe('hook_ledger_issues.read', () => {
	it('reads both states under the interrupt label and cuts the Issues filed before the period', async () => {
		listing({
			open: JSON.stringify([{ body: '⛔ batch: refused', createdAt: '2026-11-03T00:00:00.000Z' }]),
			// REST answers a body-less Issue with JSON null.
			closed: `[{"body":null,"createdAt":"2026-11-04T00:00:00.000Z"},${JSON.stringify({ body: 'batch', createdAt: '2026-10-01T00:00:00.000Z' })}]`,
		})
		const issues = await hook_ledger_issues.read(START)

		expect(issues).toHaveLength(2)
		expect(hook_ledger_issues.count('batch', issues)).toBe(1)
		expect(git_gh_issue_list.issue_list).toHaveBeenCalledWith(
			expect.objectContaining({ label: INTERRUPT_ROUTE_LABEL, state: 'closed' }),
		)
	})

	it('reads an unreadable listing as undefined, which counts as unknown', async () => {
		listing({ open: '[]', closed: undefined })
		const issues = await hook_ledger_issues.read(START)

		expect(issues).toBeUndefined()
		expect(hook_ledger_issues.count('batch', issues)).toBeUndefined()
	})

	it('reads a capped listing as undefined, since its count would be short', async () => {
		listing({ open: '[]', closed: '[]' }, true)

		expect(await hook_ledger_issues.read(START)).toBeUndefined()
	})
})

describe('hook_ledger_issues.count', () => {
	it('counts a rule quoted as a refusal or in backticks, not the same word in prose', () => {
		const issues = [
			{ body: '⛔ investigation: 3 files read', createdAt: '' },
			{ body: 'the `investigation` guard', createdAt: '' },
			{ body: 'the investigation showed nothing', createdAt: '' },
		]

		expect(hook_ledger_issues.count('investigation', issues)).toBe(2)
	})

	it('does not count a rule from another rule it opens', () => {
		const issues = [{ body: '⛔ batching: 1.19 calls per round trip', createdAt: '' }]

		expect(hook_ledger_issues.count('batch', issues)).toBe(0)
	})
})
