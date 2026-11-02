// The base lines one side of a merge rewrote, read off `git diff -U0 <base> <side>` hunk headers
// (joshuafolkken/kit#5837). Step-back condition 2 of `backlogrun-recovery.md` — both sides rewrote the
// same lines, overlapping rather than adjacent — is then a range intersection, with no reading of the
// conflict's content. A pure insertion (`-a,0`) rewrites no base line, so it never overlaps.

const HUNK_HEADER = /^@@ -(?<start>\d+)(?:,(?<count>\d+))? \+/u
const DEFAULT_COUNT = '1'

// Half-open: `[start, end)` in base line numbers.
interface BaseRange {
	start: number
	end: number
}

function range_of(line: string): BaseRange | undefined {
	const groups = HUNK_HEADER.exec(line)?.groups
	if (groups?.['start'] === undefined) return undefined
	const start = Number(groups['start'])

	return { start, end: start + Number(groups['count'] ?? DEFAULT_COUNT) }
}

function is_rewrite(range: BaseRange | undefined): range is BaseRange {
	return range !== undefined && range.end > range.start
}

function rewritten_ranges(diff: string): ReadonlyArray<BaseRange> {
	return diff
		.split('\n')
		.map((line) => range_of(line))
		.filter((range) => is_rewrite(range))
}

function intersects(left: BaseRange, right: BaseRange): boolean {
	return left.start < right.end && right.start < left.end
}

function overlaps(ours_diff: string, theirs_diff: string): boolean {
	const theirs = rewritten_ranges(theirs_diff)

	return rewritten_ranges(ours_diff).some((ours) => theirs.some((range) => intersects(ours, range)))
}

const lane_resolve_hunks = { rewritten_ranges, overlaps }

export { lane_resolve_hunks }
export type { BaseRange }
