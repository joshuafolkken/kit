import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { split_assess } from './split-assess'
import { split_early_notice } from './split-early-notice'
import { split_measure } from './split-measure'
import { split_resolution } from './split-resolution'

const { REASON_PREFIX } = split_assess

// joshuafolkken/kit#6212: only a filed split child answers the notice, never a reason comment.

const ISSUE = 4695
const OTHER_ISSUE = 4696
const AT = '2026-10-23T00:00:00.000Z'
const OWNER = 'OWNER'
const REASON = `${REASON_PREFIX} the rest shares one schema change`
const LEDGER_PATH = '/ledger.jsonl'
const NO_CHILD = 'has no split child'

const NOTICE: LedgerEntry = {
	kind: lane_ledger.KIND.SPLIT_NOTICE,
	at: AT,
	issue: ISSUE,
	files: 11,
	lines: 550,
}
const SPLIT_CHILD: LedgerEntry = {
	kind: lane_ledger.KIND.SPLIT_FILED,
	at: AT,
	issue: ISSUE,
	child: '#4700',
}

const list_comments = vi.spyOn(git_gh_issue_read, 'issue_list_comments')
const is_trusted = vi.spyOn(gh_author_association, 'is_trusted')
const record_split_filed = vi.spyOn(lane_ledger_write, 'record_split_filed')
const read_branch = vi.spyOn(split_measure, 'read_branch')
const declared = vi.spyOn(split_early_notice, 'declared')

function comments_json(body: string, association = OWNER): string {
	return JSON.stringify([{ user: { login: 'someone' }, body, author_association: association }])
}

beforeEach(() => {
	is_trusted.mockImplementation(async (author) => author.association === OWNER)
	list_comments.mockResolvedValue('[]')
	record_split_filed.mockResolvedValue()
	read_branch.mockResolvedValue({ files: 11, lines: 550, verdict: 'split' })
	declared.mockResolvedValue(undefined)
})

describe('split_resolution.refusal for a noticed issue with no answer', () => {
	it('names the counts, the stop, the split route and the command to rerun', async () => {
		const note = await split_resolution.refusal(ISSUE, [NOTICE])

		expect(note).toContain('11 file(s), 550 line(s)')
		expect(note).toContain('stop implementation, keep only the green part')
		expect(note).toContain(`pnpm josh issue:file --route split --found-during ${String(ISSUE)}`)
		expect(note).toContain(`pnpm josh run:cut ${String(ISSUE)}`)
	})

	it('refuses a reason from an untrusted author', async () => {
		list_comments.mockResolvedValue(comments_json(REASON, 'NONE'))

		expect(await split_resolution.refusal(ISSUE, [NOTICE])).toBeDefined()
	})

	it('refuses a reason line with no reason after it', async () => {
		list_comments.mockResolvedValue(comments_json(`${REASON_PREFIX}   `))

		expect(await split_resolution.refusal(ISSUE, [NOTICE])).toBeDefined()
	})

	it('refuses without reading unavailable comments', async () => {
		list_comments.mockResolvedValue(undefined)

		expect(await split_resolution.refusal(ISSUE, [NOTICE])).toContain(NO_CHILD)
		expect(list_comments).not.toHaveBeenCalled()
	})
})

describe('split_resolution.refusal for an answered or unnoticed issue', () => {
	it('passes an issue the notice never reached without reading its comments', async () => {
		const notice_elsewhere = { ...NOTICE, issue: OTHER_ISSUE }

		expect(await split_resolution.refusal(ISSUE, [notice_elsewhere])).toBeUndefined()
		expect(list_comments).not.toHaveBeenCalled()
	})

	it('passes an issue whose lane filed a split child', async () => {
		expect(await split_resolution.refusal(ISSUE, [NOTICE, SPLIT_CHILD])).toBeUndefined()
	})

	it('refuses a trusted reason comment without a split child (ac-cb274576)', async () => {
		list_comments.mockResolvedValue(comments_json(`Stays one Issue.\n${REASON}`))

		expect(await split_resolution.refusal(ISSUE, [NOTICE])).toBeDefined()
		expect(list_comments).not.toHaveBeenCalled()
		expect(is_trusted).not.toHaveBeenCalled()
	})
})

describe('split_resolution.ledger_refusal', () => {
	it('passes a stale notice when the current diff is below the bar (ac-92ff3c54)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		read_branch.mockResolvedValueOnce({ files: 4, lines: 164, verdict: 'single' })

		expect(await split_resolution.ledger_refusal(ISSUE)).toBeUndefined()
	})

	it('keeps the notice when measurement fails (ac-993a6e83)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		read_branch.mockRejectedValueOnce(new Error('unmeasurable'))

		expect(await split_resolution.ledger_refusal(ISSUE)).toContain(NO_CHILD)
	})

	it('keeps the declaration bar for a smaller current diff (ac-993a6e83)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		read_branch.mockResolvedValueOnce({ files: 3, lines: 150, verdict: 'single' })
		declared.mockResolvedValueOnce({ files: 2, lines: 50 })

		expect(await split_resolution.ledger_refusal(ISSUE)).toContain(NO_CHILD)
	})

	it('reads the repository ledger', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])

		expect(await split_resolution.ledger_refusal(ISSUE)).toBeDefined()
	})

	it('refuses nothing outside a repository', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(undefined)

		expect(await split_resolution.ledger_refusal(ISSUE)).toBeUndefined()
	})
})

describe('split_resolution.record_child', () => {
	it('reports the existing child URL and a recovery command when recording fails', async () => {
		const child = 'https://github.com/joshuafolkken/kit/issues/4700'

		record_split_filed.mockRejectedValueOnce(new Error('append failed'))

		await expect(
			split_resolution.record_child({
				route: SPLIT_ROUTE_LABEL,
				found_during: String(ISSUE),
				child,
			}),
		).rejects.toThrow(`pnpm josh split:recover ${String(ISSUE)} ${child}`)
	})

	it('records a split child against the lane it was found in', async () => {
		const filing = { route: SPLIT_ROUTE_LABEL, found_during: String(ISSUE), child: '#4700' }

		await split_resolution.record_child(filing)

		expect(record_split_filed).toHaveBeenCalledExactlyOnceWith({ issue: ISSUE, child: '#4700' })
	})

	it('records nothing for another route or a filing found in no lane', async () => {
		await split_resolution.record_child({ route: 'route:bug', found_during: '1', child: '#1' })
		await split_resolution.record_child({
			route: SPLIT_ROUTE_LABEL,
			found_during: undefined,
			child: '#1',
		})

		expect(record_split_filed).not.toHaveBeenCalled()
	})
})
