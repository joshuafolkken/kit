import { epic_graph, type EpicChild, type IssueReference } from './epic-graph'

// Reading an epic's children against each other.
//
// `epic:check` verifies one epic's *format*; nothing verified that the children agree. A hand audit
// of joshuafolkken/kit#858 found two contradictions that would have stalled the implementation, and
// `epic:check` reported all four of its requirements as passing throughout (joshuafolkken/kit#870).
//
// The graph's own properties — a cycle, and a body that declares one order while the relations
// record another — are already detected by `epic:next` for its own purposes. This module is a
// consumer of that, not a second implementation. What is new here is reading *inside* the children.

// An issue reference anywhere in prose. Deliberately broader than the task-list pattern the epic
// format uses: the point is to notice a child talking about another child at all.
//
// The number is matched on its own and the `owner/repo` in front of it is read by walking backwards,
// rather than by widening the pattern to cover both forms: two unbounded segments ahead of the `#`
// backtrack, and this runs over every child's whole body.
const REFERENCE_PATTERN = /#(\d+)\b/gu
// What may appear in the `owner/repo` written in front of a `#`: exactly the set the previous
// lookbehind refused a bare reference after, plus the `.` a repository name may legitimately contain.
//
// The dot is where this parse and the task-list parse used to disagree. `git_epic_parse`'s
// `EXTERNAL_REFERENCE_SOURCE` allows one, so `- [ ] owner/site.com#40` is tracked as a genuine
// cross-repository child; this one excluded it, so a sibling quoting `owner/site.com#40` was read
// back as `com` — no repository — and every check skipped it in silence. A child that can be tracked
// but never cited is the gap joshuafolkken/kit#1016 closes.
//
// Nothing in the syntax separates `owner/site.com` from a path written in prose: `prompts/review.md`
// has the same shape, and reading it as a repository is the misread the exclusion was there to
// prevent. So the dot is admitted and `reference_repo` decides — a dotted name is a repository only
// when the epic actually tracks one by that name.
const PREFIX_CHARACTER = /[\w./-]/u
const REPO_SEPARATOR = '/'
const REPO_PART_COUNT = 2
const REPO_NAME_DOT = '.'
// No epic in view, so no dotted name can be confirmed against one. Shared rather than allocated per
// call: it is never written to.
const NO_KNOWN_REPOS: ReadonlySet<string> = new Set()
// Where a child states what it must deliver. Both spellings, because the bodies are written in
// whichever language the session was in.
const ACCEPTANCE_HEADINGS: ReadonlyArray<string> = ['## 受け入れ条件', '## Acceptance criteria']
const HEADING_PREFIX = '## '

type FindingLevel = 'error' | 'warning'

// Whether an issue a body cites is open, closed, or could not be read at all. Declared beside the
// parse rather than in either consumer, so the checks and the command that resolves the states name
// one type instead of two identical ones.
type ReferenceState = 'OPEN' | 'CLOSED' | 'UNRESOLVED'

interface AuditFinding {
	level: FindingLevel
	check: string
	message: string
}

// The text immediately in front of a `#`, up to the first character that cannot be part of an
// `owner/repo`.
function prefix_before(text: string, index: number): string {
	let start = index

	while (start > 0 && PREFIX_CHARACTER.test(text[start - 1] ?? '')) start -= 1

	return text.slice(start, index)
}

// Two non-empty segments, which is all a repository name and a path have in common.
function is_repo_shape(parts: ReadonlyArray<string>): boolean {
	return parts.length === REPO_PART_COUNT && parts.every((part) => part !== '')
}

// Which repository a reference names: the body's own when nothing is written in front of the `#`,
// the named one when an `owner/repo` is, and none at all when the prefix is something else — a bare
// word (`kit#12` names nothing GitHub can resolve) or the tail of a URL.
//
// A dotted name is the one case the shape cannot settle, so it is settled by `known_repos` — the
// repositories this epic actually spans. `owner/site.com#40` is read when the epic tracks a child
// there, and `prompts/review.md#5` is not read at all, because no epic tracks a repository by that
// name. That makes the set of children that can be *tracked* and the set that can be *cited* the same
// set, which is what joshuafolkken/kit#1016 asked for, without admitting the path misread that
// widening the pattern outright would have brought back.
function reference_repo(
	prefix: string,
	repo: string,
	known: ReadonlySet<string>,
): string | undefined {
	if (prefix === '') return repo
	if (!is_repo_shape(prefix.split(REPO_SEPARATOR))) return undefined
	if (!prefix.includes(REPO_NAME_DOT)) return prefix

	return known.has(prefix) ? prefix : undefined
}

function to_reference(
	text: string,
	match: RegExpExecArray,
	repo: string,
	known: ReadonlySet<string>,
): IssueReference | undefined {
	const issue_number = Number(match[1])
	if (!Number.isSafeInteger(issue_number)) return undefined
	const named_repo = reference_repo(prefix_before(text, match.index), repo, known)

	return named_repo === undefined ? undefined : { repo: named_repo, number: issue_number }
}

// The same issue named twice is one reference, however each mention was written. Kept in the order
// the prose wrote them in, which is the order the findings then read in.
function unique_references(references: ReadonlyArray<IssueReference>): Array<IssueReference> {
	const seen = new Set<string>()

	return references.filter((reference) => {
		const key = epic_graph.key_of(reference)
		const is_new = !seen.has(key)

		seen.add(key)

		return is_new
	})
}

// The issues a piece of prose refers to, each with the repository it lives in. `repo` is the
// `owner/name` whose body this is: an unqualified `#N` there names that repository's issue N.
//
// `known` names the repositories the epic in hand spans, and only a dotted name consults it —
// see `reference_repo`. A caller with no epic in view passes nothing and gets the dotless reading,
// which is what every caller got before joshuafolkken/kit#1016.
function parse_issue_references(
	text: string,
	repo: string,
	known: ReadonlySet<string> = NO_KNOWN_REPOS,
): Array<IssueReference> {
	const found: Array<IssueReference> = []

	for (const match of text.matchAll(REFERENCE_PATTERN)) {
		const reference = to_reference(text, match, repo, known)

		if (reference !== undefined) found.push(reference)
	}

	return unique_references(found)
}

// The repositories an epic actually spans, which is what settles a dotted name written in prose:
// `owner/site.com#40` is a reference when a child lives there and a path otherwise. Built from the
// children rather than supplied, so a caller cannot hand the parse a set that disagrees with the
// epic being read (joshuafolkken/kit#1016).
function known_repos(
	children: ReadonlyArray<IssueReference>,
	current_repo: string,
): ReadonlySet<string> {
	return new Set([current_repo, ...children.map((child) => child.repo)])
}

// The issue numbers a piece of prose refers to *in its own repository*. Kept as the narrower reading
// of the same parse rather than a second one: `epic:bundle` compares two issues' references by
// number and has no cross-repository notion to compare with.
function parse_references(text: string, repo = ''): Array<number> {
	return parse_issue_references(text, repo)
		.filter((reference) => reference.repo === repo)
		.map((reference) => reference.number)
}

function is_acceptance_heading(line: string): boolean {
	return ACCEPTANCE_HEADINGS.includes(line.trim())
}

function is_heading(line: string): boolean {
	return line.trimStart().startsWith(HEADING_PREFIX)
}

// The lines under the acceptance-criteria heading, up to the next `##`. Shaped like the other
// section readers in this repository, for the same reason: a regex spanning the block backtracks.
function section_lines(lines: ReadonlyArray<string>): Array<string> {
	const start = lines.findIndex((line) => is_acceptance_heading(line))
	if (start === -1) return []
	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => is_heading(line))

	return end === -1 ? rest : rest.slice(0, end)
}

// The acceptance-criteria section of a child's body, or an empty string.
function acceptance_section(body: string | undefined): string {
	if (body === undefined) return ''

	return section_lines(body.split('\n')).join('\n')
}

// Everything `node` depends on, directly or through a chain. Walked iteratively so a graph that
// still contains a cycle terminates — `epic:next` rejects one first, but an auditor must not hang on
// the input it exists to examine.
function collect_blockers(
	index: ReadonlyMap<string, EpicChild>,
	node: string,
): ReadonlySet<string> {
	const seen = new Set<string>()
	const pending = [...epic_graph.blockers_of(index, node)]

	while (pending.length > 0) {
		const current = pending.pop() ?? node

		if (!seen.has(current)) {
			seen.add(current)
			pending.push(...epic_graph.blockers_of(index, current))
		}
	}

	return seen
}

// Both ends are named by identity — repository plus number — because an epic can track two children
// whose numbers collide across repositories (joshuafolkken/kit#864).
function depends_on(
	index: ReadonlyMap<string, EpicChild>,
	node: EpicChild,
	target: EpicChild,
): boolean {
	return collect_blockers(index, epic_graph.key_of(node)).has(epic_graph.key_of(target))
}

// `REFERENCE_PATTERN` is deliberately not exported: the guard that decides what may sit in front of
// a `#` lives in `prefix_before`, so the pattern on its own matches the tail of `owner/repo#12` —
// the very reading this module exists to prevent.
const epic_audit_logic = {
	ACCEPTANCE_HEADINGS,
	unique_references,
	known_repos,
	parse_issue_references,
	parse_references,
	acceptance_section,
	collect_blockers,
	depends_on,
}

export type { AuditFinding, FindingLevel, ReferenceState }
export { epic_audit_logic }
