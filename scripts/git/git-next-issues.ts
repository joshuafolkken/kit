import { git_gh_command } from './git-gh-command'
import { has_any_label, NOT_DIRECTLY_RUNNABLE_LABELS } from './issue-labels'
import { parse_json_array_safe } from './parse-json-array'
import { open_issue_schema, type OpenIssueData } from './schemas'

// The next-issues display printed when a workflow completes (#821): up to five open issues in
// priority order, so the user picks the next run from the completion output instead of opening the
// issue list. Priority is recency — a newer issue usually encodes the most current understanding
// of the backlog — with the label-based exclusions below.
//
// `prioritize` is also the order `epicrun` picks up `auto-ok` issues in (joshuafolkken/kit#906).
// The two ask one question — which open issue outside an epic is run next — so they share one
// answer; a second ordering would have the run start something other than what this display, shown
// at the end of every workflow, has just told the person is next.
const FETCH_LIMIT = 20
const DISPLAY_LIMIT = 5
const HEADER = '🗒 Next issues (newest first):'

// Surfacing an `epic`, an `in-progress` or a `needs-decision` issue as "next" would suggest a run
// the workflow rules forbid, duplicate, or cannot finish (joshuafolkken/kit#861). The set itself is
// shared with the `auto-ok` pickup, which asks the same question of the same listing shape.
function has_excluded_label(issue: OpenIssueData): boolean {
	return has_any_label(issue.labels, NOT_DIRECTLY_RUNNABLE_LABELS)
}

// The completed issue is excluded by number, not by state: GitHub applies the `closes #N` side
// effect asynchronously, so right after the merge it can still be listed as open.
function is_candidate(issue: OpenIssueData, completed_issue_number: number | undefined): boolean {
	return issue.number !== completed_issue_number && !has_excluded_label(issue)
}

// ISO-8601 timestamps compare correctly as strings; the issue number breaks ties because two
// issues created in one `josh epic` batch can share a timestamp to the second.
function compare_newest_first(first: OpenIssueData, second: OpenIssueData): number {
	if (first.createdAt === second.createdAt) return second.number - first.number

	return first.createdAt < second.createdAt ? 1 : -1
}

// **This display deliberately does not drop a blocked issue, and the `auto-ok` pickup deliberately
// does.** They share this ordering and differ on the set, which reads as an inconsistency and is not
// one (joshuafolkken/kit#1005).
//
// The display is read by a person, who can see that an issue is blocked, judge that the blocker is
// nearly done or does not really block it, and start anyway. The pickup feeds an unattended run,
// which has none of that judgement — so the same row is information to one and an instruction to the
// other. Filtering here would take the choice away from the only reader equipped to make it, and the
// blocked issue would simply vanish from the backlog view with nothing said.
function prioritize(
	issues: ReadonlyArray<OpenIssueData>,
	completed_issue_number?: number,
): Array<OpenIssueData> {
	return issues
		.filter((issue) => is_candidate(issue, completed_issue_number))
		.toSorted(compare_newest_first)
		.slice(0, DISPLAY_LIMIT)
}

// Empty input yields no lines at all — a bare header with nothing under it reads as an error.
function format_lines(issues: ReadonlyArray<OpenIssueData>): Array<string> {
	if (issues.length === 0) return []
	const rows = issues.map(
		(issue, index) => `  ${String(index + 1)}. #${String(issue.number)} ${issue.title}`,
	)

	return [HEADER, ...rows]
}

// Returns display lines, or [] when there is nothing to show. Every failure — `gh` unavailable,
// malformed JSON, an unexpected shape — degrades to [] rather than throwing: this runs after the
// merge has already succeeded, and a non-zero exit here would make a completed workflow look
// failed over a purely informational display.
async function fetch_next_issue_lines(completed_issue_number?: number): Promise<Array<string>> {
	try {
		const raw_json = await git_gh_command.issue_list_recent(FETCH_LIMIT)
		if (raw_json === undefined) return []

		return format_lines(
			prioritize(parse_json_array_safe(raw_json, open_issue_schema), completed_issue_number),
		)
	} catch {
		return []
	}
}

const git_next_issues = {
	prioritize,
	format_lines,
	fetch_next_issue_lines,
}

export { git_next_issues }
