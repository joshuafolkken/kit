import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { split_assess } from './split-assess'
import { split_resolution } from './split-resolution'

const { REASON_PREFIX } = split_assess

// joshuafolkken/kit#4695: a lane the split notice reached is refused before the gate until it either
// filed a split child or recorded, in a trusted Issue comment, why it stays one Issue.

const ISSUE = 4695
const OTHER_ISSUE = 4696
const AT = '2026-10-23T00:00:00.000Z'
const OWNER = 'OWNER'
const REASON = `${REASON_PREFIX} the rest shares one schema change`

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
const record_split_filed = vi.spyOn(lane_ledger, 'record_split_filed')

function comments_json(body: string, association = OWNER): string {
	return JSON.stringify([{ user: { login: 'someone' }, body, author_association: association }])
}

beforeEach(() => {
	vi.clearAllMocks()
	is_trusted.mockImplementation(async (author) => author.association === OWNER)
	list_comments.mockResolvedValue('[]')
	record_split_filed.mockResolvedValue()
})

describe('split_resolution.refusal for a noticed issue with no answer', () => {
	it('names the counts, the reason line, the split route and the command to rerun', async () => {
		const note = await split_resolution.refusal(ISSUE, [NOTICE])

		expect(note).toContain('11 file(s), 550 line(s)')
		expect(note).toContain(REASON_PREFIX)
		expect(note).toContain('pnpm josh issue:file --route split')
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

	it('refuses, saying so, when the comments cannot be read', async () => {
		list_comments.mockResolvedValue(undefined)

		expect(await split_resolution.refusal(ISSUE, [NOTICE])).toContain('could not be read')
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

	it('passes an issue with a trusted comment carrying the reason line', async () => {
		list_comments.mockResolvedValue(comments_json(`Stays one Issue.\n${REASON}`))

		expect(await split_resolution.refusal(ISSUE, [NOTICE])).toBeUndefined()
	})
})

describe('split_resolution.ledger_refusal', () => {
	it('reads the repository ledger', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce('/ledger.jsonl')
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValueOnce([NOTICE])

		expect(await split_resolution.ledger_refusal(ISSUE)).toBeDefined()
	})

	it('refuses nothing outside a repository', async () => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValueOnce(undefined)

		expect(await split_resolution.ledger_refusal(ISSUE)).toBeUndefined()
	})
})

describe('split_resolution.record_child', () => {
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
