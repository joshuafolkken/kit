import { listing_of, listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import { AUTO_OK_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	auto_ok_judge_fixture,
	JUDGED_NUMBER,
	OPTED_IN_NUMBER,
	OWED_NUMBER,
	UNTRUSTED,
} from './auto-ok-judge-fixture'
import { auto_ok_judge_read } from './auto-ok-judge-read'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_list_open_for_judgement: vi.fn(),
		issue_list_comments: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const list_open = vi.mocked(git_gh_command.issue_list_open_for_judgement)
const list_comments = vi.mocked(git_gh_command.issue_list_comments)
const { row } = auto_ok_judge_fixture

beforeEach(() => {
	vi.clearAllMocks()
	list_open.mockResolvedValue(listing_outcome(undefined))
	list_comments.mockImplementation(async (issue) => auto_ok_judge_fixture.comments_of(issue))
})

describe('auto_ok_judge_read.owed', () => {
	it('keeps only the issues neither opted in nor already judged', async () => {
		list_open.mockResolvedValueOnce(
			listing_of([row(OWED_NUMBER), row(JUDGED_NUMBER), row(OPTED_IN_NUMBER, [AUTO_OK_LABEL])]),
		)

		const owed = await auto_ok_judge_read.owed()

		expect(owed?.map((owed_row) => owed_row.number)).toStrictEqual([OWED_NUMBER])
	})

	it('answers undefined when the listing cannot be read', async () => {
		expect(await auto_ok_judge_read.owed()).toBeUndefined()
	})

	it('skips the comment read of an issue judged at the same updatedAt', async () => {
		const cache = new Map<number, string>()

		list_open.mockResolvedValue(listing_of([row(JUDGED_NUMBER)]))
		await auto_ok_judge_read.owed(cache)
		await auto_ok_judge_read.owed(cache)

		expect(list_comments).toHaveBeenCalledTimes(1)
	})

	// joshuafolkken/kit#4021: on a public repository a third party can file an issue, and an issue
	// judged `auto-ok` is implemented and released unattended.
	it('never offers an issue filed by an author without write access', async () => {
		list_open.mockResolvedValueOnce(listing_of([row(OWED_NUMBER, [], UNTRUSTED)]))

		expect(await auto_ok_judge_read.owed()).toStrictEqual([])
		expect(list_comments).not.toHaveBeenCalled()
	})

	it('treats an issue with no author association as untrusted', async () => {
		list_open.mockResolvedValueOnce(
			listing_of([{ ...row(OWED_NUMBER), author_association: undefined }]),
		)

		expect(await auto_ok_judge_read.owed()).toStrictEqual([])
	})
})
