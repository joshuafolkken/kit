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
//
// **`issue` is the branch's answer where the branch cannot give one** (joshuafolkken/kit#1617). The
// paragraph above assumes the session and the work share a checkout, and under lanes they do not: a
// child's commands run in a linked work tree on `<N>-lane` while the session writing the transcript
// sits on the default branch, so every line of a lane run reads `gitBranch: "main"` and no fill
// direction has an issue branch to carry. Measured on 2026-09-09: issues 1445, 1510 and 1511 each
// merged from a lane and left not one `<N>-` branch anywhere in the corpus.
//
// **It is a declaration, not a second walk.** The record says which issue it names and the existing
// fill-forward carries it exactly as it carries a branch — the alternative was a lane-aware copy of
// `attribute`, which is the clone `CLAUDE.md` prohibits in the one place a drift would make
// `josh cost --issue` and `josh time --issue` disagree. `UsageRecord` declares nothing and is
// unaffected.
interface BranchBearing {
	branch: string
	issue?: number
}

function issue_from_branch(branch: string): number {
	const matched = ISSUE_BRANCH_PATTERN.exec(branch)

	return matched?.[1] === undefined ? UNATTRIBUTED_KEY : Number(matched[1])
}

// What a record says it belongs to. A declaration wins over the branch because it is the stronger
// evidence: the branch is the checkout's and may be shared by every run of the day, while a
// declaration was written by the run itself about itself.
function declared_issue(record: BranchBearing): number {
	const declared = record.issue ?? UNATTRIBUTED_KEY

	return declared === UNATTRIBUTED_KEY ? issue_from_branch(record.branch) : declared
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

function is_attributed(value: number | undefined): value is number {
	return value !== undefined && value !== UNATTRIBUTED_KEY
}

// **A declaration is carried forward, and it outranks both branch directions.** The preference for
// `next` below is a statement about *branches*: work precedes the branch it will be committed to, so
// the branch sits at the end of the run it names. A declaration sits at the *start* — the
// `in-progress` label is the first thing a run writes — so carrying it backwards would give one
// child's work to the next child declared after it, which is exactly the shape a lane transcript
// holding two children has. `carried` is therefore the forward fill of declarations alone, and a
// corpus with no declaration leaves every value `UNATTRIBUTED_KEY` and this branch inert.
function pick(
	own: number,
	carried: number,
	next: number | undefined,
	previous: number | undefined,
): number {
	if (is_attributed(own)) return own
	if (is_attributed(carried)) return carried
	if (is_attributed(next)) return next

	return previous ?? UNATTRIBUTED_KEY
}

function announcements(records: ReadonlyArray<BranchBearing>): Array<number> {
	return fill(
		records.map((record) => record.issue ?? UNATTRIBUTED_KEY),
		false,
	)
}

function attribute(records: ReadonlyArray<BranchBearing>): Array<number> {
	const declared = records.map((record) => declared_issue(record))
	const carried = announcements(records)
	const next = fill(declared, true)
	const previous = fill(declared, false)

	return declared.map((own, index) =>
		pick(own, carried[index] ?? UNATTRIBUTED_KEY, next[index], previous[index]),
	)
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
	declared_issue,
	fill,
	attribute,
	group_by_issue,
	records_for_issue,
}

export type { BranchBearing, IssueGroup }
export { cost_attribute }
