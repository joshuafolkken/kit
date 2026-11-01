import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_sinks_issues } from './lane-sinks-issues'

// joshuafolkken/kit#5711: the open Issues whose title names a `--sinks` stage, read in one listing.

const ISSUES = [
	{ number: 11, title: 'Shorten the Followup CI wait' },
	{ number: 12, title: 'Cache the josh gate checks' },
	{ number: 13, title: 'Split followup ci into two jobs' },
]

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_sinks_issues.cell', () => {
	it('lists each open Issue whose title names the stage, case-insensitively', () => {
		expect(lane_sinks_issues.cell('followup CI', ISSUES)).toBe('#11, #13')
	})

	it('prints none when no title names the stage', () => {
		expect(lane_sinks_issues.cell('implement', ISSUES)).toBe(lane_sinks_issues.NONE)
	})

	it('prints unread, not none, when the listing could not be read', () => {
		expect(lane_sinks_issues.cell('implement', undefined)).toBe(lane_sinks_issues.UNREAD)
	})
})

describe('lane_sinks_issues.read', () => {
	it('reads the number and title of the open Issues in one listing', async () => {
		const list = vi
			.spyOn(git_gh_issue_list, 'issue_list')
			.mockResolvedValue({ json: JSON.stringify(ISSUES), is_capped: false })

		await expect(lane_sinks_issues.read()).resolves.toStrictEqual(ISSUES)
		expect(list).toHaveBeenCalledOnce()
		expect(list.mock.calls[0]?.[0].json_fields).toBe('number,title')
	})

	it('answers undefined when the listing is unreadable', async () => {
		vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({
			json: undefined,
			is_capped: false,
		})

		await expect(lane_sinks_issues.read()).resolves.toBeUndefined()
	})
})
