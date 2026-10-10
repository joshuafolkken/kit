// The bare-`#N` predicate behind the `issue-citation` row of the stop guard,
// and the printing-side formatter that keeps a bare `#N` out of session-facing output in the first
// place.
//
// **Session-facing output cites an Issue as a number-link, never a bare `#N`.** `CLAUDE.md` and
// `prompts/collaboration-workflow/issue-citation.md` require `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <short summary>`
// in what the person reads: a bare `#123` is not clickable and does not say which repository's Issue
// it is. The stop guard reads `last_assistant_message` — the turn's session-facing text — and this
// predicate answers whether a bare number slipped into it.
//
// **It blocks the stop, so a false positive costs a wasted turn**. The nudge
// now reaches the model rather than the person, so the detection is tightened to what is genuinely a
// bare citation: a `#N` inside a fenced code block, inside an inline-code span, on a quote line, or
// right after `PR` / `pull request` is not a citation slip and is skipped. The scan is line-based so
// each exclusion is decided from the one line the mention sits on.
//
// **`linkify` runs that same scan the other way**: a command whose stdout a
// run copies into its reply passes the text through it, and every bare `#N` the predicate would flag
// is rewritten to `[#N](url)` — which the predicate then reads as linked, so the material that fed the
// duplicate reply is fixed where it is printed rather than scolded after it reaches the screen. The
// same exclusions hold, so a `#N` in a fenced example or an already-linked reference is left untouched.

import { issue_cite } from '#scripts/issue/issue-cite'

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
// A markdown link: `[text](target)`. Each class excludes *both* of its delimiters — no `[`/`]` in the
// text, no `(`/`)` in the target — so neither star is ambiguous against a nested bracket and there is
// nothing to backtrack.
const MARKDOWN_LINK = /\[[^[\]]*\]\([^()]*\)/gu
// What continues a `#N` into something longer, read off the two characters after its last digit: a
// word character (a hex color, `#1e90ff`) or a hyphen and a letter (a heading anchor, `#12-setup`) —
// never an Issue number. A hyphen before a digit or `#` is a range
// (`#12-#15`, `#3-5`), whose first number is still a citation.
const NUMBER_CONTINUATION = /^(?:\w|-[a-z])/iu
// The width of the window `NUMBER_CONTINUATION` reads: a hyphen and the letter after it.
const CONTINUATION_WIDTH = 2
// What, in the run of non-boundary characters before a `#N`, glues it into a longer token: the `&` of
// an HTML entity (`&#39;`), the `.` of a file fragment (`README.md#12`), the `/` of a path or URL
// fragment (`src/lib/x#5`, `example.com/#12`). Any other lead leaves it a citation — a repository
// without its owner (`kit#12`), a verb (`fixes#12`), prose in a non-Latin script or emphasis
// (`**#12**`) is a slip all the same. A well-formed `owner/repo#N` is read off `repo_prefix` first.
const GLUED_LEAD = /[&./]/u
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

// Whether a markdown link covers `index`, text or target alike. A `#N` in the text is the approved
// `[#N](url)` citation; one in the target is a page fragment (`[setup](#12)`), not an Issue.
function link_covers(link: RegExpMatchArray, index: number): boolean {
	const start = link.index ?? 0

	return index >= start && index < start + link[0].length
}

// The line is searched for a link covering this index, so `see [#12](url) and #34` reads the first as
// linked and the second as bare. The scan is line-based (`is_bare_at` passes one line), so a link and
// the `#N` it wraps must sit on the same line — which they always do.
function is_linked_at(line: string, index: number): boolean {
	for (const link of line.matchAll(MARKDOWN_LINK)) {
		if (link_covers(link, index)) return true
	}

	return false
}

// The run of non-boundary characters that ends at the `#` — what `repo_prefix` keeps when it is an
// `owner/repo` and `is_glued` weighs when it is not.
function lead_token(message: string, hash_index: number): string {
	let start = hash_index
	while (start > 0 && !REFERENCE_BOUNDARY.test(message.charAt(start - 1))) start -= 1

	return message.slice(start, hash_index)
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
	const token = lead_token(message, hash_index)

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

// One bare reference and where it sits on its line: the `#N` text, the index its `#` starts at, and
// the `owner/repo` prefix that precedes it (or ''). Shared so the collector and `linkify` read the
// line the same way and cannot drift about what counts as bare.
interface LineReference {
	index: number
	prefix: string
	text: string
}

// Whether the `#N` is part of a longer token rather than an Issue number of its own — continued past
// its digits, or led by an entity, file or path run (`GLUED_LEAD`) that is not an `owner/repo`.
function is_glued(line: string, reference: LineReference): boolean {
	const end = reference.index + reference.text.length

	if (NUMBER_CONTINUATION.test(line.slice(end, end + CONTINUATION_WIDTH))) return true

	return reference.prefix === '' && GLUED_LEAD.test(lead_token(line, reference.index))
}

// The bare references on one line, in order — the glued tokens (`is_glued`) and the excluded mentions
// (linked, inline-code, PR, `is_bare_at`) already dropped, so a caller acts on citations alone.
function line_references(line: string): ReadonlyArray<LineReference> {
	const references: Array<LineReference> = []

	for (const match of line.matchAll(ISSUE_NUMBER)) {
		const reference = { index: match.index, prefix: repo_prefix(line, match.index), text: match[0] }

		if (!is_glued(line, reference) && is_bare_at(line, match.index)) references.push(reference)
	}

	return references
}

// The bare references on one non-excluded line are appended in order, each carrying its `owner/repo`
// prefix when it had one.
function collect_line_references(line: string, found: Array<string>): void {
	for (const reference of line_references(line)) found.push(`${reference.prefix}${reference.text}`)
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

// The run's own prose: the lines outside every fenced-code block and off every quote line. Shared with
// the filing-offer row of the stop guard, which asks the same "is this the
// run speaking, not an example or a quote" question of the same reply.
function prose_lines(message: string): ReadonlyArray<string> {
	return lines_outside_fences(message).filter((line) => !QUOTE_LINE.test(line))
}

// The bare references in the message, in the order they appear and de-duplicated: the block reason
// names them and turns them into `issue:cite` arguments, so a reference cited twice is not nudged
// about twice. Fenced-code blocks and quote lines are skipped, so a `#N` shown in an example or quoted
// from an Issue body is not read as the run's own citation.
function bare_references(message: string): ReadonlyArray<string> {
	const found: Array<string> = []

	for (const line of prose_lines(message)) collect_line_references(line, found)

	return [...new Set(found)]
}

// Every reference the prompt carries, each as written — `#N` or `owner/repo#N` — with none of the
// citation exclusions applied: a number pasted inside a fence or a quote is still the person's.
function prompt_references(prompt: string): ReadonlySet<string> {
	const found = new Set<string>()

	for (const match of prompt.matchAll(ISSUE_NUMBER)) {
		found.add(repo_prefix(prompt, match.index) + match[0])
	}

	return found
}

// **A number the person's prompt already carried is quoted, not cited**. A
// pasted log from another repository holds its own `#1`…`#7`; `issue:cite` would link them to this
// repository's unrelated Issues, so following the refusal would make the reply wrong. Only the exact
// reference the prompt wrote is exempt, so a bare `#N` the run brought in itself is still refused.
function unquoted_references(message: string, prompt: string): ReadonlyArray<string> {
	const quoted = prompt_references(prompt)

	return bare_references(message).filter((reference) => !quoted.has(reference))
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

// One bare reference rewritten as a number-link: `[#N](url)` for a same-repo mention, or
// `[owner/repo#N](url)` for a qualified one — the label is the reference exactly as it was written, so
// the reader sees the number they would have, now clickable. The URL is `issue-cite`'s own assembly,
// reused rather than restated so the two agree on the shape of a link.
function reference_link(reference: LineReference, default_slug: string): string {
	const slug = reference.prefix === '' ? default_slug : reference.prefix
	const number = reference.text.slice(1)

	return `[${reference.prefix}${reference.text}](${issue_cite.issue_url(slug, number)})`
}

// One eligible line with every bare reference rewritten, left to right: a reference spans its
// `owner/repo` prefix through its `#N`, so the slice before it ends where the prefix begins and the
// cursor resumes after the `#N`.
function linkify_line(line: string, slug: string): string {
	let result = ''
	let cursor = 0

	for (const reference of line_references(line)) {
		const start = reference.index - reference.prefix.length

		result += line.slice(cursor, start) + reference_link(reference, slug)
		cursor = reference.index + reference.text.length
	}

	return result + line.slice(cursor)
}

// A line is rewritten only outside a fenced block and off a quote line, and never the fence delimiter
// itself — the same three exclusions `bare_references` reads, so what `linkify` leaves bare is exactly
// what the predicate would not have flagged.
function rewrite_line(line: string, slug: string, is_in_fence: boolean): string {
	if (is_in_fence || FENCE_MARKER.test(line) || QUOTE_LINE.test(line)) return line

	return linkify_line(line, slug)
}

// Session-facing text with every bare `#N` rewritten to a number-link against `slug` (`owner/repo`),
// so a command's stdout a run copies into its reply carries links rather than the bare references that
// fed the duplicate reply. Fence state is carried across lines, since a fenced block spans them.
function linkify(message: string, slug: string): string {
	const out: Array<string> = []
	let is_in_fence = false

	for (const line of message.split('\n')) {
		if (FENCE_MARKER.test(line)) is_in_fence = !is_in_fence
		out.push(rewrite_line(line, slug, is_in_fence))
	}

	return out.join('\n')
}

const issue_citation = {
	bare_references,
	cite_arguments,
	has_bare_reference,
	linkify,
	prose_lines,
	unquoted_references,
}

export { issue_citation }
