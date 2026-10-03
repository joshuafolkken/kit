import { git_gh_command } from '#scripts/git/git-gh-command'
import type { IssueListOutcome } from '#scripts/git/git-gh-issue-list'
import {
	capped_listing_outcome,
	listing_of,
	listing_outcome,
} from '#scripts/git/git-gh-issue-list-fixture'
import { EPIC_LABEL } from '#scripts/git/issue-labels'
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { issue_scout_closed } from './issue-scout-closed'

// Pins the closed half of `issue:scout`'s duplicate scan (joshuafolkken/kit#1679) on its own.

const CLOSED_LIMIT = 100
const PLAIN_NUMBER = 41
const EPIC_NUMBER = 42
const UNTITLED_NUMBER = 43
const PLAIN_TITLE = 'Trim the README to an overview and links'
const EPIC_TITLE = 'Make an epic runnable without a person watching'

afterEach(() => {
	vi.restoreAllMocks()
})

// `gh` writes a missing title as JSON `null`, which the schema maps to an empty title.
const UNTITLED_ROW_JSON = `[{"number":${String(UNTITLED_NUMBER)},"title":null}]`

function stub_listing(outcome: IssueListOutcome): MockInstance {
	return vi.spyOn(git_gh_command, 'issue_list_recently_closed').mockResolvedValue(outcome)
}

function silence_errors(): MockInstance {
	return vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

describe('issue_scout_closed.read_recently_closed', () => {
	it('asks for one window of the most recently closed issues', async () => {
		const listing = stub_listing(listing_of([]))

		await issue_scout_closed.read_recently_closed()

		expect(listing).toHaveBeenCalledWith(CLOSED_LIMIT)
	})

	it('maps each row to a closed scout issue and marks a closed epic', async () => {
		stub_listing(
			listing_of([
				{ number: PLAIN_NUMBER, title: PLAIN_TITLE, labels: [{ name: 'bug' }] },
				{ number: EPIC_NUMBER, title: EPIC_TITLE, labels: [{ name: EPIC_LABEL.toUpperCase() }] },
			]),
		)

		expect(await issue_scout_closed.read_recently_closed()).toStrictEqual({
			rows: [
				{ number: PLAIN_NUMBER, title: PLAIN_TITLE, is_closed: true, is_epic: false },
				{ number: EPIC_NUMBER, title: EPIC_TITLE, is_closed: true, is_epic: true },
			],
			is_capped: false,
		})
	})

	it('reads a null title as an empty one', async () => {
		stub_listing(listing_outcome(UNTITLED_ROW_JSON))

		const scan = await issue_scout_closed.read_recently_closed()

		expect(scan.rows).toStrictEqual([
			{ number: UNTITLED_NUMBER, title: '', is_closed: true, is_epic: false },
		])
	})
})

describe('issue_scout_closed.read_recently_closed — gaps', () => {
	it('answers undefined rows, never an empty list, when the listing failed', async () => {
		stub_listing(listing_outcome(undefined))

		expect(await issue_scout_closed.read_recently_closed()).toStrictEqual({
			rows: undefined,
			is_capped: false,
		})
	})

	it('answers undefined rows when the output is not a JSON array', async () => {
		stub_listing(listing_outcome('{"message":"API rate limit exceeded"}'))

		const scan = await issue_scout_closed.read_recently_closed()

		expect(scan.rows).toBeUndefined()
	})

	it('carries the page ceiling through beside the rows', async () => {
		stub_listing(capped_listing_outcome('[]'))

		expect(await issue_scout_closed.read_recently_closed()).toStrictEqual({
			rows: [],
			is_capped: true,
		})
	})
})

describe('issue_scout_closed.warn_about_closed', () => {
	it('reports an unreadable listing and nothing else', () => {
		const error = silence_errors()

		issue_scout_closed.warn_about_closed({ rows: undefined, is_capped: true })

		expect(error.mock.calls).toStrictEqual([[issue_scout_closed.CLOSED_UNREADABLE_LINE]])
	})

	it('reports the page ceiling when the rows were read but capped', () => {
		const error = silence_errors()

		issue_scout_closed.warn_about_closed({ rows: [], is_capped: true })

		expect(error.mock.calls).toStrictEqual([[issue_scout_closed.CLOSED_CEILING_LINE]])
	})

	it('says nothing on an ordinary read', () => {
		const error = silence_errors()

		issue_scout_closed.warn_about_closed({ rows: [], is_capped: false })

		expect(error).not.toHaveBeenCalled()
	})
})
