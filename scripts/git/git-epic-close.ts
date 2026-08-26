import { git_epic_parse, type ExternalChild } from './git-epic-parse'
import { git_gh_command } from './git-gh-command'
import { EPIC_LABEL } from './issue-labels'
import { parse_json_array_safe, parse_json_object_safe } from './parse-json-array'
import { epic_child_schema, epic_issue_schema, type EpicChildData } from './schemas'

// `gh issue list` defaults to 30 rows. Epics are few, but an implicit cap would silently skip the
// oldest ones, so the limit is stated rather than inherited.
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

async function fetch_open_epics(): Promise<Array<EpicIssue>> {
	const raw_json = await git_gh_command.issue_list_by_label(EPIC_LABEL, EPIC_LIST_LIMIT)
	if (raw_json === undefined) return []

	return parse_json_array_safe(raw_json, epic_issue_schema).map((raw) => to_epic_issue(raw))
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

// A cross-repository child, read through `gh --repo`. `is_readable` is what decides whether the epic
// may close at all: closing while a child's state is unknown is exactly what the old refusal
// prevented, and reading them is the only thing that changed (joshuafolkken/kit#864).
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

// Every child, near and far. Listing only the local ones left an all-external epic announcing "All
// child issues are closed ()" (joshuafolkken/kit#864).
function build_close_comment(epic: EpicIssue): string {
	const list = [
		...epic.children.map((child) => `#${String(child)}`),
		...epic.external_children.map((child) => `${child.repo}#${String(child.number)}`),
	].join(', ')

	return `All child issues are closed (${list}). Closing this epic automatically.`
}

async function close_epic(epic: EpicIssue): Promise<void> {
	const epic_number = String(epic.number)
	const is_closed = await git_gh_command.issue_close(epic_number, build_close_comment(epic))

	console.info(
		is_closed
			? `🏁 Closed epic #${epic_number} — every child issue is complete.`
			: `⚠️  Could not close epic #${epic_number}; close it manually.`,
	)
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
			`ℹ️  Epic #${String(epic.number)} has a child in another repository whose state could not be read; close it manually.`,
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

async function resolve_and_close(merged_number: number): Promise<void> {
	const open_epics = await fetch_open_epics()
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

export { git_epic_close, close_completed_epics }
export type { EpicIssue }
