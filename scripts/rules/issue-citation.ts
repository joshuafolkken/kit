// The bare-`#N` predicate behind the `issue-citation` row of the stop guard (joshuafolkken/kit#2121).
//
// **Session-facing output cites an Issue as a number-link, never a bare `#N`.** `CLAUDE.md` and
// `prompts/collaboration-workflow/issue-citation.md` require `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <short summary>`
// in what the person reads: a bare `#123` is not clickable and does not say which repository's Issue
// it is. The stop guard reads `last_assistant_message` — the turn's session-facing text — and this
// predicate answers whether a bare number slipped into it.
//
// **It is a notice, never a refusal.** A citation-format slip is not worth blocking a stop over, and
// the cost of a false positive is high — so the row emits `systemMessage` and lets the stop proceed.

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

// Whether a markdown link's *text* span — between the `[` and the `]`, never its `(target)` — covers
// `index`. A `#N` inside the text is the approved `[#N](url)` citation; one in the target is not
// reachable, since an issues URL carries no `#N`.
function text_span_covers(link: RegExpMatchArray, index: number): boolean {
	const start = (link.index ?? 0) + 1
	const end = start + (link[1] ?? '').length

	return index >= start && index < end
}

// The whole message is searched for a link whose text span covers this index, so `see [#12](url) and
// #34` reads the first as linked and the second as bare.
function is_linked_at(message: string, index: number): boolean {
	for (const link of message.matchAll(MARKDOWN_LINK)) {
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

// The bare references in the message, in the order they appear and de-duplicated: the correcting
// notice names them and turns them into `issue:cite` arguments, so a reference cited twice is not
// nudged about twice. Each carries its `owner/repo` prefix when it had one, so a cross-repository
// mention is corrected to the right repository.
function bare_references(message: string): ReadonlyArray<string> {
	const found: Array<string> = []

	for (const match of message.matchAll(ISSUE_NUMBER)) {
		const { index } = match
		if (!is_linked_at(message, index)) found.push(`${repo_prefix(message, index)}${match[0]}`)
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
