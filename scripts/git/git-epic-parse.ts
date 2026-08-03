// An epic Issue tracks its children as a markdown task list (`- [ ] #101`). Only that syntax
// counts as tracked: GitHub auto-checks such an entry when the referenced Issue closes, whereas a
// bare `#101` reference produces a cross-link with no progress tracking.
const TASK_LIST_ISSUE_PATTERN = /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+#(\d+)\b/gmu

// A task list may also reference an Issue in another repository (`owner/repo#101`, or a full URL).
// Those are deliberately not resolved: their state would need a different `--repo`, and silently
// ignoring them would let an epic close while such a child is still open.
const EXTERNAL_TASK_LIST_PATTERN =
	/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+(?:[\w.-]+\/[\w.-]+#\d+|https?:\/\/)/mu

// Fenced blocks are stripped before matching. An epic body may quote the body template itself, and
// its sample rows (`- [ ] #101 <title>`) are illustrations, not tracked children — counting them
// would attach a nonexistent Issue to the batch and keep the epic open forever.
const FENCE_LINE_PATTERN = /^[ \t]*(?:`{3,}|~{3,})/u

// An epic is created for every split, so its existence no longer implies an ordered batch. The
// declaration in its body is what distinguishes "the order was never recorded" from "there is no
// order": a chain between two Issue references (`#101 -> #102`, or the arrow written as `→`). The
// shape of the chain is not validated — only that one was declared at all.
const DEPENDENCY_CHAIN_PATTERN = /#\d+[ \t]*(?:->|→)[ \t]*#\d+/u

// The other half of a machine-readable `Dependencies` section: the exact sentence that declares a
// batch to have no order. It lives here, beside the chain pattern, because both are what a reader
// of the body is allowed to rely on — the generator imports this rather than restating it, so the
// text it writes and the text checked for are one string.
const UNORDERED_DEPENDENCIES = 'None — the children are independent; any execution order works.'

const CLOSED_STATE = 'CLOSED'

// Toggling on each fence line keeps this linear — a single regex spanning the block would backtrack.
// An unterminated fence swallows the rest of the body, which fails safe: fewer children means the
// epic is simply never matched, and it stays open for manual closing.
function strip_fenced_blocks(body: string): string {
	const kept: Array<string> = []
	let is_inside_fence = false

	for (const line of body.split('\n')) {
		if (FENCE_LINE_PATTERN.test(line)) {
			is_inside_fence = !is_inside_fence
		} else if (!is_inside_fence) {
			kept.push(line)
		}
	}

	return kept.join('\n')
}

function to_issue_number(match: RegExpMatchArray): number | undefined {
	const [, raw] = match
	if (raw === undefined) return undefined

	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) ? parsed : undefined
}

function parse_task_list_issue_numbers(body: string | undefined): Array<number> {
	if (body === undefined) return []

	const numbers = Array.from(strip_fenced_blocks(body).matchAll(TASK_LIST_ISSUE_PATTERN), (match) =>
		to_issue_number(match),
	).filter((value): value is number => value !== undefined)

	return [...new Set(numbers)]
}

// Every body predicate must strip fenced blocks first, for the reason given on FENCE_LINE_PATTERN.
// The patterns are non-global, so `test` keeps no `lastIndex` state between calls.
function has_pattern_match(pattern: RegExp, body: string | undefined): boolean {
	if (body === undefined) return false

	return pattern.test(strip_fenced_blocks(body))
}

function has_external_task_list_entry(body: string | undefined): boolean {
	return has_pattern_match(EXTERNAL_TASK_LIST_PATTERN, body)
}

function has_declared_dependency_chain(body: string | undefined): boolean {
	return has_pattern_match(DEPENDENCY_CHAIN_PATTERN, body)
}

// Fenced blocks are stripped here for the same reason they are everywhere else: an epic body may
// quote the template, and a declaration inside that quote is an illustration, not a declaration.
function has_unordered_declaration(body: string | undefined): boolean {
	if (body === undefined) return false

	return strip_fenced_blocks(body).includes(UNORDERED_DEPENDENCIES)
}

function has_child(children: ReadonlyArray<number>, issue_number: number): boolean {
	return children.includes(issue_number)
}

// The Issue the merged PR just closed is treated as closed without querying it. GitHub applies the
// `closes #N` side effect asynchronously, so reading its state right after the merge is a race that
// would intermittently leave a finished epic open.
function is_state_closed(state: string | undefined): boolean {
	return state?.toUpperCase() === CLOSED_STATE
}

const git_epic_parse = {
	parse_task_list_issue_numbers,
	has_external_task_list_entry,
	has_declared_dependency_chain,
	has_unordered_declaration,
	has_child,
	is_state_closed,
}

export {
	git_epic_parse,
	parse_task_list_issue_numbers,
	has_external_task_list_entry,
	has_declared_dependency_chain,
	has_unordered_declaration,
	has_child,
	is_state_closed,
	UNORDERED_DEPENDENCIES,
}
