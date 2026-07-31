import { git_epic_parse } from './git-epic-parse'
import { git_gh_command } from './git-gh-command'
import { parse_json_array_safe, parse_json_object_safe } from './parse-json-array'
import { epic_child_schema, epic_issue_schema, type EpicChildData } from './schemas'

const EPIC_LABEL = 'epic'

// `gh issue list` defaults to 30 rows. Epics are few, but an implicit cap would silently skip the
// oldest ones, so the limit is stated rather than inherited.
const EPIC_LIST_LIMIT = 100

interface EpicIssue {
	number: number
	children: Array<number>
	has_external_child: boolean
}

interface SiblingState {
	is_closed: boolean
	has_blocked_by: boolean
}

function to_epic_issue(raw: { number: number; body?: string | undefined }): EpicIssue {
	return {
		number: raw.number,
		children: git_epic_parse.parse_task_list_issue_numbers(raw.body),
		has_external_child: git_epic_parse.has_external_task_list_entry(raw.body),
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

async function inspect_sibling(sibling: number): Promise<SiblingState> {
	return to_sibling_state(await git_gh_command.issue_get_state_and_relations(String(sibling)))
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
// skipping it is otherwise symptomless. Only a total absence is reported: an epic exists only for an
// ordered batch, so zero relations is unambiguous, whereas checking each dependent pair would mean
// inferring the chain from task-list order, which is not guaranteed to match.
function warn_when_order_unrecorded(epic: EpicIssue, states: ReadonlyArray<SiblingState>): void {
	if (states.length === 0) return
	if (states.some((state) => state.has_blocked_by)) return

	console.info(
		`ℹ️  Epic #${String(epic.number)} has no blocked-by relation on any child; ` +
			'the batch order was never recorded natively (see the epic creation procedure).',
	)
}

function build_close_comment(epic: EpicIssue): string {
	const list = epic.children.map((child) => `#${String(child)}`).join(', ')

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

async function close_epic_when_complete(epic: EpicIssue, merged_number: number): Promise<void> {
	if (epic.has_external_child) {
		console.info(
			`ℹ️  Epic #${String(epic.number)} tracks a child in another repository; close it manually.`,
		)

		return
	}

	const states = await inspect_siblings(epic, merged_number)

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
