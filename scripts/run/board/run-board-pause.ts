import { issue_outcome } from '#scripts/issue/issue-outcome'
import type { IssueComment } from '#scripts/issue/issue-read'
import { run_park_body } from '#scripts/run/park/run-park-body'
import { z } from 'zod'
import type { RowReason } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

const record_schema = z.object({
	summary: issue_outcome.summary_schema,
	url: z
		.string()
		.regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+(?:#issuecomment-\d+)?$(?![\s\S])/u)
		.optional(),
	at_ms: z.number(),
})
type PauseRecord = z.infer<typeof record_schema>

interface PauseRead {
	pause_reasons?: ReadonlyMap<number, PauseRecord> | undefined
}

const FALLBACK = 'Reason unavailable: inspect issue'

function is_stop(comment: IssueComment): boolean {
	return comment.is_trusted === true && run_park_body.summary_of(comment.body) !== undefined
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

// Only a stop comment can supply the reason; later administrative notes cannot replace it.
function from_comments(comments: ReadonlyArray<IssueComment>, issue_url?: string): PauseRecord {
	const latest = comments.findLast((comment) => is_stop(comment))
	const url = issue_outcome.url_schema.safeParse(latest?.html_url).data
	const outcome = outcome_for(comments, latest)

	return { summary: FALLBACK, url: url ?? issue_url, ...outcome, at_ms: at_of(latest) }
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

function reason_of(number: number, read: PauseRead, status?: ItemStatus): RowReason | undefined {
	const record = record_of(number, read, status)
	if (record === undefined) return undefined

	if (record.at_ms < launch_of(status)) {
		return { tail: FALLBACK, evidence_url: record.url?.split('#', 1)[0] }
	}

	return { tail: record.summary, evidence_url: record.url }
}

const run_board_pause = { FALLBACK, from_comments, reason_of, record_schema }

export { run_board_pause }
export type { PauseRead, PauseRecord }
