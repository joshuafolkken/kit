import { backlog_triage_unblock } from '#scripts/backlog/backlog-triage-unblock'
import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_read } from '#scripts/issue/issue-read'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_fold } from './lane-fold'
import { lane_fold_prose } from './lane-fold-prose'
import { lane_withdraw, type WithdrawOutcome } from './lane-withdraw'

// Every side effect is spied on: the withdrawal, the comment reads and write, and the unblock.

const ISSUE = '7945'
const INTO = '7951'
const REASON = 'ships with the wiring'
const REQUEST = { issue: ISSUE, into: INTO, reason: REASON }
const STASH = `${ISSUE}: uncommitted work at lane withdraw`

const WITHDRAWN: WithdrawOutcome = {
	kind: 'withdrawn',
	by: 'person',
	reaped: 1,
	stash: STASH,
	is_noted: true,
	is_closed: false,
	lane: 'closed',
	residents: [],
}

const withdraw = vi.spyOn(lane_withdraw, 'withdraw')
const list_comments = vi.spyOn(git_gh_issue_read, 'issue_list_comments')
const parse_comments = vi.spyOn(issue_read, 'parse_comments')
const trusted_bodies = vi.spyOn(issue_read, 'trusted_bodies')
const comment = vi.spyOn(git_gh_issue_write, 'issue_comment')
const remove = vi.spyOn(backlog_triage_unblock, 'remove')
const record = vi.spyOn(epic_blocked_by, 'record')
const stash_list = vi.spyOn(git_stash, 'list')

// Each issue's trusted comment bodies, read through the spied listing.
function bodies(by_issue: Record<string, ReadonlyArray<string>>): void {
	list_comments.mockImplementation(async (issue) => await issue)
	parse_comments.mockImplementation(async (issue = '') => {
		const comments = (by_issue[issue] ?? []).map((body) => ({
			author: 'a',
			created_at: '',
			body,
			is_trusted: true,
		}))

		return await comments
	})
	trusted_bodies.mockImplementation((comments) => comments.map((item) => item.body))
}

beforeEach(() => {
	withdraw.mockResolvedValue(WITHDRAWN)
	comment.mockResolvedValue('url')
	remove.mockResolvedValue()
	record.mockResolvedValue('recorded')
	stash_list.mockResolvedValue([])
	bodies({})
})

describe('lane_fold.fold — every step', () => {
	it('withdraws, notes the taker with the stash, unblocks it and blocks the folded issue on it', async () => {
		const outcome = await lane_fold.fold(REQUEST)

		expect(outcome).toEqual({
			kind: 'folded',
			is_withdrawn: true,
			stash: STASH,
			is_noted: true,
			blocked: 'recorded',
		})
		expect(withdraw).toHaveBeenCalledWith(ISSUE, `ships with #${INTO}: ${REASON}`)
		expect(comment).toHaveBeenCalledWith(INTO, expect.stringContaining(`stash:pop "${STASH}"`))
		expect(remove).toHaveBeenCalledWith({ issue: INTO, prerequisite: ISSUE })
		expect(record).toHaveBeenCalledWith({ issue: ISSUE, prerequisite: INTO })
	})

	it('reads the stash back from the stash stack when the lane is already withdrawn', async () => {
		withdraw.mockResolvedValue({ kind: 'no-lane' })
		stash_list.mockResolvedValue([{ selector: 'stash@{2}', subject: `On ${ISSUE}-lane: ${STASH}` }])

		const outcome = await lane_fold.fold(REQUEST)

		expect(outcome).toMatchObject({ kind: 'folded', is_withdrawn: false, stash: STASH })
		expect(comment).toHaveBeenCalledWith(INTO, expect.stringContaining(STASH))
		expect(remove).toHaveBeenCalled()
	})
})

describe('lane_fold.fold — a re-run', () => {
	it('names no stash when the stack holds none for the folded issue', async () => {
		withdraw.mockResolvedValue({ kind: 'no-lane' })
		bodies({ [ISSUE]: [`- recover with \`pnpm josh stash:pop "${STASH}"\``] })

		expect(await lane_fold.fold(REQUEST)).toMatchObject({ kind: 'folded', stash: undefined })
	})

	it('goes on past an already-closed issue with no lane', async () => {
		withdraw.mockResolvedValue({ kind: 'closed' })

		expect(await lane_fold.fold(REQUEST)).toMatchObject({ kind: 'folded', is_withdrawn: false })
		expect(remove).toHaveBeenCalled()
		expect(record).toHaveBeenCalled()
	})

	it('reports a block an earlier run recorded as already', async () => {
		record.mockResolvedValue('already')

		expect(await lane_fold.fold(REQUEST)).toMatchObject({ kind: 'folded', blocked: 'already' })
	})

	it('writes no note when the taker already carries it', async () => {
		bodies({ [INTO]: [lane_fold_prose.comment(ISSUE, STASH, REASON)] })

		expect(await lane_fold.fold(REQUEST)).toMatchObject({ kind: 'folded', is_noted: false })
		expect(comment).not.toHaveBeenCalled()
		expect(remove).toHaveBeenCalled()
	})
})

describe('lane_fold.fold — a failed step', () => {
	it('stops at the withdrawal when the lane could not be withdrawn', async () => {
		withdraw.mockResolvedValue({ kind: 'unreadable' })

		expect(await lane_fold.fold(REQUEST)).toMatchObject({ kind: 'failed', step: 'withdraw' })
		expect(comment).not.toHaveBeenCalled()
	})

	it('names the note step when the comment write throws', async () => {
		comment.mockRejectedValue(new Error('boom'))

		const outcome = await lane_fold.fold(REQUEST)

		expect(outcome).toEqual({ kind: 'failed', step: 'note', message: 'boom' })
		expect(remove).not.toHaveBeenCalled()
	})

	it('names the unblock step when the unblock throws', async () => {
		remove.mockRejectedValue(new Error('not removed'))

		expect(await lane_fold.fold(REQUEST)).toMatchObject({ kind: 'failed', step: 'unblock' })
		expect(record).not.toHaveBeenCalled()
	})

	it('names the block step when recording the blocked-by throws', async () => {
		record.mockRejectedValue(new Error('not recorded'))

		expect(await lane_fold.fold(REQUEST)).toMatchObject({ kind: 'failed', step: 'block' })
	})
})
