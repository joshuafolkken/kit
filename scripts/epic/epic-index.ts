import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { EPIC_LABEL, has_any_label } from '#scripts/git/issue-labels'
import { cutoff_of, type ScanCutoff } from '#scripts/git/listing-cutoff'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import type { OpenIssueData } from '#scripts/git/schemas'
import { z } from 'zod'

// Which epic tracks which issue — the one answer, in one place (joshuafolkken/kit#1633).
//
// `epic:bundle` has asked it since joshuafolkken/kit#873, to keep an issue an epic already tracks
// from being recommended a second one. The `auto-ok` pickup needs the same answer for the opposite
// reason: an issue tracked by an epic that will offer it must run through that epic's order and
// never be picked up standalone. Two callers, one question, so the read and the index live here
// rather than in either command — a second copy would drift the first time the task-list shape
// moved. `withheld_children` below is where the *second* half of that answer lives: which of the
// tracked children the standalone half actually has to hold back.

const epic_schema = z.object({ number: z.number(), body: z.string().nullable() })

interface FetchedEpics {
	epics: Array<{ number: number; body: string }>
	// The listing can be cut short. An epic past the cut is invisible, so an issue it tracks reads as
	// tracked by nothing — which is a duplicate epic for `epic:bundle` and an out-of-order run for the
	// `auto-ok` pickup. Both callers report it rather than answering as if the listing were complete.
	cutoff: ScanCutoff
}

// Which epics track each issue, from the epics' own task lists. **A child can be named by more than
// one** (joshuafolkken/kit#1694): a task list expresses at most one epic per row, and nothing stops
// two epics writing the same row — `epic_lane_offer.dedupe_pools` has handled exactly that collision
// on the `epic:next` side since it was written. So the tracking is recorded whole here, and each
// caller collapses it for its own question rather than losing the other epics at build time.
//
// A child a single epic lists twice repeats that epic's number, which neither caller distinguishes
// from listing it once.
function build_tracking_index(
	epics: ReadonlyArray<{ number: number; body: string }>,
): Map<number, ReadonlyArray<number>> {
	const index = new Map<number, ReadonlyArray<number>>()

	for (const epic of epics) {
		for (const child of git_epic_parse.parse_task_list_issue_numbers(epic.body)) {
			index.set(child, [...(index.get(child) ?? []), epic.number])
		}
	}

	return index
}

// Which *one* epic tracks each issue — `epic:bundle`'s question, which asks whether the issue is
// already in an epic and names it. The last epic to list the child wins, exactly as it did when this
// was built by a single `index.set` per row, so a collision answers as it always has.
function build_epic_index(
	epics: ReadonlyArray<{ number: number; body: string }>,
): Map<number, number> {
	const index = new Map<number, number>()

	for (const [child, tracked_by] of build_tracking_index(epics)) {
		const winner = tracked_by.at(-1)
		if (winner !== undefined) index.set(child, winner)
	}

	return index
}

const EPIC_LABELS: ReadonlySet<string> = new Set([EPIC_LABEL])

// Which epics in the opted-in listing stand for their children. An epic that carries `auto-ok` is a
// row of that listing which also carries `epic`, so no second read of an epic's labels is made.
function opted_in_epic_numbers(issues: ReadonlyArray<OpenIssueData>): ReadonlySet<number> {
	return new Set(
		issues.filter((issue) => has_any_label(issue.labels, EPIC_LABELS)).map((issue) => issue.number),
	)
}

// **Which wins when an epic's declared order and a child's own `auto-ok` disagree — the single
// source** (joshuafolkken/kit#1668, narrowing joshuafolkken/kit#1633).
//
// The epic wins wherever the epic is actually going to offer the child, and only there. So the
// standalone half withholds a tracked child when the epic tracking it carries `auto-ok`: that epic's
// `blocked-by` graph sequences its children, and offering the child standalone as well would both
// skip that order and hand the same issue over twice.
//
// It withholds nothing when the tracking epic is **not** opted in. joshuafolkken/kit#1633 dropped
// that child too, on the ground that the standalone path read none of the ordering graph — which has
// since stopped being true: `auto_ok_cli.is_runnable` refuses a candidate whose `blockedBy` is still
// open, and `josh epic --ordered` records an epic's declared order as exactly those native
// relations. So the order survives the standalone route, while the old rule left a person's `auto-ok`
// on the child silently inert — no path offered it at all, because the epic side never reads an epic
// that did not opt in.
// **It answers with the epic, not merely with membership**, because the withholding and the sentence
// `backlog:plan` prints about it have to come from one answer. Handing the scope layer the whole
// index instead let it name an epic that was not withholding anything — the same misreport, moved.
//
// **Any one opted-in epic withholds the child** (joshuafolkken/kit#1694). It reads the whole tracking
// rather than one collapsed winner because the two are not the same answer when two epics name the
// same child: collapsed, an opted-in epic that merely came earlier in the listing is gone, the child
// reads as tracked by nobody who would offer it, and the standalone half hands it over while the
// opted-in epic hands it over too. The epic named as the reason is the first opted-in one in listing
// order — any of them is withholding it, and picking by position keeps the sentence deterministic.
function withheld_children(
	index: ReadonlyMap<number, ReadonlyArray<number>>,
	opted_in: ReadonlyArray<OpenIssueData>,
): ReadonlyMap<number, number> {
	const epics = opted_in_epic_numbers(opted_in)
	const withheld = new Map<number, number>()

	for (const [child, tracked_by] of index) {
		const epic = tracked_by.find((candidate) => epics.has(candidate))
		if (epic !== undefined) withheld.set(child, epic)
	}

	return withheld
}

// The epics currently open, so an issue can be matched to the one already tracking it.
//
// A failed read is reported rather than treated as "there are no epics": without the list, every
// tracked child reads as untracked, and both callers then act confidently on an answer built from a
// response nobody parsed.
async function fetch_epics(limit: number): Promise<FetchedEpics | undefined> {
	const { json, is_capped } = await git_gh_command.issue_list_by_label(EPIC_LABEL, limit)
	if (json === undefined) return undefined
	// Not `parse_json_array_safe`: it answers `[]` for a response that is not JSON at all, which is
	// indistinguishable from "no epics are open" — the silent absence this whole rule is about.
	const rows = parse_json_array_or_undefined(json, epic_schema)
	if (rows === undefined) return undefined

	return {
		cutoff: cutoff_of(rows.length, limit, is_capped),
		epics: rows.map((row) => ({ number: row.number, body: row.body ?? '' })),
	}
}

const epic_index = {
	build_epic_index,
	build_tracking_index,
	fetch_epics,
	opted_in_epic_numbers,
	withheld_children,
}

export { epic_index, epic_schema }
export type { FetchedEpics }
