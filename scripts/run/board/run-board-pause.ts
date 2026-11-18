import { backlog_triage_adopted } from '#scripts/backlog/backlog-triage-adopted'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import type { IssueComment } from '#scripts/issue/issue-read'
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
const record_schema = z.object({
	summary: issue_outcome.summary_schema,
	url: url_schema,
	at_ms: z.number(),
	adopted: adopted_schema.optional(),
})
type Adopted = z.infer<typeof adopted_schema>
type PauseRecord = z.infer<typeof record_schema>

interface PauseRead {
	pause_reasons?: ReadonlyMap<number, PauseRecord> | undefined
}

const FALLBACK = 'Reason unavailable: inspect issue'

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

function adopted_after(
	comments: ReadonlyArray<IssueComment>,
	latest?: IssueComment,
): Adopted | undefined {
	const after = latest === undefined ? comments : comments.slice(comments.indexOf(latest) + 1)
	const adopt = after.findLast((comment) => backlog_triage_adopted.option_of(comment) !== undefined)
	const option = adopt === undefined ? undefined : backlog_triage_adopted.option_of(adopt)

	return option === undefined ? undefined : { option, url: url_of(adopt), at_ms: at_of(adopt) }
}

// Only a stop comment can supply the reason; later administrative notes cannot replace it.
function from_comments(comments: ReadonlyArray<IssueComment>, issue_url?: string): PauseRecord {
	const latest = comments.findLast((comment) => is_stop(comment))
	const outcome = outcome_for(comments, latest)
	const adopted = adopted_after(comments, latest)
	const record = { summary: FALLBACK, url: url_of(latest) ?? issue_url, ...outcome }

	return { ...record, at_ms: at_of(latest), ...(adopted !== undefined && { adopted }) }
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

function reason_of(number: number, read: PauseRead, status?: ItemStatus): RowReason | undefined {
	const record = record_of(number, read, status)
	if (record === undefined) return undefined

	const launch = launch_of(status)

	return record.at_ms < launch
		? stale_of(record, launch)
		: { tail: record.summary, evidence_url: record.url }
}

const run_board_pause = { FALLBACK, from_comments, reason_of, record_schema }

export { run_board_pause }
export type { PauseRead, PauseRecord }
