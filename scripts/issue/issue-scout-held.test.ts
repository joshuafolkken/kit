import { git_gh_command } from '#scripts/gh/git-gh-command'
import { stub_unanswered_batch } from '#scripts/gh/git-gh-issue-batch-graphql-fixture'
import { listing_of } from '#scripts/gh/git-gh-issue-list-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#7029: which candidates hold a filing. A cited issue is shown whatever its title,
// but only a title match holds `issue:file` until `--distinct` names it.

const REPO = 'joshuafolkken/kit'
const DRAFT_TITLE = 'Answer whether a new Issue already exists and which epic it belongs to'
const NEAR_DUPLICATE_TITLE = 'Answer whether a new Issue already exists before filing it'
const UNRELATED_TITLE = 'Stop a stalled push hanging josh git with no timeout or keepalive'
const NEAR_DUPLICATE_NUMBER = 1249
const UNRELATED_NUMBER = 1251

function cited_draft(number: number): { title: string; body: string } {
	return { title: DRAFT_TITLE, body: `## 背景\n\nsee #${String(number)}\n` }
}

beforeEach(() => {
	stub_unanswered_batch()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'issue_list_by_label').mockResolvedValue(listing_of([]))
	vi.spyOn(git_gh_command, 'issue_list_recently_closed').mockResolvedValue(listing_of([]))
	vi.spyOn(git_gh_command, 'issue_list_open_bodies').mockResolvedValue(
		listing_of([
			{ number: UNRELATED_NUMBER, title: UNRELATED_TITLE, body: '' },
			{ number: NEAR_DUPLICATE_NUMBER, title: NEAR_DUPLICATE_TITLE, body: '' },
		]),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('issue_scout_cli.scout — the candidates that hold a filing', () => {
	it('shows a cited issue with an unrelated title but does not hold the filing on it', async () => {
		const outcome = await issue_scout_cli.scout(cited_draft(UNRELATED_NUMBER), REPO)

		expect(outcome?.report).toContain(`#${String(UNRELATED_NUMBER)}`)
		expect(outcome?.candidates).toStrictEqual([NEAR_DUPLICATE_NUMBER])
	})

	it('holds the filing on a cited issue whose title matches', async () => {
		const outcome = await issue_scout_cli.scout(cited_draft(NEAR_DUPLICATE_NUMBER), REPO)

		expect(outcome?.candidates).toStrictEqual([NEAR_DUPLICATE_NUMBER])
	})

	it('prints the score beside `ref` for a cited title match only', async () => {
		const outcome = await issue_scout_cli.scout(cited_draft(NEAR_DUPLICATE_NUMBER), REPO)

		expect(outcome?.report).toMatch(/#1249\]\([^)]*\) {2}ref 0\.\d\d/u)
	})
})
