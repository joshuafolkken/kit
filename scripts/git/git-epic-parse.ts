// An epic Issue tracks its children as a markdown task list (`- [ ] #101`). Only that syntax
// counts as tracked: GitHub auto-checks such an entry when the referenced Issue closes, whereas a
// bare `#101` reference produces a cross-link with no progress tracking.
//
// The source is shared by the whole-body scan and the single-line test rather than written twice: a
// rewriter has to recognize exactly the rows the reader counts, and two copies of this pattern would
// be two chances to disagree about what a tracked row is (joshuafolkken/kit#890).
const TASK_LIST_ISSUE_SOURCE = String.raw`^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+#(\d+)\b`
const TASK_LIST_ISSUE_PATTERN = new RegExp(TASK_LIST_ISSUE_SOURCE, 'gmu')
const TASK_LIST_LINE_PATTERN = new RegExp(TASK_LIST_ISSUE_SOURCE, 'u')

// A task list may also reference an Issue in another repository (`owner/repo#101`, or a full URL).
// Detecting one is what the auto-close used to bail on; joshuafolkken/kit#864 reads them instead,
// against their own repository, and the pattern below extracts which repository and which issue.
// `owner/repo#101` on its own. The row patterns below are built from this source, so what counts as
// a cross-repository reference has one definition — a second copy would let a form the task list
// accepts be refused where a person types it, or the reverse (joshuafolkken/kit#985).
const EXTERNAL_REFERENCE_SOURCE = String.raw`([\w.-]+)\/([\w.-]+)#(\d+)`
const EXTERNAL_REFERENCE_PATTERN = new RegExp(`^${EXTERNAL_REFERENCE_SOURCE}$`, 'u')
const TASK_LIST_ROW_SOURCE = String.raw`^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+`
const EXTERNAL_TASK_LIST_PATTERN = new RegExp(
	String.raw`${TASK_LIST_ROW_SOURCE}(?:${EXTERNAL_REFERENCE_SOURCE}|https?:\/\/)`,
	'mu',
)
// `- [ ] owner/repo#101`
const EXTERNAL_SHORTHAND_PATTERN = new RegExp(
	String.raw`${TASK_LIST_ROW_SOURCE}${EXTERNAL_REFERENCE_SOURCE}\b`,
	'gmu',
)
// `- [ ] https://github.com/owner/repo/issues/101`
const EXTERNAL_URL_PATTERN =
	/^[ \t]*[-*+][ \t]+\[[ xX]\][ \t]+https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\b/gmu

// Fenced blocks are stripped before matching. An epic body may quote the body template itself, and
// its sample rows (`- [ ] #101 <title>`) are illustrations, not tracked children — counting them
// would attach a nonexistent Issue to the batch and keep the epic open forever.
const FENCE_LINE_PATTERN = /^[ \t]*(?:`{3,}|~{3,})/u

// A chain between two Issue references (`#101 -> #102`, or the arrow written as `→`), read for its
// links. `epic:next` compares what the body declares against the `blocked-by` relations actually
// recorded, and a body that says one order while the relations say another must stop the run rather
// than silently follow either (joshuafolkken/kit#860).
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

// Which lines a body predicate is allowed to read: `false` for a fence line and for everything
// between a pair of them. Returned as a mask rather than a filtered string because a rewriter has to
// put lines back where it found them, and it must skip exactly the lines the readers skip — two
// separate fence walks would be two chances to disagree (joshuafolkken/kit#890).
//
// Toggling on each fence line keeps this linear — a single regex spanning the block would backtrack.
// An unterminated fence swallows the rest of the body, which fails safe: fewer children means the
// epic is simply never matched, and it stays open for manual closing.
function fence_mask(body: string): Array<boolean> {
	let is_inside_fence = false

	return body.split('\n').map((line) => {
		if (FENCE_LINE_PATTERN.test(line)) {
			is_inside_fence = !is_inside_fence

			return false
		}

		return !is_inside_fence
	})
}

function strip_fenced_blocks(body: string): string {
	const mask = fence_mask(body)

	return body
		.split('\n')
		.filter((_, index) => mask[index] === true)
		.join('\n')
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

// A bare `owner/repo#101`, as a person types it — the same shape the task-list rows carry, read
// from a command argument rather than from a body. It reuses `to_external_child` so the two cannot
// disagree about which owner and repository names are acceptable (joshuafolkken/kit#985).
function parse_external_reference(text: string): ExternalChild | undefined {
	const match = EXTERNAL_REFERENCE_PATTERN.exec(text.trim())
	if (match === null) return undefined

	return to_external_child(match)
}

function match_external(body: string, pattern: RegExp): Array<ExternalChild> {
	return Array.from(body.matchAll(pattern), (match) => to_external_child(match)).filter(
		(child): child is ExternalChild => child !== undefined,
	)
}

// Every cross-repository child the task list tracks, in both spellings. Reported as `owner/repo`
// plus a number rather than a URL, which is the form the repository map takes and the form the
// read's REST path is built from (joshuafolkken/kit#864).
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

// Whether one line is a tracked child row. Used by the rewriter to find where the rows end, so a
// new row lands beside the existing ones rather than at the bottom of the body.
function is_task_list_line(line: string): boolean {
	return TASK_LIST_LINE_PATTERN.test(line)
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

// Every declared chain, one entry per chain line, each holding its references in the order written.
// Read at this granularity rather than as a flat link list because an insertion has to know *which*
// chain a target sits in: two disjoint chains and one branching chain produce the same links, and
// only the line structure tells them apart (joshuafolkken/kit#890).
//
// Fenced blocks are stripped first for the reason they are everywhere else: a quoted template's
// sample chain is an illustration.
function parse_dependency_chains(body: string | undefined): Array<Array<number>> {
	if (body === undefined) return []

	return strip_fenced_blocks(body)
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => DECLARED_CHAIN_LINE.test(line))
		.map((line) => chain_references(line))
}

// Every link the body declares, in the order written. Flattened from the chains above rather than
// re-scanning the body, so "what a chain line is" has one definition.
function parse_dependency_links(body: string | undefined): Array<DependencyLink> {
	return parse_dependency_chains(body).flatMap((references) => chain_links(references))
}

// Whether the body declares an order at all — asked by `epic:check` and by the order-unrecorded
// warning, which need to tell "the order was never recorded" from "there is no order".
//
// Answered from the chains above rather than from a pattern of its own, because a second pattern is
// a second answer: until joshuafolkken/kit#1155 this scanned the whole body for a bare `#N -> #M`,
// so a rationale paragraph recommending an execution order made an epic declared
// `None — the children are independent` report as ordered, and `josh followup` then said the batch
// order was never recorded on every child's merge. The narrowing joshuafolkken/kit#858 applied to
// the link reader was the same judgement, and `epic --add` writes on that judgement too
// (`git-epic-add-body.ts` protects an arrow outside the `Dependencies` section as prose) — so the
// three readers of one body now recognize the same lines, instead of two patterns that could
// disagree about which line is a declaration. They still answer different questions of those lines:
// a self-loop (`#101 -> #101`) is a declaration here and yields no link, since `chain_links` drops
// an edge from an issue to itself.
function has_declared_dependency_chain(body: string | undefined): boolean {
	return parse_dependency_chains(body).length > 0
}

// What the body declares about order, as the two independent answers every reader of it needs. Read
// from the whole fence-stripped body rather than from the `Dependencies` section, because that is
// where `epic:next` reads its links from: a chain line left outside the section is followed by the
// run, so a check that could not see it would call such a body consistent.
interface DeclarationState {
	has_chain: boolean
	has_none_literal: boolean
}

function read_declaration(body: string | undefined): DeclarationState {
	return {
		has_chain: has_declared_dependency_chain(body),
		has_none_literal: has_unordered_declaration(body),
	}
}

// Whether that declaration says something a machine can act on: exactly one of the two forms, never
// both. A body carrying a chain *and* the `None — ...` literal declares an order and declares that
// there is none, and `epic:check` used to pass it while reporting only the half that contradicts the
// other (joshuafolkken/kit#1155). Single-sourced here because `epic:check`, `epic --add` and
// `epic --promote` all mean this same question, and three copies of the disjunction were three
// chances to accept a body the check rejects.
function is_declaration_readable(state: DeclarationState): boolean {
	return state.has_chain !== state.has_none_literal
}

function has_machine_readable_declaration(body: string | undefined): boolean {
	return is_declaration_readable(read_declaration(body))
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
	fence_mask,
	is_task_list_line,
	chain_links,
	parse_dependency_chains,
	parse_task_list_issue_numbers,
	has_external_task_list_entry,
	has_declared_dependency_chain,
	has_unordered_declaration,
	read_declaration,
	is_declaration_readable,
	has_machine_readable_declaration,
	parse_dependency_links,
	parse_external_task_list_children,
	parse_external_reference,
	has_child,
	is_state_closed,
}

export type { DeclarationState, DependencyLink, ExternalChild }
export {
	git_epic_parse,
	fence_mask,
	is_task_list_line,
	chain_links,
	parse_dependency_chains,
	parse_task_list_issue_numbers,
	has_external_task_list_entry,
	has_declared_dependency_chain,
	has_unordered_declaration,
	read_declaration,
	is_declaration_readable,
	has_machine_readable_declaration,
	parse_dependency_links,
	parse_external_task_list_children,
	parse_external_reference,
	has_child,
	is_state_closed,
	UNORDERED_DEPENDENCIES,
	DECLARED_CHAIN_LINE,
}
