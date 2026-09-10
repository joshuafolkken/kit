import { git_epic_parse, type ExternalChild } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import type { IssueReadFailure } from '#scripts/git/git-gh-issue-read'
import { epic_cross_repo } from './epic-cross-repo'
import type { EpicChild, IssueReference } from './epic-graph'
import { epic_issue, type EpicIssue } from './epic-issue'
import { epic_relation_recheck } from './epic-relation-recheck'

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
		blocked_by: epic_issue.blocker_references_of(parsed, repo),
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

// One child's blockers, read from the relations listing rather than from the issue's own summary
// count (joshuafolkken/kit#1113). Addressed through the same `scope_for` every other read of a child
// goes through. The recheck only ever reaches children of the epic's own repository, so what the
// scope varies with is where the *epic* is: `epic:next owner/other#858` run from here reads them
// through `owner/other`, and reading them unqualified would answer from this repository's issues of
// those numbers instead (joshuafolkken/kit#1012).
async function read_child_blockers(
	child: EpicChild,
	current_repo: string,
): Promise<Array<IssueReference>> {
	return await git_gh_command.issue_blocked_by_references(
		String(child.number),
		child.repo,
		scope_for(child.repo, current_repo),
	)
}

// The epic's own row, read once and parsed once: the body every later step consults, the bare
// numbers naming children in the epic's repository, and the qualified rows naming children elsewhere.
interface EpicBody {
	body: string | undefined
	// Why the body produced nothing, when it produced nothing. **The epic's body is the one read whose
	// failure is invisible downstream**: `parse_task_list_issue_numbers(undefined)` answers `[]`, so a
	// body nobody could read is indistinguishable from an epic that tracks no children — and that one
	// is dropped from the views as an ordinary, unpopulated epic. A run whose DNS hiccuped on this one
	// request therefore reported the backlog empty and ended (joshuafolkken/kit#1690).
	body_failure: IssueReadFailure | undefined
	child_numbers: ReadonlyArray<number>
	external: ReadonlyArray<ExternalChild>
}

async function fetch_epic_body(epic_number: number, scope?: string): Promise<EpicBody> {
	const read = await git_gh_command.issue_get_body_classified(String(epic_number), scope)
	const body = read.kind === 'read' ? read.text : undefined

	return {
		body,
		body_failure: read.kind === 'read' ? undefined : read,
		child_numbers: git_epic_parse.parse_task_list_issue_numbers(body),
		external: git_epic_parse.parse_external_task_list_children(body),
	}
}

// What the recheck needs to know about the read it is correcting: the epic's body, the repository
// its bare declared numbers name, and the repository the command runs in.
interface RecheckScope {
	body: string | undefined
	repo: string
	current_repo: string
}

// joshuafolkken/kit#1113: the second look at the relations, taken here rather than in `epic:next`
// and `epic:audit` separately — both read their children through this one snapshot, so correcting it
// once corrects both, and neither command needs to know the check exists.
// `repo` is the epic's own repository, which is what a bare declared number names — not
// `current_repo`, which is where the command happens to be running.
async function rechecked_children(
	children: ReadonlyArray<EpicChild>,
	snapshot: RecheckScope,
): Promise<ReadonlyArray<EpicChild>> {
	return await epic_relation_recheck.recheck_missing_relations(
		children,
		snapshot.body,
		snapshot.repo,
		async (child) => await read_child_blockers(child, snapshot.current_repo),
	)
}

// Numbers read from one repository's task-list rows, as references to issues in that repository.
function to_references(issue_numbers: ReadonlyArray<number>, repo: string): Array<IssueReference> {
	return issue_numbers.map((issue_number) => ({ repo, number: issue_number }))
}

// One child's read: the child when it came back, and whether the failure was one the same request
// could succeed at a moment later (joshuafolkken/kit#1690). A response that arrived and would not
// parse is **not** unreachable — asking again answers the same thing.
interface ChildRead {
	child: EpicChild | undefined
	is_unreachable: boolean
}

async function fetch_child_read(
	issue_number: number,
	repo: string,
	scope?: string,
): Promise<ChildRead> {
	const read = await git_gh_command.issue_get_state_and_relations_classified(
		String(issue_number),
		scope,
	)

	if (read.kind !== 'read') {
		return { child: undefined, is_unreachable: git_gh_command.is_unreachable_read(read) }
	}

	const parsed = epic_issue.parse_epic_issue(read.json)

	return { child: parsed === undefined ? undefined : to_child(parsed, repo), is_unreachable: false }
}

// One child's state, labels and native relations. A child that cannot be read is reported as
// missing rather than assumed closed: assuming would let an epic advance past a child nobody looked
// at.
async function fetch_child(
	issue_number: number,
	repo: string,
	scope?: string,
): Promise<EpicChild | undefined> {
	const read = await fetch_child_read(issue_number, repo, scope)

	return read.child
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
	// How many of the unreadable ones failed on the transport. Carried from the reads themselves
	// rather than probed afterwards: a connection that dropped for a moment fails a read at t=0 and
	// answers a probe fired at t=1 that everything is fine (joshuafolkken/kit#1690).
	//
	// **A count rather than a flag, because the question the caller asks is about _every_ failure.**
	// One child unreachable beside another permanently refused is not a run worth repeating — the
	// refused one answers the same however often it is asked — so a flag ORed across the groups would
	// answer `retry` for ever and never reach the verdict that says a person is needed.
	unreachable_count: number
}

function to_children(reads: ReadonlyArray<ChildRead>): Array<EpicChild> {
	return reads.map((read) => read.child).filter((child): child is EpicChild => child !== undefined)
}

function count_unreachable(reads: ReadonlyArray<ChildRead>): number {
	return reads.filter((read) => read.is_unreachable).length
}

function is_body_unreachable(failure: IssueReadFailure | undefined): boolean {
	return failure !== undefined && git_gh_command.is_unreachable_read(failure)
}

// Every child the epic's task list tracks, in the order the body lists them.
async function fetch_children(
	child_numbers: ReadonlyArray<number>,
	repo: string,
	scope?: string,
): Promise<FetchedChildren> {
	const limited = child_numbers.slice(0, CHILD_LIMIT)
	const reads = await Promise.all(
		limited.map(async (issue_number) => await fetch_child_read(issue_number, repo, scope)),
	)

	return {
		children: to_children(reads),
		unreadable: to_references(
			limited.filter((_, index) => reads[index]?.child === undefined),
			repo,
		),
		skipped: to_references(child_numbers.slice(CHILD_LIMIT), repo),
		unreachable_count: count_unreachable(reads),
	}
}

// The children that live in other repositories, read by naming that repository in the read's REST
// path (`repos/<owner>/<repo>/issues/<n>`). No local checkout is needed: their state is a GitHub
// fact, and requiring a clone to learn it is what kept the auto-close from ever running on such an
// epic (joshuafolkken/kit#864).
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
	const reads = await Promise.all(
		allowed.map(async (child) => await fetch_child_read(child.number, child.repo, child.repo)),
	)

	// A repository the owner restriction refused is reported as unreadable rather than dropped: an
	// epic must not read as complete while a child nobody may look at is still open.
	const refused = external.filter(
		(child) => !epic_cross_repo.is_same_owner_repo(child.repo, current_owner),
	)

	return {
		children: to_children(reads),
		unreadable: [...allowed.filter((_, index) => reads[index]?.child === undefined), ...refused],
		skipped: [],
		// A refusal is not a transport failure: the owner restriction answers the same tomorrow.
		unreachable_count: count_unreachable(reads),
	}
}

interface EpicSnapshot {
	body: string | undefined
	// The repository the *epic* lives in — what a bare number in its body and in a declared dependency
	// names. Distinct from `current_repo` below, which is where the command is running
	// (joshuafolkken/kit#1126).
	repo: string
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
	// Why the epic's own body produced nothing, when it produced nothing (joshuafolkken/kit#1690).
	body_failure: IssueReadFailure | undefined
	// Whether **every** read behind this snapshot that failed — the body and each child — failed on
	// the transport, and at least one did. What a caller does with it is its own: `epic:next` marks
	// the anomaly with it, and `backlog:next` asks again instead of reporting the backlog empty.
	//
	// It is `every` rather than `any` so the answer terminates: one child refused for good beside one
	// unreachable would otherwise be retried for ever, and the run would never reach the verdict that
	// says a person is needed (joshuafolkken/kit#1690).
	is_unreachable: boolean
}

// The failed reads behind one snapshot, and how many of them are worth asking about again.
function to_failure_counts(
	body_failure: IssueReadFailure | undefined,
	groups: ReadonlyArray<FetchedChildren>,
): { failed: number; unreachable: number } {
	const body_failed = body_failure === undefined ? 0 : 1

	return {
		failed: body_failed + groups.reduce((total, group) => total + group.unreadable.length, 0),
		unreachable:
			(is_body_unreachable(body_failure) ? 1 : 0) +
			groups.reduce((total, group) => total + group.unreachable_count, 0),
	}
}

function is_snapshot_unreachable(
	body_failure: IssueReadFailure | undefined,
	groups: ReadonlyArray<FetchedChildren>,
): boolean {
	const counts = to_failure_counts(body_failure, groups)

	return counts.failed > 0 && counts.failed === counts.unreachable
}

// The snapshot the two reads add up to, with the relations looked at a second time where a declared
// link says one is missing. Split from the reads above so `fetch_epic` stays a list of requests.
async function to_snapshot(
	epic_body: EpicBody,
	scope: { repo: string; current_repo: string },
	local: FetchedChildren,
	remote: FetchedChildren,
): Promise<EpicSnapshot> {
	const { body, body_failure, child_numbers, external } = epic_body
	const children = await rechecked_children([...local.children, ...remote.children], {
		body,
		...scope,
	})

	return {
		body,
		repo: scope.repo,
		current_repo: scope.current_repo,
		children,
		child_numbers: [...child_numbers, ...external.map((child) => child.number)],
		unreadable: [...local.unreadable, ...remote.unreadable],
		skipped: local.skipped,
		has_external_children: external.length > 0,
		body_failure,
		is_unreachable: is_snapshot_unreachable(body_failure, [local, remote]),
	}
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
	const epic_body = await fetch_epic_body(epic_number, scope)
	// joshuafolkken/kit#869's restriction is about who *we* are, so the owner comes from the repository
	// the command runs in. Derived from the epic's own repository instead, a qualified reference to
	// somebody else's epic would have made their whole organization readable.
	const owner = epic_cross_repo.owner_of(current_repo)
	const local = await fetch_children(epic_body.child_numbers, repo, scope)
	const remote = await fetch_external_children(epic_body.external, owner)

	return await to_snapshot(epic_body, { repo, current_repo }, local, remote)
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
	read_child_blockers,
	missing_children,
	fetch_child,
	fetch_children,
	fetch_epic,
}

export type { EpicSnapshot }
export { epic_fetch }
