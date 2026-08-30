import { git_epic_close_comment } from './git-epic-close-comment'
import { git_epic_parse, type ExternalChild } from './git-epic-parse'
import { git_gh_command } from './git-gh-command'
import { EPIC_LABEL } from './issue-labels'
import { parse_json_array_or_undefined, parse_json_object_safe } from './parse-json-array'
import { epic_child_schema, epic_issue_schema, type EpicChildData } from './schemas'

// How many open epics the auto-close will look at, and — since joshuafolkken/kit#1025 made the
// listing REST — the only thing that bounds the request it makes. `git-gh-issue-list.ts` pages until
// `limit` rows have been selected or the backlog runs out, and its page ceiling (`MAX_PAGES`,
// joshuafolkken/kit#1033) applies to the body search alone, so without this number the check would
// read every open epic on every merge. 100 is `PER_PAGE`, which keeps the ordinary case at exactly
// one request.
//
// The listing is newest-first and the surplus is cut off the tail, so a repository holding more open
// epics than this loses the oldest — and loses them silently: nothing here compares the row count
// against the limit the way `epic:bundle` does. The `is_capped` flag the paging computes is not that
// check and answers `false` here by construction, since a listing that filled `limit` is exactly the
// case it treats as complete. That is why the value sits well above the number of epics ever open at
// once rather than close to it.
const EPIC_LIST_LIMIT = 100

interface EpicIssue {
	number: number
	children: Array<number>
	external_children: Array<ExternalChild>
	has_declared_order: boolean
}

interface SiblingState {
	is_closed: boolean
	has_blocked_by: boolean
}

function to_epic_issue(raw: { number: number; body?: string | undefined }): EpicIssue {
	return {
		number: raw.number,
		children: git_epic_parse.parse_task_list_issue_numbers(raw.body),
		external_children: git_epic_parse.parse_external_task_list_children(raw.body),
		has_declared_order: git_epic_parse.has_declared_dependency_chain(raw.body),
	}
}

// `undefined` when the listing could not be read at all — the request failed, or the answer was not
// a JSON array. Not `[]`, which is a real answer meaning no epic is open.
//
// `parse_json_array_safe` returns `[]` for both, and the auto-close then decides there is no epic to
// close: it stops for a reason that never reaches a log, and the epic stays open with nothing saying
// why. The failure leans safe — the other direction, taken by `epic:bundle`, invented a second epic
// (joshuafolkken/kit#950) — but silence is the same defect, so the two are told apart here as well
// (joshuafolkken/kit#959).
//
// The two ways of failing are folded into one answer deliberately. Which one occurred does not
// change what the auto-close may do — in neither case does it know what the open epics are — and
// splitting them would put two warnings on one decision.
async function fetch_open_epics(): Promise<Array<EpicIssue> | undefined> {
	const raw_json = await git_gh_command.issue_list_by_label(EPIC_LABEL, EPIC_LIST_LIMIT)
	if (raw_json === undefined) return undefined

	const rows = parse_json_array_or_undefined(raw_json, epic_issue_schema)

	return rows?.map((raw) => to_epic_issue(raw))
}

function parse_child(raw_json: string | undefined): EpicChildData | undefined {
	if (raw_json === undefined) return undefined

	return parse_json_object_safe(raw_json, epic_child_schema)
}

function has_blocked_by(child: EpicChildData | undefined): boolean {
	const blocked_by = child?.blockedBy

	return (blocked_by?.totalCount ?? 0) > 0
}

function to_sibling_state(raw_json: string | undefined): SiblingState {
	const child = parse_child(raw_json)

	return {
		is_closed: git_epic_parse.is_state_closed(child?.state),
		has_blocked_by: has_blocked_by(child),
	}
}

async function inspect_sibling(sibling: number, repo?: string): Promise<SiblingState> {
	return to_sibling_state(await git_gh_command.issue_get_state_and_relations(String(sibling), repo))
}

// A cross-repository child, read by naming its repository in the read's REST path. `is_readable`
// is what decides whether the epic may close at all: closing while a child's state is unknown is
// exactly what the old refusal prevented, and reading them is the only thing that changed
// (joshuafolkken/kit#864).
async function inspect_external(
	child: ExternalChild,
): Promise<SiblingState & { is_readable: boolean }> {
	const raw = await git_gh_command.issue_get_state_and_relations(String(child.number), child.repo)

	return { ...to_sibling_state(raw), is_readable: raw !== undefined }
}

// The merged Issue is excluded rather than queried: GitHub applies `closes #N` asynchronously, so
// reading its state immediately after the merge races with that propagation.
async function inspect_siblings(
	epic: EpicIssue,
	merged_number: number,
): Promise<Array<SiblingState>> {
	const siblings = epic.children.filter((child) => child !== merged_number)

	return await Promise.all(siblings.map(async (sibling) => await inspect_sibling(sibling)))
}

// #702 made recording the batch order a manual step (`gh issue edit <N> --add-blocked-by <M>`), and
// skipping it is otherwise symptomless. The epic body's declared chain is the trigger: since #713
// every split gets an epic, so its existence no longer implies an order, and warning on that alone
// would fire on every unordered batch. Only a total absence of relations is reported — checking each
// dependent pair would mean inferring the chain from task-list order, which need not match.
function warn_when_order_unrecorded(epic: EpicIssue, states: ReadonlyArray<SiblingState>): void {
	if (states.length === 0) return
	if (!epic.has_declared_order) return
	if (states.some((state) => state.has_blocked_by)) return

	console.info(
		`ℹ️  Epic #${String(epic.number)} has no blocked-by relation on any child; ` +
			'the batch order was never recorded natively (see the epic creation procedure).',
	)
}

// The one thing the two refusals below ask for, written once — a child state that could not be read,
// and a close the API refused (joshuafolkken/kit#1039).
const CLOSE_MANUALLY = 'close it manually.'

// **An unreadable comment listing does not stop the close.** It is announced and closed exactly as
// it was before the duplicate check existed, because refusing here would strand the epic: nothing
// re-triggers the auto-close once every child is closed — `resolve_and_close` only evaluates epics
// holding the issue that just merged, and that merge has already happened. One rate-limited read
// would leave a finished epic open until somebody noticed.
//
// The direction is chosen on what each mistake costs, and they are not symmetric. Announcing twice
// costs one redundant comment and nothing else, because the epic *closes* — which is what ends the
// loop joshuafolkken/kit#1039 is about, where the comment repeated once per attempt for as long as
// the close kept failing. Refusing costs a manual close on every transient failure.
const UNREADABLE_COMMENTS_NOTE =
	"'s comments could not be read; announcing again rather than leaving it open."

// The write, once the announcement has been decided. `comment` is `undefined` when the epic already
// carries one — which is what stops a run whose comment landed and whose close was refused from
// posting the same comment again on the next attempt, and again for as long as the close keeps
// failing (joshuafolkken/kit#1039).
//
// The comment-first ordering inside `issue_close` is what produces that half-succeeded state, and it
// is left exactly as it is: it is what keeps a `false` meaning "the epic is still open" in every
// branch, which is the answer the second message here is written against (joshuafolkken/kit#1026).
async function close_epic_with(epic_number: string, comment: string | undefined): Promise<void> {
	const is_closed = await git_gh_command.issue_close(epic_number, comment)

	console.info(
		is_closed
			? `🏁 Closed epic #${epic_number} — every child issue is complete.`
			: `⚠️  Could not close epic #${epic_number}; ${CLOSE_MANUALLY}`,
	)
}

// The comment listing is read **once**: only `present` skips the announcement, so an answer of
// `absent` and one of `unreadable` both post it, and the second says so.
async function close_epic(epic: EpicIssue): Promise<void> {
	const epic_number = String(epic.number)
	const state = await git_epic_close_comment.read_close_comment_state(epic_number)

	if (state === 'unreadable') console.info(`ℹ️  Epic #${epic_number}${UNREADABLE_COMMENTS_NOTE}`)

	const comment = state === 'present' ? undefined : git_epic_close_comment.build_close_comment(epic)

	await close_epic_with(epic_number, comment)
}

// The cross-repository children's states, and whether every one of them could be read. An epic with
// a child whose state is unknown keeps the old handling — left open for manual closing.
async function inspect_external_children(
	epic: EpicIssue,
): Promise<{ states: Array<SiblingState>; is_complete: boolean }> {
	if (epic.external_children.length === 0) return { states: [], is_complete: true }
	const results = await Promise.all(
		epic.external_children.map(async (child) => await inspect_external(child)),
	)

	return {
		states: results.map((result) => ({
			is_closed: result.is_closed,
			has_blocked_by: result.has_blocked_by,
		})),
		is_complete: results.every((result) => result.is_readable),
	}
}

async function close_epic_when_complete(epic: EpicIssue, merged_number: number): Promise<void> {
	const external = await inspect_external_children(epic)

	if (!external.is_complete) {
		console.info(
			`ℹ️  Epic #${String(epic.number)} has a child in another repository whose state could not be read; ${CLOSE_MANUALLY}`,
		)

		return
	}

	const states = [...(await inspect_siblings(epic, merged_number)), ...external.states]

	warn_when_order_unrecorded(epic, states)

	if (states.some((state) => !state.is_closed)) return

	await close_epic(epic)
}

// Each epic is isolated: one that cannot be read or closed must not stop the others from being
// evaluated, since they are independent batches that merely share this child.
async function close_epic_isolated(epic: EpicIssue, merged_number: number): Promise<void> {
	try {
		await close_epic_when_complete(epic, merged_number)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)

		console.info(`⚠️  Skipped epic #${String(epic.number)}: ${message}`)
	}
}

const UNREADABLE_EPIC_LIST_MESSAGE =
	'⚠️  Could not read the open epic listing; skipped the epic auto-close check.'

async function resolve_and_close(merged_number: number): Promise<void> {
	const open_epics = await fetch_open_epics()

	if (open_epics === undefined) {
		console.info(UNREADABLE_EPIC_LIST_MESSAGE)

		return
	}

	const epics = open_epics.filter((epic) => git_epic_parse.has_child(epic.children, merged_number))

	for (const epic of epics) {
		await close_epic_isolated(epic, merged_number)
	}
}

// Runs after the PR has already merged, so nothing here may reject: it would make `followup` exit
// non-zero on an otherwise successful run and read as a merge blocker.
async function resolve_and_close_safely(merged_number: number): Promise<void> {
	try {
		await resolve_and_close(merged_number)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)

		console.info(`⚠️  Skipped the epic auto-close check: ${message}`)
	}
}

/**
 * Close every open epic whose task list is fully complete once `issue_number` closed.
 *
 * Requires `is_merged`: the linked Issue is treated as closed without being queried, which only
 * holds once the PR actually merged. On a `--no-merge` run that Issue is still open, so skipping
 * this guard would close an epic whose batch is not finished.
 */
async function close_completed_epics(input: {
	issue_number: string | undefined
	is_merged: boolean
}): Promise<void> {
	if (!input.is_merged) return

	const merged_number = Number(input.issue_number)
	if (!Number.isSafeInteger(merged_number)) return

	await resolve_and_close_safely(merged_number)
}

const git_epic_close = {
	close_completed_epics,
}

export {
	git_epic_close,
	close_completed_epics,
	UNREADABLE_EPIC_LIST_MESSAGE,
	UNREADABLE_COMMENTS_NOTE,
}
export type { EpicIssue }
