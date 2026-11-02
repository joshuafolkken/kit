// The base lines one side of a merge rewrote, read off `git diff -U0 <base> <side>` hunks
// (joshuafolkken/kit#5837). Step-back condition 2 of `backlogrun-recovery.md` — both sides rewrote the
// same lines, overlapping rather than adjacent — is then a range intersection, with no reading of the
// conflict's content. A pure insertion (`-a,0`) rewrites no base line, so it never overlaps; a hunk
// both sides made alike is one git merges cleanly, so it never overlaps either.

const HUNK_HEADER = /^@@ -(?<start>\d+)(?:,(?<count>\d+))? \+/u
const HUNK_START = /^(?=@@ )/mu
const DEFAULT_COUNT = '1'
const LINE_BREAK = '\n'

// Half-open: `[start, end)` in base line numbers; `change` is the hunk's removed and added lines.
interface BaseRange {
	start: number
	end: number
	change: string
}

function header_groups(header: string): Record<string, string | undefined> | undefined {
	return HUNK_HEADER.exec(header)?.groups
}

function range_of(hunk: string): BaseRange | undefined {
	const [header = '', ...lines] = hunk.trimEnd().split(LINE_BREAK)
	const groups = header_groups(header)
	if (groups?.['start'] === undefined) return undefined
	const start = Number(groups['start'])
	const end = start + Number(groups['count'] ?? DEFAULT_COUNT)

	return { start, end, change: lines.join(LINE_BREAK) }
}

function is_rewrite(range: BaseRange | undefined): range is BaseRange {
	return range !== undefined && range.end > range.start
}

function rewritten_ranges(diff: string): ReadonlyArray<BaseRange> {
	return diff
		.split(HUNK_START)
		.map((hunk) => range_of(hunk))
		.filter((range) => is_rewrite(range))
}

function is_same_change(left: BaseRange, right: BaseRange): boolean {
	return left.start === right.start && left.end === right.end && left.change === right.change
}

function intersects(left: BaseRange, right: BaseRange): boolean {
	if (is_same_change(left, right)) return false

	return left.start < right.end && right.start < left.end
}

function overlaps(ours_diff: string, theirs_diff: string): boolean {
	const theirs = rewritten_ranges(theirs_diff)

	return rewritten_ranges(ours_diff).some((ours) => theirs.some((range) => intersects(ours, range)))
}

const lane_resolve_hunks = { rewritten_ranges, overlaps }

export { lane_resolve_hunks }
export type { BaseRange }
