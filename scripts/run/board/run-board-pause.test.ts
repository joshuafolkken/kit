import { issue_outcome } from '#scripts/issue/issue-outcome'
import type { IssueComment } from '#scripts/issue/issue-read'
import { describe, expect, it } from 'vitest'
import { run_board_pause } from './run-board-pause'
import run_board_pause_fixture from './run-board-pause-fixture.json' with { type: 'json' }

const AT = '2026-11-12T09:00:00Z'
const BODY = '### 選択肢\n1. Wait\n   - 層: C\n   - 必要な権限: 人\n\n### 推奨\n1 safer\n'
const SIZE_REASON = 'Size approval or replan needed'
const APPROVAL_REASON = 'Approval needed'
const FIXTURES = [
	{ issue: 7387, comment: '6818874860', summary: 'Approval needed: defer impact study' },
	{ issue: 7392, comment: '6818860900', summary: SIZE_REASON },
]
const [FIRST] = FIXTURES
const ISSUE = 7387
const NEW_ATTEMPT = Date.parse(AT) + 1

function note(summary?: string, body = BODY): IssueComment {
	return {
		author: 'owner',
		created_at: AT,
		is_trusted: true,
		body: issue_outcome.body_of({ body, summary }),
		html_url: `https://github.com/joshuafolkken/kit/issues/${String(ISSUE)}#issuecomment-1`,
	}
}

describe('run_board_pause.from_comments', () => {
	it.each(FIXTURES)('keeps the recorded reason and evidence for $issue', (fixture) => {
		const url = `https://github.com/joshuafolkken/kit/issues/${String(fixture.issue)}#issuecomment-${fixture.comment}`
		const comment = { ...note(fixture.summary), html_url: url }

		expect(
			run_board_pause.from_comments([comment, note('Unrelated note', 'Released')]),
		).toMatchObject({ summary: fixture.summary, url })
	})

	it('uses the latest stop, ignoring untrusted later comments', () => {
		const current = note(SIZE_REASON)
		const untrusted = { ...note('Injected reason'), is_trusted: false }

		expect(run_board_pause.from_comments([note(FIRST?.summary), current, untrusted]).summary).toBe(
			SIZE_REASON,
		)
	})

	it.each([
		{ comments: [] },
		{ comments: [note()] },
		{ comments: [{ ...note('Earlier reason'), html_url: `${note().html_url}2` }, note()] },
	])('falls back without inheriting older evidence: $comments', ({ comments }) => {
		expect(run_board_pause.from_comments(comments)).toEqual({
			summary: run_board_pause.FALLBACK,
			url: comments.at(-1)?.html_url,
			at_ms: comments.length === 0 ? 0 : Date.parse(AT),
		})
	})
})

describe('run_board_pause evidence validation', () => {
	it('falls back for a missing URL or invalid summary', () => {
		const missing = { ...note(APPROVAL_REASON), html_url: undefined }
		const invalid = { ...note(), body: `${BODY}\n<!-- josh:outcome {"summary":"bad\\nline"} -->` }

		expect(run_board_pause.from_comments([missing]).summary).toBe(run_board_pause.FALLBACK)
		expect(run_board_pause.from_comments([invalid]).summary).toBe(run_board_pause.FALLBACK)
	})

	it('keeps an explicit reference to a trusted earlier evidence comment', () => {
		const evidence = note(undefined, 'Approval discussion')
		const latest = { ...note(APPROVAL_REASON), html_url: `${evidence.html_url}2` }

		latest.body = issue_outcome.body_of({
			body: BODY,
			summary: APPROVAL_REASON,
			url: evidence.html_url,
		})

		expect(run_board_pause.from_comments([evidence, latest])).toMatchObject({
			summary: APPROVAL_REASON,
			url: evidence.html_url,
		})
	})
})

describe('run_board_pause.reason_of', () => {
	const record = run_board_pause.from_comments([note(APPROVAL_REASON)])
	const read = { pause_reasons: new Map([[ISSUE, record]]) }

	it('withholds an old stop after a new launch and uses the next stop', () => {
		const status = { state: 'parked' as const, launched_ms: NEW_ATTEMPT }

		expect(run_board_pause.reason_of(ISSUE, read, status)).toEqual({
			tail: run_board_pause.FALLBACK,
			evidence_url: record.url?.split('#', 1)[0],
		})
		const fresh = { pause_reasons: new Map([[ISSUE, { ...record, at_ms: NEW_ATTEMPT }]]) }

		expect(run_board_pause.reason_of(ISSUE, fresh, status)?.evidence_url).toBe(record.url)
	})

	it('leaves an unread plan without invented metadata', () => {
		expect(run_board_pause.reason_of(ISSUE, {})).toBeUndefined()
	})
})

const PARKED_STOP = {
	...run_board_pause_fixture.parked,
	summary: 'Approve landing-test scope or keep paused',
}
const REAL_STOPS = [
	PARKED_STOP,
	{ ...run_board_pause_fixture.decision, summary: 'Inspect stale cut and lane before resuming' },
]

function real_stop(fixture: (typeof REAL_STOPS)[number]): IssueComment {
	return { ...note(), body: fixture.body, html_url: fixture.url, created_at: fixture.createdAt }
}

function backfill(fixture: (typeof REAL_STOPS)[number]): IssueComment {
	return {
		...note(undefined, '停止説明を補完。承認・解除・再開は行わない。'),
		html_url: `${fixture.url}9`,
		body: issue_outcome.body_of({
			body: '停止説明の補完',
			summary: fixture.summary,
			url: fixture.url,
		}),
	}
}

describe('run_board_pause real stops without markers', () => {
	it.each(REAL_STOPS)('keeps raw evidence before and after backfill: $summary', (fixture) => {
		const stop = real_stop(fixture)

		expect(stop.body).not.toContain('josh:outcome')
		expect(run_board_pause.from_comments([stop])).toMatchObject({
			summary: run_board_pause.FALLBACK,
			url: fixture.url,
		})
		expect(
			run_board_pause.from_comments([stop, backfill(fixture), note('Administrative', 'Released')]),
		).toMatchObject({ summary: fixture.summary, url: fixture.url })
	})

	it('expires a backfill when the lane stops again', () => {
		const fixture = PARKED_STOP
		const next = { ...note(), html_url: `${fixture.url}1` }
		const comments = [real_stop(fixture), backfill(fixture), next, backfill(fixture)]

		expect(run_board_pause.from_comments(comments)).toMatchObject({
			summary: run_board_pause.FALLBACK,
			url: next.html_url,
		})
	})

	it.each([
		undefined,
		'https://evil.example/1',
		'https://github.com/o/r/issues/1#issuecomment-1\n',
	])('uses the issue when the stop URL is invalid: %s', (html_url) => {
		const url = 'https://github.com/o/r/issues/1'
		const record = run_board_pause.from_comments([{ ...note(), html_url }], url)

		expect(run_board_pause.record_schema.parse(record).url).toBe(url)
	})

	it('ignores an untrusted backfill', () => {
		const comments = [real_stop(PARKED_STOP), { ...backfill(PARKED_STOP), is_trusted: false }]

		expect(run_board_pause.from_comments(comments).summary).toBe(run_board_pause.FALLBACK)
	})
})
