import type { AuditSession } from './cost-audit-read'

// How densely lane children packed their calls: calls per tool-calling request, and the share of
// those requests that issued one call alone. A lane child's cost follows its round trips rather than
// its tokens (`prompts/collaboration-workflow/turn-batching.md`), so these two figures are what a
// batching change is read against, period over period (kit#5342).
//
// **A delegated unit is not the lane child's own work**, so subagent sessions are left out, as the
// Issue's measurement left them out.

const SUBAGENT_KIND = 'subagent'
const SINGLE_CALL = 1

interface Density {
	// Requests that issued at least one call.
	requests: number
	calls: number
	single: number
}

function is_lane_child(session: AuditSession): boolean {
	return session.is_lane && session.kind !== SUBAGENT_KIND
}

// The call counts of the requests a session holds in its (already windowed) records.
function call_counts(session: AuditSession): Array<number> {
	return session.records
		.map((record) => session.categories.get(record.request_id)?.length ?? 0)
		.filter((count) => count > 0)
}

function density_of(sessions: ReadonlyArray<AuditSession>): Density {
	const counts = sessions
		.filter((session) => is_lane_child(session))
		.flatMap((session) => call_counts(session))

	return {
		requests: counts.length,
		calls: counts.reduce((sum, count) => sum + count, 0),
		single: counts.filter((count) => count === SINGLE_CALL).length,
	}
}

// Zero where no request called a tool, rather than a division by zero.
function calls_per_request(density: Density): number {
	return density.requests === 0 ? 0 : density.calls / density.requests
}

function single_share(density: Density): number {
	return density.requests === 0 ? 0 : density.single / density.requests
}

const cost_audit_density = { calls_per_request, density_of, single_share }

export type { Density }
export { cost_audit_density }
