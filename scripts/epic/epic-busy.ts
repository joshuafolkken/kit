import { git_gh_command } from '#scripts/git/git-gh-command'
import { has_any_label, IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/schemas'

// Whether a repository already has work running in it — asked of the *repository*, never of the
// epic (joshuafolkken/kit#925).
//
// The contended resource is one working tree, one `main` and one `package.json` that `josh bump`
// rewrites, and none of them cares which epic a child belongs to. `epic-classify.ts` sorts only the
// children the epic tracks, so an `in-progress` issue belonging to a *different* epic is invisible
// to it: start two `epicrun`s and both answer "nothing of mine is in progress", after which two
// children implement in the same checkout and the result is destruction rather than interleaving.
// This read is what closes that gap, and it is deliberately outside the classification — the
// question is not about the graph.

// Wide enough that the cap is never what decides the answer: a repository with a hundred issues
// carrying `in-progress` at once is already the state this guard exists to report.
const LISTING_LIMIT = 100

// Read through `has_any_label` rather than compared directly, for the casing reason
// `issue-labels.ts` records: GitHub keeps the spelling a label was created with.
const PARKED_LABELS: ReadonlySet<string> = new Set([NEEDS_DECISION_LABEL])

// What one repository answered. `unreadable` is kept apart from `idle` for the reason
// joshuafolkken/kit#950 records: reading a failed read as an empty listing is a confident absence
// built on a response nobody parsed — and here that absence *starts* work, which is the one
// direction a guard must never fail in.
//
// **`epic:next` answers `wait` for it, rather than exiting.** The other candidate was an error exit,
// as an unreadable *child* already produces — but `issue_list_open` swallows every failure into
// `undefined`, a passing rate limit included, and this read happens on every poll of every session,
// so an exit would end an unattended run over a blip. A persistent failure never arrives here: the
// children are read first, and one that could not be read is already an anomaly that exits 1. What
// is left at this line is transient, and `wait` self-heals where an exit needs a person.
type BusyRead =
	{ kind: 'idle' } | { kind: 'busy'; issues: ReadonlyArray<OpenIssueData> } | { kind: 'unreadable' }

// Named so the reader can go and look at them: the stale-label rule is what keeps an abandoned
// `in-progress` from holding a repository forever, and it cannot be applied to an issue nobody was
// told about.
function format_holders(issues: ReadonlyArray<OpenIssueData>): string {
	return issues.map((issue) => `#${String(issue.number)} ${issue.title}`).join(', ')
}

function busy_message(issues: ReadonlyArray<OpenIssueData>, repo: string): string {
	return `Already in progress in ${repo}: ${format_holders(issues)}. One child runs at a time per repository, whichever epic it belongs to, so nothing is offered here. If a label is stale, remove it and ask again.`
}

function unreadable_message(repo: string): string {
	return `Could not read the \`${IN_PROGRESS_LABEL}\` listing for ${repo}. That is not "nothing is running" — check \`gh auth status\` and ask again.`
}

// A parked issue does not hold the repository, and this is not a special case bolted on: it is the
// precedence `epic_classify.local_category` already applies, which reads `needs-decision` *before*
// `in-progress` and so calls a parked child `human` rather than `time`. Two readings of one issue
// have to agree, and without this they do not — nothing removes `in-progress` when a child is
// parked, so `park and continue` would hand the repository to the very child it just set aside and
// the run would poll instead of continuing (joshuafolkken/kit#925).
function is_parked(issue: OpenIssueData): boolean {
	return has_any_label(issue.labels, PARKED_LABELS)
}

// A listing that arrived, or a gap. The shared reader tells the two gaps apart — output that is not
// a listing from elements the schema rejects — and both are `unreadable` here: this guard has one
// safe answer and it is the same for either, while the `auto-ok` pickup names them separately.
function parse_listing(raw: string): BusyRead {
	const read = read_json_listing(raw, open_issue_schema)
	if (read.kind !== 'read') return { kind: 'unreadable' }

	const holders = read.rows.filter((row) => !is_parked(row))

	return holders.length === 0 ? { kind: 'idle' } : { kind: 'busy', issues: holders }
}

// The label filter is the query's job — membership is what makes the listing the running set, so
// re-testing it here would be a second definition of "running".
async function read_repository(repo: string): Promise<BusyRead> {
	const raw = await git_gh_command.issue_list_by_label_in_repo(
		IN_PROGRESS_LABEL,
		LISTING_LIMIT,
		repo,
	)

	return raw === undefined ? { kind: 'unreadable' } : parse_listing(raw)
}

const epic_busy = {
	LISTING_LIMIT,
	busy_message,
	unreadable_message,
	format_holders,
	is_parked,
	parse_listing,
	read_repository,
}

export type { BusyRead }
export { epic_busy }
