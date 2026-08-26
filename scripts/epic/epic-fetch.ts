import { git_epic_parse, type ExternalChild } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { epic_cross_repo } from './epic-cross-repo'
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
async function fetch_child(
	issue_number: number,
	repo: string,
	scope?: string,
): Promise<EpicChild | undefined> {
	const raw = await git_gh_command.issue_get_state_and_relations(String(issue_number), scope)
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
	scope?: string,
): Promise<FetchedChildren> {
	const limited = child_numbers.slice(0, CHILD_LIMIT)
	const fetched = await Promise.all(
		limited.map(async (issue_number) => await fetch_child(issue_number, repo, scope)),
	)

	return {
		children: fetched.filter((child): child is EpicChild => child !== undefined),
		unreadable: limited.filter((_, index) => fetched[index] === undefined),
		skipped: child_numbers.slice(CHILD_LIMIT),
	}
}

// The children that live in other repositories, read through `gh --repo`. No local checkout is
// needed: their state is a GitHub fact, and requiring a clone to learn it is what kept the auto-close
// from ever running on such an epic (joshuafolkken/kit#864).
//
// A repository with a different owner is dropped before it is read, inheriting
// joshuafolkken/kit#869's restriction rather than restating it.
async function fetch_external_children(
	external: ReadonlyArray<ExternalChild>,
	current_owner: string,
): Promise<FetchedChildren> {
	const allowed = external.filter((child) =>
		epic_cross_repo.is_same_owner_repo(child.repo, current_owner),
	)
	const fetched = await Promise.all(
		allowed.map(async (child) => await fetch_child(child.number, child.repo, child.repo)),
	)

	// A repository the owner restriction refused is reported as unreadable rather than dropped: an
	// epic must not read as complete while a child nobody may look at is still open.
	const refused = external.filter(
		(child) => !epic_cross_repo.is_same_owner_repo(child.repo, current_owner),
	)

	return {
		children: fetched.filter((child): child is EpicChild => child !== undefined),
		unreadable: [
			...allowed.filter((_, index) => fetched[index] === undefined).map((child) => child.number),
			...refused.map((child) => child.number),
		],
		skipped: [],
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
	const external = git_epic_parse.parse_external_task_list_children(body)
	const owner = repo.split('/', 1)[0] ?? ''
	const local = await fetch_children(child_numbers, repo)
	const remote = await fetch_external_children(external, owner)

	return {
		body,
		children: [...local.children, ...remote.children],
		child_numbers: [...child_numbers, ...external.map((child) => child.number)],
		unreadable: [...local.unreadable, ...remote.unreadable],
		skipped: local.skipped,
		has_external_children: external.length > 0,
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
