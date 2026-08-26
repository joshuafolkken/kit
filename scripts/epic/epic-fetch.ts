import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import type { EpicChild } from './epic-graph'
import { epic_issue, type EpicIssue } from './epic-issue'

// Reading an epic and its children from GitHub.
//
// All execution state lives on GitHub and nowhere else — no local state file. A run interrupted
// halfway is resumed by asking again, which is the whole reason `epic:next` can be the base of an
// unattended run (joshuafolkken/kit#860).

const CHILD_LIMIT = 200

function to_child(parsed: EpicIssue, repo: string): EpicChild {
	return {
		number: parsed.number,
		repo,
		state: epic_issue.normalize_state(parsed.state),
		labels: epic_issue.label_names(parsed),
		blocked_by: epic_issue.blockers_of(parsed),
	}
}

// One child's state, labels and native relations. A child that cannot be read is reported as
// missing rather than assumed closed: assuming would let an epic advance past a child nobody looked
// at.
async function fetch_child(issue_number: number, repo: string): Promise<EpicChild | undefined> {
	const raw = await git_gh_command.issue_get_state_and_relations(String(issue_number))
	const parsed = epic_issue.parse_epic_issue(raw)
	if (parsed === undefined) return undefined

	return to_child(parsed, repo)
}

// What a batch read produced, with the children it could not read kept rather than dropped.
//
// Dropping them is not an option in either direction. An epic whose children all failed to read
// would otherwise look like an epic with no open children — "complete" — and a single unreadable
// child would vanish from the graph, so whatever it blocks would look unblocked and be run
// (joshuafolkken/kit#860).
interface FetchedChildren {
	children: ReadonlyArray<EpicChild>
	unreadable: ReadonlyArray<number>
	skipped: ReadonlyArray<number>
}

// Every child the epic's task list tracks, in the order the body lists them.
async function fetch_children(
	child_numbers: ReadonlyArray<number>,
	repo: string,
): Promise<FetchedChildren> {
	const limited = child_numbers.slice(0, CHILD_LIMIT)
	const fetched = await Promise.all(
		limited.map(async (issue_number) => await fetch_child(issue_number, repo)),
	)

	return {
		children: fetched.filter((child): child is EpicChild => child !== undefined),
		unreadable: limited.filter((_, index) => fetched[index] === undefined),
		skipped: child_numbers.slice(CHILD_LIMIT),
	}
}

interface EpicSnapshot {
	body: string | undefined
	children: ReadonlyArray<EpicChild>
	child_numbers: ReadonlyArray<number>
	unreadable: ReadonlyArray<number>
	skipped: ReadonlyArray<number>
	has_external_children: boolean
}

// The epic and its children, as one read. `has_external_children` is surfaced rather than silently
// ignored: a cross-repository child needs joshuafolkken/kit#864, and an epic that holds one is not
// fully answered by this command yet.
async function fetch_epic(epic_number: number, repo: string): Promise<EpicSnapshot> {
	const body = await git_gh_command.issue_get_body(String(epic_number))
	const child_numbers = git_epic_parse.parse_task_list_issue_numbers(body)
	const fetched = await fetch_children(child_numbers, repo)

	return {
		body,
		children: fetched.children,
		child_numbers,
		unreadable: fetched.unreadable,
		skipped: fetched.skipped,
		has_external_children: git_epic_parse.has_external_task_list_entry(body),
	}
}

const epic_fetch = {
	CHILD_LIMIT,
	fetch_child,
	fetch_children,
	fetch_epic,
}

export type { EpicSnapshot }
export { epic_fetch }
