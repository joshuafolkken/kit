import { epic_bundle_fixture } from '#scripts/epic/epic-bundle-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { stub_unanswered_batch } from '#scripts/gh/git-gh-issue-batch-graphql-fixture'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#6008: the scout reads the open listing for issues declaring the draft's
// measurement, and only that listing — a closed issue the draft cites is widened into the duplicate
// search but never holds a filing as a measurement twin.

const REPO = 'joshuafolkken/kit'
const OPEN_TWIN = 5978
const CLOSED_TWIN = 5963
const DECLARED = '- 計測宣言: `pnpm josh cost:audit --density --period 7` >= 1.47'
const TWIN_BODY = `## 背景\n\n${DECLARED}\n`

function draft_of(citation: string): { title: string; body: string } {
	const body = `${TWIN_BODY}\n${epic_bundle_fixture.in_acceptance(citation)}\n`

	return { title: 'Measure the density after the change', body }
}

function closed_read(number: number): string {
	return JSON.stringify({
		number,
		title: 'Measure the density after an earlier change',
		body: TWIN_BODY,
		state: 'CLOSED',
		url: `https://github.com/${REPO}/issues/${String(number)}`,
		labels: [],
	})
}

beforeEach(() => {
	stub_unanswered_batch()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_of([]))
	vi.spyOn(git_gh_command, 'issue_list_recently_closed').mockResolvedValue(listing_of([]))
	vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(
		listing_of([{ number: OPEN_TWIN, title: 'Measure the density', body: TWIN_BODY }]),
	)
	vi.spyOn(git_gh_command, 'issue_get_plan_fields_classified').mockResolvedValue({
		kind: 'read',
		json: closed_read(CLOSED_TWIN),
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_scout_cli.scout — measurement twins', () => {
	it('names the open issue declaring the same measurement', async () => {
		const outcome = await issue_scout_cli.scout(draft_of('none'), REPO)

		expect(outcome?.measure_twins).toStrictEqual([OPEN_TWIN])
	})

	it('leaves out a closed issue the draft cites with the same declaration', async () => {
		const outcome = await issue_scout_cli.scout(draft_of(`after #${String(CLOSED_TWIN)}`), REPO)

		expect(git_gh_command.issue_get_plan_fields_classified).toHaveBeenCalled()
		expect(outcome?.measure_twins).toStrictEqual([OPEN_TWIN])
	})
})
