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

// An Issue number: `#` and its digits. `\d+` is greedy, so an optional `owner/repo` prefix would add
// nothing to whether the mention is bare — the `#N` alone locates it, and its enclosure decides the
// rest. One quantifier, no backtracking.
const ISSUE_REFERENCE = /#\d+/gu
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
// `gh` as a `Bash` argument, not spoken in `last_assistant_message`, so those never reach this
// predicate — which is exactly the "silent on GitHub-bound artifacts" behavior the issue asks for, obtained by what
// the stop guard reads rather than by a second exclusion here.
function has_bare_reference(message: string): boolean {
	for (const match of message.matchAll(ISSUE_REFERENCE)) {
		if (!is_linked_at(message, match.index)) return true
	}

	return false
}

const issue_citation = { has_bare_reference }

export { issue_citation }
