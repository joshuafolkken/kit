import { issue_outcome } from '#scripts/issue/issue-outcome'
import type { IssueComment } from '#scripts/issue/issue-read'
import { run_park_body } from '#scripts/run/park/run-park-body'
import { z } from 'zod'
import type { RowReason } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

const record_schema = z.object({
	summary: issue_outcome.summary_schema,
	url: issue_outcome.url_schema.optional(),
	at_ms: z.number(),
})
type PauseRecord = z.infer<typeof record_schema>

interface PauseRead {
	pause_reasons?: ReadonlyMap<number, PauseRecord> | undefined
}

const FALLBACK = 'Pause reason unavailable'

function is_stop(comment: IssueComment): boolean {
	return comment.is_trusted === true && run_park_body.summary_of(comment.body) !== undefined
}

// Only a stop comment can supply the reason; later administrative notes cannot replace it.
function from_comments(comments: ReadonlyArray<IssueComment>): PauseRecord {
	const latest = comments.findLast((comment) => is_stop(comment))
	const outcome = latest === undefined ? undefined : issue_outcome.from_comments(comments, [latest])
	const at_ms = Date.parse(latest?.created_at ?? '')

	return { summary: FALLBACK, ...outcome, at_ms: Number.isFinite(at_ms) ? at_ms : 0 }
}

// A new attempt cannot inherit the previous stop's evidence while the plan refreshes.
function launch_of(status?: ItemStatus): number {
	return status?.launched_ms ?? status?.started_ms ?? 0
}

function record_of(number: number, read: PauseRead, status?: ItemStatus): PauseRecord | undefined {
	const record = read.pause_reasons?.get(number)

	return status === undefined && record?.at_ms === 0 ? undefined : record
}

function reason_of(number: number, read: PauseRead, status?: ItemStatus): RowReason | undefined {
	const record = record_of(number, read, status)
	if (record === undefined) return undefined
	if (record.at_ms < launch_of(status)) return { tail: FALLBACK }

	return { tail: record.summary, evidence_url: record.url }
}

const run_board_pause = { FALLBACK, from_comments, reason_of, record_schema }

export { run_board_pause }
export type { PauseRead, PauseRecord }
