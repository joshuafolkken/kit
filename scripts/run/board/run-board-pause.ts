import { backlog_triage_adopted } from '#scripts/backlog/backlog-triage-adopted'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import type { IssueComment } from '#scripts/issue/issue-read'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import { run_park_body } from '#scripts/run/park/run-park-body'
import { z } from 'zod'
import type { RowReason } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

const url_schema = z
	.string()
	.regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:#issuecomment-\d+)?$(?![\s\S])/u)
	.optional()
// The latest `backlog:triage --adopt` decision after the stop: its option, comment and time.
const adopted_schema = z.object({ option: z.number(), url: url_schema, at_ms: z.number() })
// An adopted recommendation still waiting on the parent's own action: the park's next action and the park.
const awaiting_schema = z.object({ summary: issue_outcome.summary_schema, url: url_schema })
const record_schema = z.object({
	summary: issue_outcome.summary_schema,
	url: url_schema,
	at_ms: z.number(),
	adopted: adopted_schema.optional(),
	awaiting: awaiting_schema.optional(),
})
type Adopted = z.infer<typeof adopted_schema>
type Awaiting = z.infer<typeof awaiting_schema>
type PauseRecord = z.infer<typeof record_schema>

interface PauseRead {
	pause_reasons?: ReadonlyMap<number, PauseRecord> | undefined
}

// joshuafolkken/kit#8592: no stop names a reason, so the row says what a person does next, in the
// `person:` form a stop's next action takes (`issue-outcome.ts`).
const FALLBACK = 'person: read the issue and decide (no stop recorded)'

// A next action the comment records about itself, as a `run:stalled` park does (joshuafolkken/kit#7852);
// a backfill citing another comment is that stop's reason, never a stop of its own.
function is_own_next(comment: IssueComment): boolean {
	if (issue_outcome.next_of(comment.body) === undefined) return false

	return issue_outcome.from_comments([comment])?.url === comment.html_url
}

function is_stop(comment: IssueComment): boolean {
	if (comment.is_trusted !== true) return false

	return run_park_body.summary_of(comment.body) !== undefined || is_own_next(comment)
}

// A backfill can describe this stop, never an older decision or a later administrative note.
function outcome_for(
	comments: ReadonlyArray<IssueComment>,
	latest?: IssueComment,
): ReturnType<typeof issue_outcome.from_comments> {
	if (latest === undefined) return undefined
	const candidates = comments.filter((comment) => {
		const outcome = issue_outcome.from_comments(comments, [comment])

		return comment === latest || outcome?.url === latest.html_url
	})

	return issue_outcome.from_comments(comments, candidates)
}

function at_of(comment?: IssueComment): number {
	const at_ms = Date.parse(comment?.created_at ?? '')

	return Number.isFinite(at_ms) ? at_ms : 0
}

function url_of(comment?: IssueComment): string | undefined {
	return issue_outcome.url_schema.safeParse(comment?.html_url).data
}

function last_adopt(
	comments: ReadonlyArray<IssueComment>,
	since?: IssueComment,
): IssueComment | undefined {
	const after = since === undefined ? comments : comments.slice(comments.indexOf(since) + 1)

	return after.findLast((comment) => backlog_triage_adopted.option_of(comment) !== undefined)
}

function adopted_after(
	comments: ReadonlyArray<IssueComment>,
	latest?: IssueComment,
): Adopted | undefined {
	const adopt = last_adopt(comments, latest)
	const option = adopt === undefined ? undefined : backlog_triage_adopted.option_of(adopt)

	return option === undefined ? undefined : { option, url: url_of(adopt), at_ms: at_of(adopt) }
}

// The adopt took the park's recommendation, which is the parent's own action, and records none done.
function awaits_parent(body: string, adopt?: IssueComment): boolean {
	const option = adopt === undefined ? undefined : backlog_triage_adopted.option_of(adopt)
	if (option === undefined || !backlog_triage_adopted.is_lane_option(adopt)) return false

	return run_park_body.adoptable_pick(body) === option && run_park_body.parent_action(body, option)
}

// joshuafolkken/kit#7851: an adopted parent action nobody has taken yet waits on the parent, so the row
// shows the park's next action — a later relaunch or `run:stalled` does not take it.
function awaiting_of(comments: ReadonlyArray<IssueComment>): Awaiting | undefined {
	const park = comments.findLast(
		(comment) => comment.is_trusted === true && run_park_body.is_park(comment.body),
	)
	if (park === undefined) return undefined
	const summary = issue_outcome.next_of(park.body)
	const is_waiting = summary !== undefined && awaits_parent(park.body, last_adopt(comments, park))

	return is_waiting ? { summary, url: url_of(park) } : undefined
}

// Only a stop comment can supply the reason; later administrative notes cannot replace it.
function from_comments(comments: ReadonlyArray<IssueComment>, issue_url?: string): PauseRecord {
	const latest = comments.findLast((comment) => is_stop(comment))
	const outcome = outcome_for(comments, latest)
	const adopted = adopted_after(comments, latest)
	const awaiting = awaiting_of(comments)
	const record = { summary: FALLBACK, url: url_of(latest) ?? issue_url, ...outcome }

	return {
		...record,
		at_ms: at_of(latest),
		...(adopted !== undefined && { adopted }),
		...(awaiting !== undefined && { awaiting }),
	}
}

// A new attempt cannot inherit the previous stop's evidence while the plan refreshes.
function launch_of(status?: ItemStatus): number {
	return status?.launched_ms ?? status?.started_ms ?? 0
}

function is_unread(record?: PauseRecord): boolean {
	return record?.at_ms === 0 && record.url === undefined
}

function record_of(number: number, read: PauseRead, status?: ItemStatus): PauseRecord | undefined {
	const record = read.pause_reasons?.get(number)

	return status === undefined && is_unread(record) ? undefined : record
}

// A stop older than the launch: an option adopted since is relaunching, else the reason is unknown.
function stale_of(record: PauseRecord, launch: number): RowReason {
	const { adopted } = record

	if (adopted !== undefined && adopted.at_ms <= launch) {
		return {
			tail: `adopted option ${String(adopted.option)} · relaunching`,
			evidence_url: adopted.url,
		}
	}

	return { tail: FALLBACK, evidence_url: record.url?.split('#', 1)[0] }
}

// joshuafolkken/kit#9029: past the drive's auto-retry cap a park's own next action (the yield cap's
// re-offer) no longer holds — the drive restated the park with its cap note, which hands the row to a
// person, so the comment's record gives way to that event.
function is_capped(status?: ItemStatus): boolean {
	return status?.reason?.includes(run_event_retry.CAP_NOTE) === true
}

function reason_of(number: number, read: PauseRead, status?: ItemStatus): RowReason | undefined {
	const record = record_of(number, read, status)
	if (record === undefined || is_capped(status)) return undefined

	const launch = launch_of(status)
	const { awaiting } = record

	if (awaiting !== undefined) return { tail: awaiting.summary, evidence_url: awaiting.url }

	return record.at_ms < launch
		? stale_of(record, launch)
		: { tail: record.summary, evidence_url: record.url }
}

const run_board_pause = { FALLBACK, from_comments, reason_of, record_schema }

export { run_board_pause }
export type { PauseRead, PauseRecord }
