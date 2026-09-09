import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { EPIC_LABEL } from '#scripts/git/issue-labels'
import { cutoff_of, type ScanCutoff } from '#scripts/git/listing-cutoff'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// Which epic tracks which issue — the one answer, in one place (joshuafolkken/kit#1633).
//
// `epic:bundle` has asked it since joshuafolkken/kit#873, to keep an issue an epic already tracks
// from being recommended a second one. The `auto-ok` pickup needs the same answer for the opposite
// reason: an issue an epic tracks must run through that epic's order and never be picked up
// standalone. Two callers, one question, so the read and the index live here rather than in either
// command — a second copy would drift the first time the task-list shape moved.

const epic_schema = z.object({ number: z.number(), body: z.string().nullable() })

interface FetchedEpics {
	epics: Array<{ number: number; body: string }>
	// The listing can be cut short. An epic past the cut is invisible, so an issue it tracks reads as
	// tracked by nothing — which is a duplicate epic for `epic:bundle` and an out-of-order run for the
	// `auto-ok` pickup. Both callers report it rather than answering as if the listing were complete.
	cutoff: ScanCutoff
}

// Which epic tracks each issue, from the epics' own task lists. An issue belongs to at most one,
// because that is what a task list can express.
function build_epic_index(
	epics: ReadonlyArray<{ number: number; body: string }>,
): Map<number, number> {
	const index = new Map<number, number>()

	for (const epic of epics) {
		for (const child of git_epic_parse.parse_task_list_issue_numbers(epic.body)) {
			index.set(child, epic.number)
		}
	}

	return index
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
	fetch_epics,
}

export { epic_index, epic_schema }
export type { FetchedEpics }
