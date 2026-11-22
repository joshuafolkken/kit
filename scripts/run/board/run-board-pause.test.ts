import { backlog_triage_adopted } from '#scripts/backlog/backlog-triage-adopted'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import type { IssueComment } from '#scripts/issue/issue-read'
import { describe, expect, it } from 'vitest'
import type { RowReason } from './run-board-layout'
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

// joshuafolkken/kit#7850: a park's next action reaches the 💤 row as a command to paste.
describe('run_board_pause park next action', () => {
	it('shows the parked command as the row reason', () => {
		const command = 'pnpm josh backlog:triage --apply 7447 --blocked-by 7839'

		expect(run_board_pause.from_comments([note(SIZE_REASON), note(command)]).summary).toBe(command)
	})
})

// joshuafolkken/kit#7852: a `run:stalled` park comment carries no options, only its marked next action.
const STALLED = 'Parked with `run:stalled`\n- Next: fix the cause'
const COMMAND = 'pnpm josh ship --log 7387'

function stalled(summary?: string): IssueComment {
	return { ...note(summary, STALLED), html_url: `${note().html_url}9` }
}

describe('run_board_pause run:stalled next action', () => {
	it('reads a marked run:stalled park over an older park', () => {
		expect(run_board_pause.from_comments([note(SIZE_REASON), stalled(COMMAND)])).toMatchObject({
			summary: COMMAND,
			url: stalled().html_url,
		})
	})

	it('does not read an unmarked run:stalled comment as a stop', () => {
		expect(run_board_pause.from_comments([note(SIZE_REASON), stalled()]).summary).toBe(SIZE_REASON)
	})

	it('does not read a marker holding no next action as a stop', () => {
		expect(run_board_pause.from_comments([stalled('Merged cleanly')]).summary).toBe(
			run_board_pause.FALLBACK,
		)
	})
})

describe('run_board_pause run:stalled next action and backfills', () => {
	it('does not read a next-shaped backfill of an older stop as a stop', () => {
		const older = note()
		const late = {
			...note(),
			body: issue_outcome.body_of({
				body: 'Backfill',
				summary: 'pnpm josh run:cut --end',
				url: older.html_url,
			}),
			html_url: `${note().html_url}8`,
		}

		expect(run_board_pause.from_comments([older, stalled(COMMAND), late])).toMatchObject({
			summary: COMMAND,
			url: stalled().html_url,
		})
	})
})

// joshuafolkken/kit#8592: with no reason anywhere the row still names what a person does next.
describe('run_board_pause fallback', () => {
	it('names the next action and what to decide', () => {
		expect(run_board_pause.FALLBACK).toMatch(/^person: read the issue and decide\b/u)
		expect(issue_outcome.summary_schema.safeParse(run_board_pause.FALLBACK).success).toBe(true)
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

// joshuafolkken/kit#7851: joshuafolkken/kit#7780's order — the park, the adopt, the relaunched child's
// Auto-decided note, then `run:stalled`.
const PARENT_NEXT = 'pnpm josh issue:close 7780 && pnpm josh lane:close 7780'
const LANE_OPTION = '1. Retry\n   - 層: A\n   - 必要な権限: なし\n'
const PARENT_OPTION = '2. Close\n   - 層: A\n   - 必要な権限: 親（issue:close）\n'

function park_of(pick: number, second = PARENT_OPTION): IssueComment {
	const body = `### 選択肢\n${LANE_OPTION}${second}\n### 推奨\n${String(pick)} safer\n`

	return { ...note(PARENT_NEXT, body), created_at: '2026-11-17T13:55:07Z' }
}

function adopt_of(option: number, done = ''): IssueComment {
	const body = backlog_triage_adopted.text_of({ issue: '7780', option, reason: 'k', done })

	return {
		...note(undefined, body),
		html_url: `${note().html_url}2`,
		created_at: '2026-11-17T13:56:58Z',
	}
}

const DECIDED = { ...note(undefined, 'Auto-decided: x'), created_at: '2026-11-17T13:59:22Z' }
const LATE_STALL = { ...stalled(COMMAND), created_at: '2026-11-17T14:00:20Z' }

function row_of(comments: ReadonlyArray<IssueComment>): RowReason | undefined {
	const read = { pause_reasons: new Map([[ISSUE, run_board_pause.from_comments(comments)]]) }
	const launched_ms = Date.parse('2026-11-17T14:01:00Z')

	return run_board_pause.reason_of(ISSUE, read, { state: 'parked', launched_ms })
}

function tail_of(comments: ReadonlyArray<IssueComment>): string | undefined {
	return row_of(comments)?.tail
}

describe('run_board_pause adopted parent action', () => {
	it('shows the parked command over relaunching and a later run:stalled', () => {
		const expected = { tail: PARENT_NEXT, evidence_url: park_of(2).html_url }

		expect(row_of([park_of(2), adopt_of(2), DECIDED])).toEqual(expected)
		expect(row_of([park_of(2), adopt_of(2), DECIDED, LATE_STALL])).toEqual(expected)
	})

	it('lets a newer park replace the adopted parent action', () => {
		const newer = {
			...park_of(2),
			body: issue_outcome.body_of({ body: BODY, summary: COMMAND }),
			html_url: `${note().html_url}3`,
			created_at: '2026-11-17T14:02:00Z',
		}

		expect(row_of([park_of(2), adopt_of(2), newer])).toEqual({
			tail: COMMAND,
			evidence_url: newer.html_url,
		})
	})

	it.each([
		{
			name: 'a lane option',
			comments: [park_of(2, PARENT_OPTION.replace('親（issue:close）', 'なし')), adopt_of(2)],
		},
		{ name: 'an option off the pick', comments: [park_of(1), adopt_of(2)] },
		{ name: 'a parent action done', comments: [park_of(2), adopt_of(2, 'closed')] },
	])('keeps relaunching for $name', ({ comments }) => {
		expect(tail_of([...comments, DECIDED])).toBe('adopted option 2 · relaunching')
	})
})
