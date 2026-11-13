import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_issue_memo } from '#scripts/gh/git-gh-issue-memo'
import { afterEach, expect, it, vi } from 'vitest'
import { epic_live } from './epic-live'

const REPO = 'joshuafolkken/kit'
const NUMBER = 7427
const BLOCKER = 7422

afterEach(() => vi.restoreAllMocks())

it('revalidates issue fields on every call despite a stale process memo', async () => {
	const memo = vi.spyOn(git_gh_issue_memo, 'read').mockRejectedValue(new Error('stale memo'))
	const read = vi.spyOn(git_gh_etag_read, 'read')

	read.mockResolvedValueOnce(
		JSON.stringify({ number: NUMBER, state: 'open', body: '', labels: [] }),
	)
	read.mockResolvedValueOnce(
		JSON.stringify({ number: NUMBER, state: 'closed', body: '', labels: [] }),
	)
	const first = await epic_live.child(NUMBER, REPO)
	const second = await epic_live.child(NUMBER, REPO)

	expect([first.state, second.state]).toEqual(['OPEN', 'CLOSED'])
	expect(read).toHaveBeenCalledTimes(2)
	expect(memo).not.toHaveBeenCalled()
})

it('reads the native listing even when the issue summary says zero', async () => {
	const listing = vi
		.spyOn(git_gh_etag_read, 'read_listing')
		.mockResolvedValue(
			JSON.stringify([
				{ number: BLOCKER, state: 'open', repository_url: `https://api.github.com/repos/${REPO}` },
			]),
		)

	expect(await epic_live.blockers(NUMBER, REPO)).toMatchObject([{ number: BLOCKER, repo: REPO }])
	expect(listing).toHaveBeenCalledExactlyOnceWith(
		`repos/${REPO}/issues/${String(NUMBER)}/dependencies/blocked_by?per_page=100`,
		100,
	)
})

it('does not turn a refused or malformed native read into an empty dependency set', async () => {
	const listing = vi
		.spyOn(git_gh_etag_read, 'read_listing')
		.mockRejectedValue(new Error('HTTP 404'))

	await expect(epic_live.blockers(NUMBER, REPO)).rejects.toThrow('HTTP 404')
	listing.mockResolvedValue('{}')
	await expect(epic_live.blockers(NUMBER, REPO)).rejects.toThrow()
})
