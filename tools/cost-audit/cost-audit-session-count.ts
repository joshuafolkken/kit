import { figure_format } from '#scripts/lib/figure-format'
import type { AuditSession } from './cost-audit-read'

// The session counts a row is read by (joshuafolkken/kit#8329): how many sessions each period's dollars
// came from, so a grown row shows whether more sessions ran or each one cost more. A session counts in
// a period when at least one of its requests falls inside it — the sessions handed in are already cut.

interface SessionCounts {
	current: number
	previous: number
}

interface PeriodUsd {
	current: number
	previous: number
}

function counts_by_kind(sessions: ReadonlyArray<AuditSession>): Map<string, number> {
	const counts = new Map<string, number>()

	for (const session of sessions) {
		if (session.records.length > 0) counts.set(session.kind, (counts.get(session.kind) ?? 0) + 1)
	}

	return counts
}

function counts_text(sessions: SessionCounts): string {
	return `${String(sessions.current)} session(s) (prev ${String(sessions.previous)})`
}

// The dollars per session, each period's own; a period without a session has no rate to print.
function per_session_text(usd: PeriodUsd, sessions: SessionCounts): string {
	if (sessions.current === 0 || sessions.previous === 0) return ''

	const current = figure_format.format_usd(usd.current / sessions.current)
	const previous = figure_format.format_usd(usd.previous / sessions.previous)

	return ` · ${current} per session (prev ${previous})`
}

// The text a kind row carries after its dollars: its session counts and the dollars per session.
function row_text(usd: PeriodUsd, sessions: SessionCounts | undefined): string {
	if (sessions === undefined) return ''

	return ` · ${counts_text(sessions)}${per_session_text(usd, sessions)}`
}

const cost_audit_session_count = { counts_by_kind, counts_text, row_text }

export type { SessionCounts }
export { cost_audit_session_count }
