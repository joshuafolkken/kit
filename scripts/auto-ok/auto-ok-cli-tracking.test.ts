import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import type { OpenListing } from '#scripts/git/git-schemas'
import { EPIC_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { auto_ok_cli } from './auto-ok-cli'
import { auto_ok_fixture, CREATED_EARLIER } from './auto-ok-fixture'

// joshuafolkken/kit#8220: a whole open listing the plan read already holds answers the epics, so the
// `epic` label listing is read only when that listing is cut or absent.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const epic_list = vi.mocked(git_gh_command.issue_list_by_label)
const { issue, epic_listing } = auto_ok_fixture
const EPIC = 800
const CHILD = 42
const OPEN: OpenListing = {
	rows: [{ ...issue(EPIC, CREATED_EARLIER, [EPIC_LABEL]), body: `- [ ] #${String(CHILD)}` }],
	is_capped: false,
}

beforeEach(() => {
	epic_list.mockReset()
	epic_list.mockResolvedValue(listing_outcome(epic_listing([{ number: EPIC, children: [CHILD] }])))
})

describe('auto_ok_cli.fetch_tracking with an open listing', () => {
	it('draws the tracking from a whole listing without reading the epic label', async () => {
		const tracking = await auto_ok_cli.fetch_tracking(1, OPEN)

		expect(tracking).toStrictEqual({
			kind: 'read',
			index: new Map([[CHILD, [EPIC]]]),
			cutoff: 'none',
		})
		expect(epic_list).not.toHaveBeenCalled()
	})

	it('falls back to the epic label listing when the open listing was cut', async () => {
		const tracking = await auto_ok_cli.fetch_tracking(1, { ...OPEN, is_capped: true })

		expect(tracking).toMatchObject({ kind: 'read', index: new Map([[CHILD, [EPIC]]]) })
		expect(epic_list).toHaveBeenCalledWith(EPIC_LABEL, auto_ok_cli.LISTING_LIMIT)
	})
})
