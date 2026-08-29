import { git_epic_parse, type ExternalChild } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { epic_cross_repo } from './epic-cross-repo'
import type { EpicChild, IssueReference } from './epic-graph'
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

// The `--repo` scope a child is read through, in the one place that decides it.
//
// A child in the repository the command runs in is read unqualified — exactly as `fetch_children`
// reads it — and a child elsewhere is read through its own repository, exactly as
// `fetch_external_children` does. Every read of a child's fields goes through this, bodies included:
// an unqualified read of a cross-repository child returns *this* repository's issue of that number,
// a different issue entirely (joshuafolkken/kit#1012).
function scope_for(child_repo: string, current_repo: string): string | undefined {
	return child_repo === current_repo ? undefined : child_repo
}

// Numbers read from one repository's task-list rows, as references to issues in that repository.
function to_references(issue_numbers: ReadonlyArray<number>, repo: string): Array<IssueReference> {
	return issue_numbers.map((issue_number) => ({ repo, number: issue_number }))
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
//
// The unread ones carry their repository, not just their number. An epic tracking
// `- [ ] sveltejs/kit#7` had it refused by the owner restriction and reported as `Could not read #7`,
// which a reader resolves against the repository they are standing in — a different issue
// (joshuafolkken/kit#1016).
interface FetchedChildren {
	children: ReadonlyArray<EpicChild>
	unreadable: ReadonlyArray<IssueReference>
	skipped: ReadonlyArray<IssueReference>
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
		unreadable: to_references(
			limited.filter((_, index) => fetched[index] === undefined),
			repo,
		),
		skipped: to_references(child_numbers.slice(CHILD_LIMIT), repo),
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
		unreadable: [...allowed.filter((_, index) => fetched[index] === undefined), ...refused],
		skipped: [],
	}
}

interface EpicSnapshot {
	body: string | undefined
	// The `owner/repo` the command is running in — the repository against which a reference is written
	// bare, and every other one written `owner/repo#N`. Deliberately *not* where the epic lives:
	// `epic:next owner/other#858` reads an epic elsewhere while the person reading the answer is
	// standing here, so writing an unread child bare would send them to their own issue of that number
	// (joshuafolkken/kit#1016).
	current_repo: string
	children: ReadonlyArray<EpicChild>
	child_numbers: ReadonlyArray<number>
	unreadable: ReadonlyArray<IssueReference>
	skipped: ReadonlyArray<IssueReference>
	has_external_children: boolean
}

// The epic and its children, as one read. `has_external_children` is surfaced rather than silently
// ignored: a cross-repository child needs joshuafolkken/kit#864, and an epic that holds one is not
// fully answered by this command yet.
//
// `repo` is where the *epic* lives and `current_repo` is where the command is running, so the body
// and its local rows are read through the same `scope_for` every other read goes through. Read
// unqualified, `epic:next joshuafolkken/app-kit#858` answered from *this* repository's issue 858 and
// then stamped the children it found there as app-kit's — and since joshuafolkken/kit#1016 makes
// `repo` decide how an unread child is written, that mislabelling reached the message too. The
// default keeps a command whose epic is always local reading exactly as before.
async function fetch_epic(
	epic_number: number,
	repo: string,
	current_repo: string = repo,
): Promise<EpicSnapshot> {
	const scope = scope_for(repo, current_repo)
	const body = await git_gh_command.issue_get_body(String(epic_number), scope)
	const child_numbers = git_epic_parse.parse_task_list_issue_numbers(body)
	const external = git_epic_parse.parse_external_task_list_children(body)
	// joshuafolkken/kit#869's restriction is about who *we* are, so the owner comes from the repository
	// the command runs in. Derived from the epic's own repository instead, a qualified reference to
	// somebody else's epic would have made their whole organization readable.
	const owner = epic_cross_repo.owner_of(current_repo)
	const local = await fetch_children(child_numbers, repo, scope)
	const remote = await fetch_external_children(external, owner)

	return {
		body,
		current_repo,
		children: [...local.children, ...remote.children],
		child_numbers: [...child_numbers, ...external.map((child) => child.number)],
		unreadable: [...local.unreadable, ...remote.unreadable],
		skipped: local.skipped,
		has_external_children: external.length > 0,
	}
}

// Everything the fetch produced no child for: the reads that failed and the rows past the limit.
// Both leave the graph missing a node in the same way, and `epic:next` and `epic:audit` each report
// the pair together — one definition rather than the same concatenation written in both.
function missing_children(snapshot: EpicSnapshot): Array<IssueReference> {
	return [...snapshot.unreadable, ...snapshot.skipped]
}

const epic_fetch = {
	CHILD_LIMIT,
	scope_for,
	missing_children,
	fetch_child,
	fetch_children,
	fetch_epic,
}

export type { EpicSnapshot }
export { epic_fetch }
