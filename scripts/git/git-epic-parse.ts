// An epic Issue tracks its children as a markdown task list (`- [ ] #101`). Only that syntax
// counts as tracked: GitHub auto-checks such an entry when the referenced Issue closes, whereas a
// bare `#101` reference produces a cross-link with no progress tracking.
const TASK_LIST_ISSUE_PATTERN = /^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+#(\d+)\b/gmu

// A task list may also reference an Issue in another repository (`owner/repo#101`, or a full URL).
// Detecting one is what the auto-close used to bail on; joshuafolkken/kit#864 reads them instead,
// through `gh --repo`, and the pattern below extracts which repository and which issue.
const EXTERNAL_TASK_LIST_PATTERN =
	/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+(?:[\w.-]+\/[\w.-]+#\d+|https?:\/\/)/mu
// `- [ ] owner/repo#101`
const EXTERNAL_SHORTHAND_PATTERN =
	/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+([\w.-]+)\/([\w.-]+)#(\d+)\b/gmu
// `- [ ] https://github.com/owner/repo/issues/101`
const EXTERNAL_URL_PATTERN =
	/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\b/gmu

// Fenced blocks are stripped before matching. An epic body may quote the body template itself, and
// its sample rows (`- [ ] #101 <title>`) are illustrations, not tracked children — counting them
// would attach a nonexistent Issue to the batch and keep the epic open forever.
const FENCE_LINE_PATTERN = /^[ \t]*(?:`{3,}|~{3,})/u

// An epic is created for every split, so its existence no longer implies an ordered batch. The
// declaration in its body is what distinguishes "the order was never recorded" from "there is no
// order": a chain between two Issue references (`#101 -> #102`, or the arrow written as `→`). The
// shape of the chain is not validated — only that one was declared at all.
const DEPENDENCY_CHAIN_PATTERN = /#\d+[ \t]*(?:->|→)[ \t]*#\d+/u

// The same chain, read for its links rather than its existence. `epic:next` compares what the body
// declares against the `blocked-by` relations actually recorded, and a body that says one order
// while the relations say another must stop the run rather than silently follow either
// (joshuafolkken/kit#860).
//
// Only a line that is *nothing but* a chain counts, optionally behind a list marker. Measured
// against joshuafolkken/kit#858, whose Dependencies section is followed by a prose line recommending
// an execution order — `推奨実行順: #869 -> #863 -> …`. Those arrows are a suggestion, not a
// declaration, and reading them as one reported four disagreements that did not exist.
const DECLARED_CHAIN_LINE = /^(?:[-*+][ \t]+)?#\d+(?:[ \t]*(?:->|→)[ \t]*#\d+)+$/u
const CHAIN_REFERENCE_PATTERN = /#(\d+)/gu

// The other half of a machine-readable `Dependencies` section: the exact sentence that declares a
// batch to have no order. It lives here, beside the chain patterns, because all of them are what a
// reader of the body is allowed to rely on — the generator imports this rather than restating it, so
// the text it writes and the text checked for are one string.
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

// A child of this epic that lives in another repository.
interface ExternalChild {
	repo: string
	number: number
}

const OWNER_GROUP = 1
const REPO_GROUP = 2
const EXTERNAL_NUMBER_GROUP = 3

function to_external_child(match: RegExpMatchArray): ExternalChild | undefined {
	const owner = match[OWNER_GROUP]
	const repo = match[REPO_GROUP]
	if (owner === undefined || repo === undefined) return undefined
	const parsed = Number(match[EXTERNAL_NUMBER_GROUP])

	if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined

	return { repo: `${owner}/${repo}`, number: parsed }
}

function match_external(body: string, pattern: RegExp): Array<ExternalChild> {
	return Array.from(body.matchAll(pattern), (match) => to_external_child(match)).filter(
		(child): child is ExternalChild => child !== undefined,
	)
}

// Every cross-repository child the task list tracks, in both spellings. Reported as `owner/repo`
// plus a number rather than a URL, which is the form the repository map and `gh --repo` both take
// (joshuafolkken/kit#864).
function parse_external_task_list_children(body: string | undefined): Array<ExternalChild> {
	if (body === undefined) return []
	const stripped = strip_fenced_blocks(body)
	const found = [
		...match_external(stripped, EXTERNAL_SHORTHAND_PATTERN),
		...match_external(stripped, EXTERNAL_URL_PATTERN),
	]
	const seen = new Set<string>()

	return found.filter((child) => {
		const key = `${child.repo}#${String(child.number)}`
		const is_new = !seen.has(key)

		seen.add(key)

		return is_new
	})
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

// One declared link: `blocker` must finish before `blocked` starts.
interface DependencyLink {
	blocker: number
	blocked: number
}

const REFERENCE_GROUP = 1

// The issue numbers of one chain line, in order.
function chain_references(line: string): Array<number> {
	return Array.from(line.matchAll(CHAIN_REFERENCE_PATTERN), (match) =>
		Number(match[REFERENCE_GROUP]),
	).filter((value) => Number.isSafeInteger(value))
}

// `#1 -> #2 -> #3` becomes two links; consecutive links share their middle reference.
function chain_links(references: ReadonlyArray<number>): Array<DependencyLink> {
	return references
		.slice(1)
		.map((blocked, index) => ({ blocker: references[index] ?? blocked, blocked }))
		.filter((link) => link.blocker !== link.blocked)
}

// Every link the body declares, in the order written. Fenced blocks are stripped first for the
// reason they are everywhere else: a quoted template's sample chain is an illustration.
function parse_dependency_links(body: string | undefined): Array<DependencyLink> {
	if (body === undefined) return []

	return strip_fenced_blocks(body)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => DECLARED_CHAIN_LINE.test(line))
		.flatMap((line) => chain_links(chain_references(line)))
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
	parse_dependency_links,
	parse_external_task_list_children,
	has_child,
	is_state_closed,
}

export type { DependencyLink, ExternalChild }
export {
	git_epic_parse,
	parse_task_list_issue_numbers,
	has_external_task_list_entry,
	has_declared_dependency_chain,
	has_unordered_declaration,
	parse_dependency_links,
	parse_external_task_list_children,
	has_child,
	is_state_closed,
	UNORDERED_DEPENDENCIES,
}
