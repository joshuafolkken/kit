import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { cutoff_of, PAGE_CEILING_CAUSE, type ScanCutoff } from '#scripts/git/listing-cutoff'
import { parse_json_array_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { epic_audit_logic, type AuditFinding, type FindingLevel } from './epic-audit'
import type { EpicSnapshot } from './epic-fetch'

// Check 4's half of `epic:audit`: an issue that names this epic as its parent but that the epic's
// task list does not track. It would never be run, and the epic would close without it.
//
// Split from the command because it shares nothing with the rest of it — the other three checks read
// the children the epic already names, while this one searches for issues the epic does *not* name
// (joshuafolkken/kit#1016).

const SEARCH_LIMIT = 50
const PARENT_MARKERS: ReadonlyArray<string> = ['親:', 'Parent:', '親：']
// Named apart from `epic_audit_checks.ORPHAN_CHILD`: that check reports an orphan it found, this one
// reports that the search for orphans was incomplete, and a reader has to be able to tell them apart.
const ORPHAN_SEARCH = 'orphan search'
const UNREADABLE_SEARCH =
	'Could not list the open issues, so an issue naming this epic as its parent would not have been found.'
const CAPPED_BY_ISSUES = `The open-issue scan ${PAGE_CEILING_CAUSE}; an issue older than that was not looked at.`
const CAPPED_BY_MATCHES = `The open-issue scan filled its ${String(SEARCH_LIMIT)}-match cap; an issue mentioning this epic further down the backlog was not looked at.`

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

// Why the scan stopped before the end of the open backlog, or that it did not. Both cutoffs hide the
// same thing — an older issue naming this epic — and they are told apart only so the report can say
// which one to raise (joshuafolkken/kit#1033).
//
// The vocabulary is `listing-cutoff.ts`'s since joshuafolkken/kit#1067, because every caller of the
// listing now asks this question and a second definition of "I saw everything" is the clone
// `CLAUDE.md` prohibits. `page_ceiling` is the paging's; `row_limit` here means `SEARCH_LIMIT` body
// mentions of `#<epic>` came back and the scan stopped there.

// What the search found, and what it could not cover. The `read` / `unreadable` vocabulary is
// `git-gh-issue-read.ts`'s, and the union rather than a flag beside the numbers is deliberate: a
// cutoff on an unreadable search would describe pages that were never fetched.
type ClaimingSearch =
	{ kind: 'read'; numbers: Array<number>; cutoff: ScanCutoff } | { kind: 'unreadable' }

// Open issues naming this epic as their parent. Searched rather than derived, because an orphan is
// by definition absent from the one list that would otherwise name it.
//
// A failed search used to yield `[]` on the reasoning that an unavailable search is no evidence of
// an orphan. That is true of the *finding* and false of the *report*: `[]` is what "no issue claims
// this epic" looks like, so a rate limit arrived as a clean audit — the same "could not read" read
// as "there is nothing" that joshuafolkken/kit#925, #950, #973 and #1048 closed elsewhere. The
// answer is now carried out and reported instead (joshuafolkken/kit#1033).
async function find_claiming_issues(epic_number: number, repo: string): Promise<ClaimingSearch> {
	const { json, is_capped } = await git_gh_command.issue_search_body(
		`#${String(epic_number)}`,
		SEARCH_LIMIT,
	)
	if (json === undefined) return { kind: 'unreadable' }
	const rows = parse_json_array_safe(json, searched_issue_schema)

	const numbers = rows
		.filter((issue) => issue.number !== epic_number && claims_parent(issue.body, epic_number, repo))
		.map((issue) => issue.number)

	return { kind: 'read', numbers, cutoff: cutoff_of(rows.length, SEARCH_LIMIT, is_capped) }
}

function search_finding(level: FindingLevel, message: string): Array<AuditFinding> {
	return [{ level, check: ORPHAN_SEARCH, message }]
}

// The gap the search itself leaves, as findings, so it is never absorbed into "no orphans".
//
// An unreadable listing is an **error**: check 4 did not run at all, and an audit that reported a
// clean bill on that input would contradict itself — the same level `epic:audit` already gives a
// child it could not read, and the level a rate limit already fails this command at through that
// check.
//
// Either cutoff is a **warning**: the scan *did* run, over the newest issues, and an orphan is
// normally an issue filed minutes ago. That is something to read rather than a check that did not
// happen — the level `epic:bundle` reports its own `⚠ … cap` at (joshuafolkken/kit#950).
function search_findings(search: ClaimingSearch): Array<AuditFinding> {
	if (search.kind === 'unreadable') return search_finding('error', UNREADABLE_SEARCH)
	if (search.cutoff === 'page_ceiling') return search_finding('warning', CAPPED_BY_ISSUES)
	if (search.cutoff === 'row_limit') return search_finding('warning', CAPPED_BY_MATCHES)

	return []
}

// The numbers the orphan check compares against the task list. Empty when the search failed, which
// `search_findings` has already reported as an error — so the check contributes nothing rather than
// asserting that nothing claims the epic.
function claimed_numbers(search: ClaimingSearch): Array<number> {
	return search.kind === 'read' ? search.numbers : []
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
	ORPHAN_SEARCH,
	claimed_numbers,
	claims_parent,
	find_claiming_issues,
	locally_tracked,
	search_findings,
}

export type { ClaimingSearch }
export { epic_audit_orphans }
