import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { parse_json_array_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { epic_audit_logic } from './epic-audit'
import type { EpicSnapshot } from './epic-fetch'

// Check 4's half of `epic:audit`: an issue that names this epic as its parent but that the epic's
// task list does not track. It would never be run, and the epic would close without it.
//
// Split from the command because it shares nothing with the rest of it — the other three checks read
// the children the epic already names, while this one searches for issues the epic does *not* name
// (joshuafolkken/kit#1016).

const SEARCH_LIMIT = 50
const PARENT_MARKERS: ReadonlyArray<string> = ['親:', 'Parent:', '親：']

const searched_issue_schema = z.object({ number: z.number(), body: z.string().nullable() })

function has_parent_marker(line: string): boolean {
	return PARENT_MARKERS.some((marker) => line.includes(marker))
}

// Whether an issue's body names this epic as its parent, in the shape the issue template uses.
//
// Both halves must be on the *same line*. An issue parented to a different epic routinely backlinks
// this one elsewhere in its body, and matching the marker and the number independently reported
// every such issue as an orphan.
//
// The number is read through the same reference parse the checks use, so `親: owner/other#858` names
// that repository's epic and not this one's (joshuafolkken/kit#1014).
// The known set is this repository alone — a parent line names this epic or it names nothing here —
// and it is passed rather than omitted so a repository whose own name contains a dot still recognizes
// `親: joshuafolkken/site.com#858` (joshuafolkken/kit#1016).
function names_this_epic(line: string, epic_number: number, repo: string): boolean {
	return epic_audit_logic
		.parse_issue_references(line, repo, epic_audit_logic.known_repos([], repo))
		.some((reference) => reference.repo === repo && reference.number === epic_number)
}

function claims_parent(body: string | null, epic_number: number, repo: string): boolean {
	return (body ?? '')
		.split('\n')
		.some((line) => has_parent_marker(line) && names_this_epic(line, epic_number, repo))
}

// Open issues naming this epic as their parent. Searched rather than derived, because an orphan is
// by definition absent from the one list that would otherwise name it. A failed search yields
// nothing: an unavailable search is not evidence of an orphan.
async function find_claiming_issues(epic_number: number, repo: string): Promise<Array<number>> {
	const raw = await git_gh_command.issue_search_body(`#${String(epic_number)}`, SEARCH_LIMIT)
	if (raw === undefined) return []

	return parse_json_array_safe(raw, searched_issue_schema)
		.filter((issue) => issue.number !== epic_number && claims_parent(issue.body, epic_number, repo))
		.map((issue) => issue.number)
}

// The task-list numbers that name issues in *this* repository. `snapshot.child_numbers` appends the
// cross-repository children's numbers, and an orphan is recognized by number alone — so a local
// issue whose number collided with a child in another repository was accepted as tracked and never
// reported (joshuafolkken/kit#1014). Read with the same parser `epic_fetch` reads the local rows
// with, which never matches a `- [ ] owner/repo#N` row.
function locally_tracked(snapshot: EpicSnapshot): Array<number> {
	return git_epic_parse.parse_task_list_issue_numbers(snapshot.body)
}

const epic_audit_orphans = {
	PARENT_MARKERS,
	claims_parent,
	find_claiming_issues,
	locally_tracked,
}

export { epic_audit_orphans }
