import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_declared_size } from '#scripts/issue/issue-declared-size'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { split_assess } from './split-assess'
import { split_measure } from './split-measure'
import { split_resolution } from './split-resolution'
import { split_verified_single } from './split-verified-single'

const { REASON_PREFIX } = split_assess

// joshuafolkken/kit#6212: only a filed split child answers the notice, never a reason comment.

const ISSUE = 4695
const OTHER_ISSUE = 4696
const AT = '2026-10-23T00:00:00.000Z'
const OWNER = 'OWNER'
const REASON = `${REASON_PREFIX} the rest shares one schema change`
const LEDGER_PATH = '/ledger.jsonl'
const NO_CHILD = 'not a stop'
const APPEND_FAILED = 'append failed'
const FOLD_TARGET = '4701'

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
const declared = vi.spyOn(issue_declared_size, 'read')
const verified = vi.spyOn(split_verified_single, 'verified')

function comments_json(body: string, association = OWNER): string {
	return JSON.stringify([{ user: { login: 'someone' }, body, author_association: association }])
}

beforeEach(() => {
	is_trusted.mockImplementation(async (author) => author.association === OWNER)
	list_comments.mockResolvedValue('[]')
	record_split_filed.mockResolvedValue()
	read_branch.mockResolvedValue({ files: 11, lines: 550, verdict: 'split' })
	declared.mockResolvedValue(undefined)
	verified.mockResolvedValue(false)
})

describe('split_resolution.warning for a noticed issue with no answer', () => {
	it('names the counts as a warning and keeps a split only for an independent requirement', async () => {
		const note = await split_resolution.warning(ISSUE, [NOTICE])

		expect(note).toContain('11 file(s), 550 line(s)')
		expect(note).toContain('size warning')
		expect(note).not.toContain('stop implementation')
		expect(note).toContain('only for an independent added requirement')
		expect(note).toContain(`pnpm josh issue:file --route split --found-during ${String(ISSUE)}`)
	})

	it('warns on a reason from an untrusted author', async () => {
		list_comments.mockResolvedValue(comments_json(REASON, 'NONE'))

		expect(await split_resolution.warning(ISSUE, [NOTICE])).toBeDefined()
	})

	it('warns on a reason line with no reason after it', async () => {
		list_comments.mockResolvedValue(comments_json(`${REASON_PREFIX}   `))

		expect(await split_resolution.warning(ISSUE, [NOTICE])).toBeDefined()
	})

	it('warns without reading unavailable comments', async () => {
		list_comments.mockResolvedValue(undefined)

		expect(await split_resolution.warning(ISSUE, [NOTICE])).toContain(NO_CHILD)
		expect(list_comments).not.toHaveBeenCalled()
	})
})

describe('split_resolution.warning for an answered or unnoticed issue', () => {
	it('passes an issue the notice never reached without reading its comments', async () => {
		const notice_elsewhere = { ...NOTICE, issue: OTHER_ISSUE }

		expect(await split_resolution.warning(ISSUE, [notice_elsewhere])).toBeUndefined()
		expect(list_comments).not.toHaveBeenCalled()
	})

	it('passes an issue whose lane filed a split child', async () => {
		expect(await split_resolution.warning(ISSUE, [NOTICE, SPLIT_CHILD])).toBeUndefined()
	})

	it('warns on a trusted reason comment without a split child (ac-cb274576)', async () => {
		list_comments.mockResolvedValue(comments_json(`Stays one Issue.\n${REASON}`))

		expect(await split_resolution.warning(ISSUE, [NOTICE])).toBeDefined()
		expect(list_comments).not.toHaveBeenCalled()
		expect(is_trusted).not.toHaveBeenCalled()
	})
})

describe('split_resolution.ledger_warning measured guide', () => {
	it('keeps a notice above the attached measured guide (ac-9e07d12c)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		const guide = split_assess.guide_for(12, { median: 24, lanes: 1 })

		read_branch.mockResolvedValueOnce(split_assess.assess('201\t0\tscripts/a.ts', guide))

		expect(await split_resolution.ledger_warning(ISSUE)).toContain(NO_CHILD)
	})
})

describe('split_resolution.ledger_warning', () => {
	it('passes a stale notice when the current diff is below the bar (ac-92ff3c54)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		read_branch.mockResolvedValueOnce({ files: 4, lines: 164, verdict: 'single' })

		expect(await split_resolution.ledger_warning(ISSUE)).toBeUndefined()
	})

	it('keeps the notice when measurement fails (ac-993a6e83)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		read_branch.mockRejectedValueOnce(new Error('unmeasurable'))

		expect(await split_resolution.ledger_warning(ISSUE)).toContain(NO_CHILD)
	})

	it('keeps the declaration bar for a smaller current diff (ac-993a6e83)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		read_branch.mockResolvedValueOnce({ files: 3, lines: 150, verdict: 'single' })
		declared.mockResolvedValueOnce({ files: 2, lines: 50 })

		expect(await split_resolution.ledger_warning(ISSUE)).toContain(NO_CHILD)
		expect(declared).toHaveBeenCalledWith(String(ISSUE))
	})

	it('falls back to the guide when the declaration cannot be read', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		read_branch.mockResolvedValueOnce({ files: 3, lines: 150, verdict: 'single' })
		declared.mockRejectedValueOnce(new Error('issue body: unreadable'))

		expect(await split_resolution.ledger_warning(ISSUE)).toBeUndefined()
	})
})

describe('split_resolution.ledger_warning verified single deliverable', () => {
	it('answers a notice over the bar with one verified deliverable (ac-8e54309c)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])
		verified.mockResolvedValueOnce(true)

		expect(await split_resolution.ledger_warning(ISSUE)).toBeUndefined()
		expect(verified).toHaveBeenCalledWith(ISSUE)
	})

	it('keeps the notice over the bar while work is unverified (ac-30747931)', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])

		expect(await split_resolution.ledger_warning(ISSUE)).toContain(NO_CHILD)
		expect(verified).toHaveBeenCalledWith(ISSUE)
	})
})

describe('split_resolution.ledger_warning ledger reads', () => {
	it('reads the repository ledger', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(LEDGER_PATH)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])

		expect(await split_resolution.ledger_warning(ISSUE)).toBeDefined()
	})

	it('warns nothing outside a repository', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(undefined)

		expect(await split_resolution.ledger_warning(ISSUE)).toBeUndefined()
	})
})

describe('split_resolution.record_child', () => {
	it('reports the existing child URL and a recovery command when recording fails', async () => {
		const child = 'https://github.com/joshuafolkken/kit/issues/4700'

		record_split_filed.mockRejectedValueOnce(new Error(APPEND_FAILED))

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

// joshuafolkken/kit#6630: a split part folded into an existing Issue answers the notice.
describe('split_resolution.record_fold', () => {
	const fold = { origin: String(ISSUE), target: FOLD_TARGET }

	it('records the fold target as the origin lane split child', async () => {
		await split_resolution.record_fold(fold)

		expect(record_split_filed).toHaveBeenCalledExactlyOnceWith({
			issue: ISSUE,
			child: `#${FOLD_TARGET}`,
		})
	})

	it('lets the recorded fold answer the notice while an unanswered notice still warns', async () => {
		await split_resolution.record_fold(fold)
		const recorded = record_split_filed.mock.calls[0]?.[0] ?? { issue: OTHER_ISSUE, child: '' }
		const entry: LedgerEntry = { kind: lane_ledger.KIND.SPLIT_FILED, at: AT, ...recorded }

		expect(await split_resolution.warning(ISSUE, [NOTICE, entry])).toBeUndefined()
		expect(await split_resolution.warning(ISSUE, [NOTICE])).toContain(NO_CHILD)
	})

	it('names the folded issue and the cause when recording fails', async () => {
		record_split_filed.mockRejectedValueOnce(new Error(APPEND_FAILED))

		await expect(split_resolution.record_fold(fold)).rejects.toThrow(
			new RegExp(`Folded into .*${FOLD_TARGET}.*${APPEND_FAILED}`, 'u'),
		)
	})
})
