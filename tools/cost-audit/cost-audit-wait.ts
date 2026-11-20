import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'
import type { Breakdown } from '#scripts/lane/lane-breakdown'
import { transcript_record } from '#scripts/lib/transcript-record'
import type { Block, TranscriptLine } from '#scripts/time-runtime/time-transcript-line'
import { cost_audit_phase } from './cost-audit-phase'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_result } from './cost-audit-result'
import { cost_audit_rewrite } from './cost-audit-rewrite'

// Where `josh cost:audit`'s full cache rewrites after a wait past the cache TTL happen
// (joshuafolkken/kit#8308): each rewrite `is_wait_rewrite` counts, keyed three ways — by session kind,
// by phase (a lane child's `cost-audit-phase.ts` phase, any other session its kind alone) and by the
// tool call the session issued last before it, the call whose wait the cache outlived. A Bash call
// keys as its josh subcommand or its command key, any other call as its tool name.
//
// **Each table counts every rewrite once**, so each adds up to the audit's after-wait rewrite line.

const NO_CALL = '(none)'
const LANE_LEAD = 'lane: '

interface WaitRow {
	key: string
	count: number
	usd: number
	tokens: number
}

interface WaitTable {
	by: string
	rows: ReadonlyArray<WaitRow>
}

interface WaitInput {
	sessions: ReadonlyArray<AuditSession>
	breakdowns: ReadonlyMap<number, Breakdown>
	is_counted: (at_ms: number | undefined) => boolean
}

interface WaitRewrite {
	record: UsageRecord
	kind: string
	phase: string
	call: string
}

function call_key(call: Block): string {
	const josh = cost_audit_result.josh_of(call)

	if (josh !== '') return josh

	const command = cost_audit_result.command_of(call)

	return command === '' ? call.name : command
}

// The last tool call the session issued before the request, the request's own lines excluded.
function call_before(lines: ReadonlyArray<TranscriptLine>, record: UsageRecord): string {
	const at_ms = record.at_ms ?? 0
	const before = lines.filter(
		(line) => line.timestamp_ms < at_ms && line.request_id !== record.request_id,
	)
	const calls = before
		.flatMap((line) => line.blocks)
		.filter((block) => block.type === transcript_record.TOOL_USE_TYPE)
	const call = calls.at(-1)

	return call === undefined ? NO_CALL : call_key(call)
}

// A lane child's requests by id with their phase; any other session places none.
function phases_of(input: WaitInput, session: AuditSession): Map<string, string> {
	if (!session.is_lane) return new Map()

	const { sessions, breakdowns } = input
	const placed = cost_audit_phase.placed_phases(
		{ sessions, reviews: sessions, breakdowns },
		session,
	)

	return new Map(placed.map(([record, phase]) => [record.request_id, `${LANE_LEAD}${phase}`]))
}

function session_rewrites(input: WaitInput, session: AuditSession): Array<WaitRewrite> {
	const phases = phases_of(input, session)
	const pairs = cost_audit_rewrite
		.pairs_of(session.records)
		.filter(
			([record, before]) =>
				input.is_counted(record.at_ms) && cost_audit_rewrite.is_wait_rewrite(record, before),
		)

	return pairs.map(([record]) => ({
		record,
		kind: session.kind,
		phase: phases.get(record.request_id) ?? session.kind,
		call: call_before(session.lines, record),
	}))
}

function added(row: WaitRow, record: UsageRecord): WaitRow {
	return {
		key: row.key,
		count: row.count + 1,
		usd: row.usd + cost_audit_rewrite.write_cost(record),
		tokens: row.tokens + cost_audit_rewrite.written(record),
	}
}

function table_of(
	by: string,
	rewrites: ReadonlyArray<WaitRewrite>,
	key_of: (rewrite: WaitRewrite) => string,
): WaitTable {
	const rows = new Map<string, WaitRow>()

	for (const rewrite of rewrites) {
		const key = key_of(rewrite)

		rows.set(key, added(rows.get(key) ?? { key, count: 0, usd: 0, tokens: 0 }, rewrite.record))
	}

	return { by, rows: [...rows.values()].toSorted((left, right) => right.usd - left.usd) }
}

// The counted after-wait rewrites by session kind, phase and preceding call, in that order.
function waits_of(input: WaitInput): Array<WaitTable> {
	const rewrites = input.sessions.flatMap((session) => session_rewrites(input, session))

	return [
		table_of('session kind', rewrites, (rewrite) => rewrite.kind),
		table_of('phase', rewrites, (rewrite) => rewrite.phase),
		table_of('preceding tool call', rewrites, (rewrite) => rewrite.call),
	]
}

const cost_audit_wait = { NO_CALL, waits_of }

export type { WaitInput, WaitRow, WaitTable }
export { cost_audit_wait }
