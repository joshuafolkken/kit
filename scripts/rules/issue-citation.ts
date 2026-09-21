// The bare-`#N` predicate behind the `issue-citation` row of the stop guard (joshuafolkken/kit#2121).
//
// **Session-facing output cites an Issue as a number-link, never a bare `#N`.** `CLAUDE.md` and
// `prompts/collaboration-workflow/issue-citation.md` require `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <short summary>`
// in what the person reads: a bare `#123` is not clickable and does not say which repository's Issue
// it is. The stop guard reads `last_assistant_message` — the turn's session-facing text — and this
// predicate answers whether a bare number slipped into it.
//
// **It blocks the stop, so a false positive costs a wasted turn** (joshuafolkken/kit#2247). The nudge
// now reaches the model rather than the person, so the detection is tightened to what is genuinely a
// bare citation: a `#N` inside a fenced code block, inside an inline-code span, on a quote line, or
// right after `PR` / `pull request` is not a citation slip and is skipped. The scan is line-based so
// each exclusion is decided from the one line the mention sits on.

// An Issue number: `#` and its digits. One quantifier, no backtracking — the `#N` alone locates the
// mention, and any `owner/repo` prefix is read off the surrounding text (`repo_prefix`) rather than
// folded into the pattern, so the scan never carries two variable-length segments (sonar super-linear).
const ISSUE_NUMBER = /#\d+/gu
// The characters that bound an `owner/repo` prefix: whitespace, another `#`, and the brackets a
// citation or prose wraps a reference in. Tested one character at a time by the prefix scan, so that
// scan stays linear.
const REFERENCE_BOUNDARY = /[\s#()[\]<>|]/u
// A well-formed `owner/repo`: exactly one slash between two non-empty segments — the same shape
// `issue:cite`'s parser accepts. A path-like run (`src/lib`, `a/b/c`) is not one, so it is not emitted
// as a prefix that would make the suggested `issue:cite` call refuse the very reference it names.
const OWNER_REPO = /^[^\s/#]+\/[^\s/#]+$/u
// A markdown link, with its text captured as group 1: `[text](target)`. Each class excludes *both*
// of its delimiters — no `[`/`]` in the text, no `(`/`)` in the target — so neither star is ambiguous
// against a nested bracket and there is nothing to backtrack.
const MARKDOWN_LINK = /\[([^[\]]*)\]\([^()]*\)/gu
// A fenced-code delimiter line: three or more backticks or tildes after optional indentation — both
// delimiters CommonMark allows. Toggling on each one brackets the fenced block, so a `closes #N` shown
// in a `gh api` example never reads as a slip whichever fence the reply drew it with.
const FENCE_MARKER = /^\s*(?:`{3,}|~{3,})/u
// A quote line: a `>` after optional indentation. An Issue body quoted back carries its own `#N`, and
// a quote is not the run's own citation.
const QUOTE_LINE = /^\s*>/u
// A `#N` written as a PR reference: `PR` or `pull request` (word-bounded) right before it. `#N` alone
// cannot tell an Issue from a PR, but the preceding word can, and reading it needs no network round
// trip inside the hook.
const PR_PREFIX = /\b(?:pr|pull request)\s*$/iu
// Two backticks bracket one inline-code span, so an odd count of them before an index means the index
// sits inside a span.
const BACKTICK_PAIR = 2

// Whether a markdown link's *text* span — between the `[` and the `]`, never its `(target)` — covers
// `index`. A `#N` inside the text is the approved `[#N](url)` citation; one in the target is not
// reachable, since an issues URL carries no `#N`.
function text_span_covers(link: RegExpMatchArray, index: number): boolean {
	const start = (link.index ?? 0) + 1
	const end = start + (link[1] ?? '').length

	return index >= start && index < end
}

// The line is searched for a link whose text span covers this index, so `see [#12](url) and #34`
// reads the first as linked and the second as bare. The scan is line-based (`is_bare_at` passes one
// line), so a link and the `#N` it wraps must sit on the same line — which they always do.
function is_linked_at(line: string, index: number): boolean {
	for (const link of line.matchAll(MARKDOWN_LINK)) {
		if (text_span_covers(link, index)) return true
	}

	return false
}

// **The message text alone, never a GitHub-bound artifact.** An Issue body or comment is passed to
// `gh` as a `Bash` argument, not spoken in `last_assistant_message`, so those never reach here — which
// is exactly the "silent on GitHub-bound artifacts" behavior the issue asks for, obtained by what the
// stop guard reads rather than by a second exclusion here.
//
// The `owner/repo` written immediately before a `#N`, or '' when the mention is bare — the run of
// non-boundary characters ending at the `#`, kept only when it holds a `/`. Read backwards a
// character at a time so a repository name of any length costs its own length and no more.
function repo_prefix(message: string, hash_index: number): string {
	let start = hash_index
	while (start > 0 && !REFERENCE_BOUNDARY.test(message.charAt(start - 1))) start -= 1

	const token = message.slice(start, hash_index)

	return OWNER_REPO.test(token) ? token : ''
}

// Whether the index sits inside an inline-code span: an odd number of backticks precede it on the line.
function is_inline_code_at(line: string, index: number): boolean {
	const backticks = line.slice(0, index).split('`').length - 1

	return backticks % BACKTICK_PAIR === 1
}

// Whether the `#N` at this index on the line is a real bare citation rather than an excluded mention —
// a linked reference, an inline-code span, or a PR reference read off the word before it.
function is_bare_at(line: string, index: number): boolean {
	if (is_linked_at(line, index) || is_inline_code_at(line, index)) return false

	return !PR_PREFIX.test(line.slice(0, index))
}

// The bare references on one non-excluded line are appended in order, each carrying its `owner/repo`
// prefix when it had one.
function collect_line_references(line: string, found: Array<string>): void {
	for (const match of line.matchAll(ISSUE_NUMBER)) {
		const { index } = match
		if (is_bare_at(line, index)) found.push(`${repo_prefix(line, index)}${match[0]}`)
	}
}

// The message lines that sit outside every fenced-code block, with the fence delimiter lines
// themselves dropped: toggling on each delimiter brackets the block, so a `#N` shown in an example is
// never scanned.
function lines_outside_fences(message: string): ReadonlyArray<string> {
	const lines: Array<string> = []
	let is_in_fence = false

	for (const line of message.split('\n')) {
		if (FENCE_MARKER.test(line)) is_in_fence = !is_in_fence
		else if (!is_in_fence) lines.push(line)
	}

	return lines
}

// The bare references in the message, in the order they appear and de-duplicated: the block reason
// names them and turns them into `issue:cite` arguments, so a reference cited twice is not nudged
// about twice. Fenced-code blocks and quote lines are skipped, so a `#N` shown in an example or quoted
// from an Issue body is not read as the run's own citation.
function bare_references(message: string): ReadonlyArray<string> {
	const found: Array<string> = []

	for (const line of lines_outside_fences(message)) {
		if (!QUOTE_LINE.test(line)) collect_line_references(line, found)
	}

	return [...new Set(found)]
}

function has_bare_reference(message: string): boolean {
	return bare_references(message).length > 0
}

// The token `issue:cite` takes for one reference: a qualified `owner/repo#N` is passed as-is, a bare
// `#N` loses its `#` so the command reads `issue:cite 123` rather than `issue:cite #123`.
function cite_argument(reference: string): string {
	return reference.startsWith('#') ? reference.slice(1) : reference
}

function cite_arguments(references: ReadonlyArray<string>): ReadonlyArray<string> {
	return references.map((reference) => cite_argument(reference))
}

const issue_citation = { bare_references, cite_arguments, has_bare_reference }

export { issue_citation }
