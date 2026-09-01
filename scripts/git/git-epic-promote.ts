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

// Why the promoted body would not satisfy what `epic:check` reads — a task list of children and an
// unambiguous machine-readable `Dependencies` declaration — or `undefined` when it would. The label
// is applied separately by the caller.
//
// The two causes are named apart because they need different actions and only one of them is about
// the children: a declaration-shaped line already present in the issue being promoted is carried
// into the epic verbatim, and an unordered promotion then adds the `None — ...` literal beside it,
// so the body would declare an order and declare that there is none. Reported as "does not track
// every child", that state left nothing to act on (joshuafolkken/kit#1155).
function declaration_error(body: string): string | undefined {
	const state = git_epic_parse.read_declaration(body)
	if (git_epic_parse.is_declaration_readable(state)) return undefined

	return state.has_chain
		? 'The promoted body would declare an order and declare that there is none: the issue being promoted already carries a line that is only a chain (`#N -> #M`), and it contradicts the `Dependencies` section written for the epic. Reword that line first; nothing was written.'
		: 'The promoted body would carry no machine-readable `Dependencies` declaration; nothing was written.'
}

function find_tracking_error(body: string, children: ReadonlyArray<number>): string | undefined {
	const tracked = git_epic_parse.parse_task_list_issue_numbers(body)

	if (children.some((child) => !tracked.includes(child))) {
		return 'The promoted body would not track every child; nothing was written.'
	}

	return declaration_error(body)
}

const git_epic_promote = {
	EPIC_SECTION_MARKER,
	PROMOTED_HEADING,
	has_conflicting_tracking,
	conflict_reason,
	build_promoted_body,
	find_tracking_error,
}

export type { PromoteInput }
export { git_epic_promote }
