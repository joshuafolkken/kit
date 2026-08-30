import { git_epic_parse, type ExternalChild } from './git-epic-parse'
import { git_gh_command } from './git-gh-command'
import { read_json_listing } from './parse-json-array'
import { rest_comment_schema, type RestCommentData } from './schemas'

// The comment the epic auto-close announces itself with, and how a run recognizes the one a previous
// run already posted.
//
// Kept apart from `git-epic-close.ts` because the two answer different questions — that file decides
// *whether* an epic may close, this one decides what the announcement says and whether it is already
// there — and because the file it was split from is within twenty lines of the three hundred a file
// may hold (joshuafolkken/kit#1039).

// The epic's children, near and far. Named structurally rather than by importing `EpicIssue`: the
// dependency runs one way, from the auto-close to here, and a type import back would put a cycle
// between two files that have no reason to know each other's shapes.
interface EpicChildren {
	children: ReadonlyArray<number>
	external_children: ReadonlyArray<ExternalChild>
}

// The fixed sentence the announcement's prose ends with. It is what a person reads, and it is no
// longer what the retry check matches on (joshuafolkken/kit#1068): people and agents quote the
// auto-close output in ordinary issue comments, and matching prose made any such quote answer
// "already announced" — the epic then closed with no comment, losing the record of which children it
// closed against.
const CLOSE_ANNOUNCEMENT = 'Closing this epic automatically.'

// The marker, which GitHub renders as nothing at all. Quoting the sentence above therefore no longer
// suppresses anything: what is quoted is the rendered text, and the marker is not in it.
//
// **It carries the child set the announcement named.** That is what makes an epic which was
// reopened, gained a child and completed again announce a *second* time instead of closing silently
// against a stale list. joshuafolkken/kit#1039 rejected matching the whole composed body for a
// neighboring reason — the visible child list varies, so an unchanged epic would have been read as
// "not posted yet" whenever the wording drifted — and the marker keeps that failure out by being
// built from the child set alone: the prose can be rephrased without moving it, and the set is
// compared as a set, so reordering the epic's task list does not move it either.
const MARKER_OPEN = '<!-- josh:epic-auto-close children='
const MARKER_CLOSE = ' -->'

// Every child, near and far. Listing only the local ones left an all-external epic announcing "All
// child issues are closed ()" (joshuafolkken/kit#864).
function child_references(epic: EpicChildren): Array<string> {
	return [
		...epic.children.map((child) => `#${String(child)}`),
		...epic.external_children.map((child) => `${child.repo}#${String(child.number)}`),
	]
}

function build_marker(epic: EpicChildren): string {
	return `${MARKER_OPEN}${child_references(epic).join(',')}${MARKER_CLOSE}`
}

// Four spaces open a markdown code block, so a line indented that far is quoted text rather than
// the announcement's own marker — and the announcement never indents its marker at all.
const INDENTED_CODE_SPACES = 4

function indent_of(line: string): number {
	return line.length - line.trimStart().length
}

// The child set a marker line records, or `undefined` for any other line. The empty filter is what
// keeps an epic tracking nothing from reading as tracking one nameless child.
function marker_children(line: string): Array<string> | undefined {
	if (indent_of(line) >= INDENTED_CODE_SPACES) return undefined

	const trimmed = line.trim()
	if (!trimmed.startsWith(MARKER_OPEN)) return undefined
	if (!trimmed.endsWith(MARKER_CLOSE)) return undefined

	const listed = trimmed.slice(MARKER_OPEN.length, -MARKER_CLOSE.length)

	return listed.split(',').filter((reference) => reference.length > 0)
}

// Compared as sets rather than as strings: the marker is written in whatever order the epic happens
// to list its children, and reordering a task list changes neither the batch nor what was announced
// about it. Comparing the rendered strings would have needed a canonical order, and every ordering
// available for `owner/repo#N` text is either locale-dependent or a lint exception — a set says what
// is actually meant and is the same answer on every machine.
function is_same_children(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
	const left_set = new Set(left)
	const right_set = new Set(right)

	return left_set.size === right_set.size && [...left_set].every((one) => right_set.has(one))
}

// The prose the reader sees, then the marker the next run matches on.
function build_close_comment(epic: EpicChildren): string {
	return `All child issues are closed (${child_references(epic).join(', ')}). ${CLOSE_ANNOUNCEMENT}\n\n${build_marker(epic)}`
}

// MIGRATION ONLY (joshuafolkken/kit#1068) — remove together with `is_legacy_announcement`.
//
// Announcements posted by v1.179.0 through the release before this one carry no marker, so an epic
// sitting in the half-succeeded state right now would be read as "not announced" and receive the
// second comment joshuafolkken/kit#1039 removed. This matches those.
//
// **The wording here is a frozen copy of what was released, not a second spelling of the constants
// above.** Deriving it from them would make a future rephrasing of the announcement silently stop
// matching comments already on GitHub, which no edit can change.
//
// It matches only a comment whose **entire** body is the old announcement — which is what the
// auto-close posted, and what a quote never is: a quote sits inside prose, or behind `> `, or in a
// fence, and none of those trim down to this.
//
// **When it can be removed:** once no *open* epic can still carry a marker-less announcement. Closed
// epics do not matter — the auto-close reads its candidates from a `state=open` listing, so they are
// never considered. Establish it by listing the open epics and looking for one whose comments hold a
// body matching this pattern:
//
//   gh issue list --label epic --state open --json number --jq '.[].number' |
//     while read -r n; do
//       gh api "repos/{owner}/{repo}/issues/$n/comments" --paginate --jq '.[].body' |
//         grep -c '^All child issues are closed (.*)\. Closing this epic automatically\.$'
//     done
//
// A total of zero means every remaining announcement carries the marker; delete this constant,
// `is_legacy_announcement`, and the tests naming them.
const LEGACY_ANNOUNCEMENT_PATTERN =
	/^All child issues are closed \([^)]*\)\. Closing this epic automatically\.$/u

function is_legacy_announcement(body: string): boolean {
	return LEGACY_ANNOUNCEMENT_PATTERN.test(body.trim())
}

// Whether the epic already carries the announcement.
//
// `unreadable` is deliberately not folded into `absent`, though the caller acts the same way on
// both: a listing that could not be read says nothing about what is on the issue, and reporting it
// as "nothing is there" would have the run state a fact it never established — the misread
// joshuafolkken/kit#973 and joshuafolkken/kit#959 were each about. Keeping it apart is what lets
// `git-epic-close.ts` say out loud that the duplicate check did not run, which is the whole
// difference between the two answers there.
//
// **Both of `read_json_listing`'s gaps arrive as `unreadable`**, rows the schema rejects included.
// `parse_json_array_or_undefined` rethrows that one, which is right where a shape change should stay
// visible — and wrong here: this answer decides whether a *write* posts, so an exception in place of
// the safe answer is the one outcome the function must not produce.
type CloseCommentState = 'present' | 'absent' | 'unreadable'

// The marker has to be a line of its own, outside any fence — not merely present in the body. A
// quote is exactly what must not suppress the next announcement, and the two ways of quoting an
// announcement carry the raw marker along with everything else: GitHub's "Quote reply" puts every
// line behind `> `, which the line comparison rejects, and a code block reproduces the marker line
// verbatim — a fenced one caught by the mask, an indented one by the indent check. `fence_mask` is the same walk every other body predicate
// in this codebase reads through, rather than a second one written here (joshuafolkken/kit#890).
function has_marker(body: string, children: ReadonlyArray<string>): boolean {
	const mask = git_epic_parse.fence_mask(body)

	return body.split('\n').some((line, index) => {
		if (mask[index] !== true) return false

		const announced = marker_children(line)

		return announced !== undefined && is_same_children(announced, children)
	})
}

function has_announcement(
	comments: ReadonlyArray<RestCommentData>,
	children: ReadonlyArray<string>,
): boolean {
	return comments.some((comment) => {
		const body = comment.body ?? ''

		return has_marker(body, children) || is_legacy_announcement(body)
	})
}

// One request, and it is spent only on a run that is about to close an epic: the caller reaches this
// after every child has been read and found closed, which happens once in an epic's life. Every
// other `josh followup` run leaves the epic short of complete and never gets here, so the ordinary
// path costs nothing.
//
// An epic that has already **closed** is a different situation and never arrives here at all: the
// auto-close reads its candidates from an `state=open` listing (`git-gh-issue-list.ts`), so a closed
// epic is not among them and no comment of any kind is considered for it.
async function read_close_comment_state(
	epic_number: string,
	epic: EpicChildren,
): Promise<CloseCommentState> {
	const raw_json = await git_gh_command.issue_list_comments(epic_number)
	if (raw_json === undefined) return 'unreadable'

	const listing = read_json_listing(raw_json, rest_comment_schema)
	if (listing.kind !== 'read') return 'unreadable'

	return has_announcement(listing.rows, child_references(epic)) ? 'present' : 'absent'
}

const git_epic_close_comment = {
	build_close_comment,
	read_close_comment_state,
}

export type { CloseCommentState, EpicChildren }
export { git_epic_close_comment, CLOSE_ANNOUNCEMENT }
