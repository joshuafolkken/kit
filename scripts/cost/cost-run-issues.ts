import type { SessionRow } from './cost-run-roles'

// A run tree's sessions summed per Issue.
//
// **The question is whether the implementation cut pays back**, and it is asked per Issue: a cut moves
// cost from one session into the resumed one, so a per-session row cannot say whether the Issue as a
// whole came out cheaper. Every session that names the Issue — its lane children, their relaunches and
// their subagents — is summed, and the Issue is marked cut when any of its sessions was ended by the
// implementation-phase cut. Sessions that name no Issue (the parent and its wakes) are left out.

const NONE = 0

interface IssueTotals {
	issue: number
	session_count: number
	cost_usd: number
	request_count: number
	// Active time summed across the Issue's sessions, the same axis `RoleTotals.elapsed_ms` sums along,
	// so the wait between a cut and its resume is not counted as work.
	elapsed_ms: number
	took_cut: boolean
	// Whether every session of the Issue could be priced. A total over an unmeasured session is a
	// floor, not the cost, and a comparison that read it as the cost would favour whichever side lost
	// more transcripts.
	is_measured: boolean
}

function sum(rows: ReadonlyArray<SessionRow>, pick: (row: SessionRow) => number): number {
	return rows.reduce((total, row) => total + pick(row), NONE)
}

function totals_of(issue: number, rows: ReadonlyArray<SessionRow>): IssueTotals {
	return {
		issue,
		session_count: rows.length,
		cost_usd: sum(rows, (row) => row.cost_usd),
		request_count: sum(rows, (row) => row.request_count),
		elapsed_ms: sum(rows, (row) => row.elapsed_ms),
		took_cut: rows.some((row) => row.took_cut),
		is_measured: rows.every((row) => row.is_measured),
	}
}

function group_by_issue(rows: ReadonlyArray<SessionRow>): Map<number, Array<SessionRow>> {
	const groups = new Map<number, Array<SessionRow>>()

	for (const row of rows) {
		if (row.issue !== undefined) groups.set(row.issue, [...(groups.get(row.issue) ?? []), row])
	}

	return groups
}

// Ascending by Issue number, so two runs' reports line up row for row.
function build(rows: ReadonlyArray<SessionRow>): Array<IssueTotals> {
	return [...group_by_issue(rows)]
		.map(([issue, members]) => totals_of(issue, members))
		.toSorted((left, right) => left.issue - right.issue)
}

const cost_run_issues = { build }

export type { IssueTotals }
export { cost_run_issues }
