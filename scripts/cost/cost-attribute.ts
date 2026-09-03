import type { UsageRecord } from './cost-usage'

// Which Issue a request belongs to (joshuafolkken/kit#962).
//
// **The walk is keyed on the branch and nothing else**, which is why its input is `BranchBearing`
// rather than `UsageRecord` (joshuafolkken/kit#1268). `josh time` attributes *spans* to an issue by
// exactly this rule, and the alternative to widening the parameter was a second copy of the
// fill-forward walk over a different element type — the clone `CLAUDE.md` prohibits, in the one
// place where a drift between the two would make `josh cost --issue` and `josh time --issue`
// disagree about which issue a run belonged to.
//
// The transcript records `gitBranch` on every line, and `josh git` names a branch `<N>-<slug>`, so
// the branch is where the Issue number is. What makes the mapping less than direct is that a child
// is implemented on the **default branch** — `josh git` only creates the branch at commit time — so
// most of a child's requests were made while `gitBranch` still said `main`.
//
// Hence the fill: a request on a non-issue branch is attributed to the nearest issue branch that
// appears **later** in the session, because the work precedes the branch it will be committed to.
// Only when nothing follows does it fall back to the nearest earlier one, which is what catches the
// tail after a merge — `josh ms` returns to the default branch while the run is still reporting.

const ISSUE_BRANCH_PATTERN = /^(\d+)-/u

// The value that means "no issue". Issue numbers are positive, so a negative sentinel cannot be
// mistaken for one, and one value used throughout removes the `undefined` juggling that each fill
// direction would otherwise repeat.
const UNATTRIBUTED_KEY = -1

// Everything the attribution reads. `UsageRecord` satisfies it, and so does a timed span.
interface BranchBearing {
	branch: string
}

function issue_from_branch(branch: string): number {
	const matched = ISSUE_BRANCH_PATTERN.exec(branch)

	return matched?.[1] === undefined ? UNATTRIBUTED_KEY : Number(matched[1])
}

// The nearest declared issue in one direction, carried across the gaps. Both directions are the
// same walk, so they are one function rather than two that would drift.
function fill(declared: ReadonlyArray<number>, is_reverse: boolean): Array<number> {
	const filled: Array<number> = Array.from({ length: declared.length }, () => UNATTRIBUTED_KEY)
	const order = declared.map((_value, index) => (is_reverse ? declared.length - 1 - index : index))
	let carried = UNATTRIBUTED_KEY

	for (const index of order) {
		const own = declared[index] ?? UNATTRIBUTED_KEY

		carried = own === UNATTRIBUTED_KEY ? carried : own
		filled[index] = carried
	}

	return filled
}

function pick(own: number, next: number | undefined, previous: number | undefined): number {
	if (own !== UNATTRIBUTED_KEY) return own
	if (next !== undefined && next !== UNATTRIBUTED_KEY) return next

	return previous ?? UNATTRIBUTED_KEY
}

function attribute(records: ReadonlyArray<BranchBearing>): Array<number> {
	const declared = records.map((record) => issue_from_branch(record.branch))
	const next = fill(declared, true)
	const previous = fill(declared, false)

	return declared.map((own, index) => pick(own, next[index], previous[index]))
}

interface IssueGroup {
	// `UNATTRIBUTED_KEY` for requests made in a session that never touched an issue branch — a plain
	// conversational session. Reported as its own bucket rather than dropped.
	issue: number
	records: Array<UsageRecord>
}

function group_by_issue(records: ReadonlyArray<UsageRecord>): Array<IssueGroup> {
	const issues = attribute(records)
	const grouped = new Map<number, Array<UsageRecord>>()

	for (const [index, record] of records.entries()) {
		const bucket = grouped.get(issues[index] ?? UNATTRIBUTED_KEY) ?? []

		bucket.push(record)
		grouped.set(issues[index] ?? UNATTRIBUTED_KEY, bucket)
	}

	return [...grouped]
		.toSorted(([left], [right]) => left - right)
		.map(([issue, bucket]) => ({ issue, records: bucket }))
}

// One issue's slice of a session's items, whatever the items are. Generic for the same reason
// `attribute` is: `josh time` filters spans through it, and a second copy narrowed to spans would
// be the fill-forward rule written twice.
function records_for_issue<Item extends BranchBearing>(
	records: ReadonlyArray<Item>,
	issue_number: number,
): Array<Item> {
	const issues = attribute(records)

	return records.filter((_record, index) => issues[index] === issue_number)
}

const cost_attribute = {
	UNATTRIBUTED_KEY,
	issue_from_branch,
	fill,
	attribute,
	group_by_issue,
	records_for_issue,
}

export type { BranchBearing, IssueGroup }
export { cost_attribute }
