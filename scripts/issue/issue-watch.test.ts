import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { git_gh_conditional, type ConditionalRead } from '#scripts/gh/git-gh-conditional'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { issue_watch, type WatchRecord } from './issue-watch'

// joshuafolkken/kit#3773: the per-checkout record of what a run last read of its issue. The poll has
// to stay quiet inside its interval, keep an unread update across a 304, raise a new one, end with a
// closed issue; the acknowledgement has to move the baseline; and a baseline that could not be read
// must leave no record, or the whole issue would read as unread.
//
// The record is a real stamp keyed on a throwaway root, so the read/write round trip is exercised;
// only the two GitHub reads are stubbed.

const ISSUE = '3773'
const BODY = 'Acceptance criteria:\n- one'
const EDITED_BODY = 'Acceptance criteria:\n- two'
const ETAG = 'W/"first"'
const NEW_ETAG = 'W/"second"'
const COMMENT_ID = 7
const INTERVAL_MS = 180_000
const BASE_TIME = '2026-10-14T00:00:00.000Z'
const LATER_TIME = '2026-10-14T01:00:00.000Z'
const COMMENTS = JSON.stringify([{ id: COMMENT_ID, user: { login: 'person' }, body: 'hi' }])

const EARLIER_UPDATE = 'earlier update'

// A fresh root per case, and its record removed with it. A getter rather than the path: `beforeEach`
// assigns a new one per case, and a value captured at definition would be the previous case's.
function use_temporary_root(): () => string {
	let directory = ''

	beforeEach(() => {
		directory = mkdtempSync(path.join(tmpdir(), 'issue-watch-'))
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue(COMMENTS)
	})

	afterEach(() => {
		issue_watch.clear(directory)
		rmSync(directory, { recursive: true, force: true })
		vi.restoreAllMocks()
	})

	return () => directory
}

const root = use_temporary_root()

function changed(body: string, state = 'open'): ConditionalRead {
	return { kind: 'changed', etag: NEW_ETAG, body: JSON.stringify({ state, body }) }
}

function stub_issue(
	...reads: ReadonlyArray<ConditionalRead>
): MockInstance<typeof git_gh_conditional.read_conditional> {
	const spy = vi.spyOn(git_gh_conditional, 'read_conditional')

	for (const read of reads) spy.mockResolvedValueOnce(read)

	return spy
}

function seed(overrides: Partial<WatchRecord> = {}): void {
	const record: WatchRecord = {
		issue: ISSUE,
		body: BODY,
		last_comment_id: COMMENT_ID,
		acknowledged_at: BASE_TIME,
		checked_at: BASE_TIME,
		etag: ETAG,
		...overrides,
	}

	stamp_file.replace_stamp(issue_watch.record_path(root()), record)
}

async function poll_later(): Promise<WatchRecord | undefined> {
	return await issue_watch.poll({ interval_ms: INTERVAL_MS, now: new Date(LATER_TIME) }, root())
}

describe('issue_watch.record_baseline', () => {
	it('records the body, the newest comment id, the etag and the read time', async () => {
		stub_issue(changed(BODY))

		await expect(issue_watch.record_baseline(ISSUE, root(), new Date(BASE_TIME))).resolves.toBe(
			true,
		)
		expect(issue_watch.read_record(root())).toStrictEqual({
			issue: ISSUE,
			body: BODY,
			last_comment_id: COMMENT_ID,
			acknowledged_at: BASE_TIME,
			checked_at: BASE_TIME,
			etag: NEW_ETAG,
		})
	})

	it('returns false and writes nothing when the issue is unreadable', async () => {
		stub_issue({ kind: 'unreadable' })

		await expect(issue_watch.record_baseline(ISSUE, root())).resolves.toBe(false)
		expect(issue_watch.read_record(root())).toBeUndefined()
	})

	it('returns false when the comments cannot be read', async () => {
		stub_issue(changed(BODY))
		vi.mocked(git_gh_issue_read.issue_list_comments).mockResolvedValueOnce(undefined)

		await expect(issue_watch.record_baseline(ISSUE, root())).resolves.toBe(false)
		expect(issue_watch.read_record(root())).toBeUndefined()
	})
})

describe('issue_watch.poll', () => {
	it('answers undefined when no run recorded a baseline', async () => {
		await expect(poll_later()).resolves.toBeUndefined()
	})

	it('does not fetch within the interval', async () => {
		const spy = stub_issue()

		seed({ checked_at: LATER_TIME })

		await expect(poll_later()).resolves.toMatchObject({ checked_at: LATER_TIME })
		expect(spy).not.toHaveBeenCalled()
	})
})

describe('issue_watch.poll — a due poll', () => {
	it('sends the stored etag and sets pending on a change', async () => {
		const spy = stub_issue(changed(EDITED_BODY))

		seed()

		const record = await poll_later()

		expect(spy.mock.calls[0]?.[1]).toBe(ETAG)
		expect(record?.pending).toBe('Body edited:\n- - one\n+ - two')
		expect(issue_watch.read_record(root())).toMatchObject({
			etag: NEW_ETAG,
			checked_at: LATER_TIME,
		})
	})

	it('keeps the existing pending update on a 304', async () => {
		stub_issue({ kind: 'unchanged' })
		seed({ pending: EARLIER_UPDATE })

		await expect(poll_later()).resolves.toMatchObject({
			pending: EARLIER_UPDATE,
			checked_at: LATER_TIME,
		})
	})

	it('clears the record when the issue has closed', async () => {
		stub_issue(changed(BODY, 'closed'))
		seed()

		await expect(poll_later()).resolves.toBeUndefined()
		expect(issue_watch.read_record(root())).toBeUndefined()
	})
})

describe('issue_watch.mark_shown', () => {
	it('records the pending text as shown', () => {
		seed({ pending: 'update' })

		const record = issue_watch.read_record(root())

		expect(record && issue_watch.mark_shown(record, root()).shown).toBe('update')
		expect(issue_watch.read_record(root())?.shown).toBe('update')
	})
})

describe('issue_watch.acknowledge', () => {
	it('returns the diff, clears pending and advances the baseline and acknowledged_at', async () => {
		stub_issue(changed(EDITED_BODY))
		seed({ pending: 'stale', last_comment_id: 0 })

		const acknowledged = await issue_watch.acknowledge(root(), new Date(LATER_TIME))

		expect(acknowledged?.issue).toBe(ISSUE)
		expect(acknowledged?.diff).toContain('+ - two')
		expect(issue_watch.read_record(root())).toStrictEqual({
			issue: ISSUE,
			body: EDITED_BODY,
			last_comment_id: COMMENT_ID,
			acknowledged_at: LATER_TIME,
			checked_at: LATER_TIME,
			etag: NEW_ETAG,
		})
	})

	it('keeps acknowledged_at when there was nothing new', async () => {
		stub_issue(changed(BODY))
		seed()

		await expect(issue_watch.acknowledge(root(), new Date(LATER_TIME))).resolves.toStrictEqual({
			issue: ISSUE,
			diff: undefined,
		})
		expect(issue_watch.read_record(root())?.acknowledged_at).toBe(BASE_TIME)
	})

	it('answers undefined with no record or an unreadable issue', async () => {
		await expect(issue_watch.acknowledge(root())).resolves.toBeUndefined()

		stub_issue({ kind: 'unreadable' })
		seed({ pending: 'update' })

		await expect(issue_watch.acknowledge(root())).resolves.toBeUndefined()
		expect(issue_watch.read_record(root())?.pending).toBe('update')
	})
})
