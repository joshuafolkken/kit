import { agent_exit_record } from './agent-exit-record'
import type { ClaudeResultEvent } from './claude-result-event'
import { usage_limit_reset } from './usage-limit-reset'

// Whether a Claude session's exit record is a usage-limit stop, and when it may run again — observed on
// 2026-10-23, when four lane children ended `You've hit your weekly limit · resets 10am (...)` at once
// and the parent parked each as a child that stopped on its own (joshuafolkken/kit#4745).
//
// **Kept apart from `api-outage.ts` and `api-auth.ts`**: an outage clears within minutes and an
// authentication failure needs a person, but a usage limit clears at a time the record itself names, so
// the run waits for that time and resumes. The read is the same mechanical one — the error flag AND a
// fixed marker in the harness's own `reason`, never the marker alone.

// The limit sentences' stable parts, lower-cased: the current `You've hit your [weekly|session] limit`
// and the older `Claude AI usage limit reached|<epoch>`.
const LIMIT_PATTERN = /hit your (?:\w+ )?limit|usage limit reached/u
// How long a stop whose reset time could not be read waits before one child tries again.
const RECHECK_MS = 1_800_000

// The record's `reason` when it is a usage limit, else `undefined`.
function limit_reason(record: ClaudeResultEvent | undefined): string | undefined {
	if (record === undefined || !record.is_error || record.reason === undefined) return undefined

	return LIMIT_PATTERN.test(record.reason.toLowerCase()) ? record.reason : undefined
}

function is_usage_limit(record: ClaudeResultEvent | undefined): boolean {
	return limit_reason(record) !== undefined
}

// A reset the record does not state readably — or one already past — is re-checked `RECHECK_MS` on.
function or_recheck(reset_ms: number | undefined, now_ms: number): number {
	return reset_ms === undefined || reset_ms <= now_ms ? now_ms + RECHECK_MS : reset_ms
}

// When a run stopped by this record may dispatch again, in epoch milliseconds, or `undefined` when the
// record is no usage limit. The sentence's wall clock is read from `stopped_ms`, when the record was
// written: read later, a reset already past would roll to the next day.
function resume_ms(
	record: ClaudeResultEvent | undefined,
	now_ms: number,
	stopped_ms = now_ms,
): number | undefined {
	const reason = limit_reason(record)

	if (reason === undefined) return undefined

	return or_recheck(usage_limit_reset.reset_ms(reason, stopped_ms), now_ms)
}

// The same read over a whole stream-json transcript, read only when it ends on an exit record — the
// lane's log is appended across launches (`api_auth.is_auth_failed_transcript`).
function transcript_resume_ms(
	log: string | undefined,
	now_ms: number,
	stopped_ms = now_ms,
): number | undefined {
	if (log === undefined || !agent_exit_record.ends_on_exit_record(log)) return undefined

	return resume_ms(agent_exit_record.read_exit_record(log), now_ms, stopped_ms)
}

const api_usage_limit = { RECHECK_MS, is_usage_limit, resume_ms, transcript_resume_ms }

export { api_usage_limit }
