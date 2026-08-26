import { git_epic_body } from './git-epic-body'
import { git_epic_parse } from './git-epic-parse'

// Promoting an existing issue into an epic.
//
// The discussion that concluded "this is really several issues" is almost always *inside* an
// existing issue, and that discussion is usually the split rationale itself. Creating a separate
// epic leaves two issues tracking one topic, so the promotion appends the epic's sections to the
// body rather than replacing it (joshuafolkken/kit#865).

const EPIC_SECTION_MARKER = '## Progress'
const PROMOTED_HEADING = '## Split into children'

interface PromoteInput {
	body: string | undefined
	children: ReadonlyArray<number>
	rationale: string
	is_ordered: boolean
	epic_number: number
	origin?: string | undefined
}

// Whether appending the epic sections would leave the body tracking two sets of children.
//
// The signal is task-list rows, not the promoted heading: an issue created by `josh epic` already
// carries a task list without ever having been promoted, and appending to it would produce two task
// lists and two contradictory `## Dependencies` sections. A pre-existing row on an ordinary issue —
// someone's `- [x] #850` checklist — is the same hazard from the other direction, since the promoted
// body keeps everything that was there and every parser scans the whole thing.
//
// Detected from the body rather than the `epic` label, which can be applied by hand without any of
// the sections.
function has_conflicting_tracking(body: string | undefined): boolean {
	if (body === undefined) return false
	if (body.includes(PROMOTED_HEADING)) return true

	return git_epic_parse.parse_task_list_issue_numbers(body).length > 0
}

// Why the promotion was refused, phrased as what was found rather than as a rule number.
function conflict_reason(body: string | undefined): string {
	if (body?.includes(PROMOTED_HEADING) === true) return 'it already carries the epic sections'
	const tracked = git_epic_parse.parse_task_list_issue_numbers(body)
	const list = tracked.map((child) => `#${String(child)}`).join(', ')

	return `its body already tracks ${list} as a task list, which would become a second child list`
}

// The promoted body: everything that was there, then the epic sections under one heading that says
// what happened. The original text is never rewritten — it is the record of why the split was made.
function build_promoted_body(input: PromoteInput): string {
	const existing = (input.body ?? '').trimEnd()
	const epic_sections = git_epic_body.build_epic_body({
		children: input.children,
		rationale: input.rationale,
		is_ordered: input.is_ordered,
		origin: input.origin,
		epic_number: input.epic_number,
	})

	return [existing, '', PROMOTED_HEADING, '', epic_sections, ''].join('\n').trimStart()
}

// Whether the promoted body satisfies what `epic:check` reads: a task list of children, and a
// machine-readable `Dependencies` declaration. The label is applied separately by the caller.
function is_tracking_complete(body: string, children: ReadonlyArray<number>): boolean {
	const tracked = git_epic_parse.parse_task_list_issue_numbers(body)
	const has_all = children.every((child) => tracked.includes(child))
	const has_dependencies =
		git_epic_parse.has_declared_dependency_chain(body) ||
		git_epic_parse.has_unordered_declaration(body)

	return has_all && has_dependencies
}

const git_epic_promote = {
	EPIC_SECTION_MARKER,
	PROMOTED_HEADING,
	has_conflicting_tracking,
	conflict_reason,
	build_promoted_body,
	is_tracking_complete,
}

export type { PromoteInput }
export { git_epic_promote }
