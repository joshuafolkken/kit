import type { ExternalChild } from './git-epic-parse'
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

// The fixed sentence the announcement ends with, and the marker the retry check matches on.
//
// **The comment is built from it, not written beside it.** A marker declared separately drifts the
// first time the wording is edited, and the drift is silent: the check simply stops matching and the
// duplicate comes back. Composing the comment out of the constant makes that impossible — a
// rephrasing moves both at once, or neither.
//
// It is the marker rather than the whole body because the child list in front of it varies: an epic
// that gained or lost a child between two attempts would compose a different sentence, and matching
// the whole body would then read as "not posted yet".
const CLOSE_ANNOUNCEMENT = 'Closing this epic automatically.'

// Every child, near and far. Listing only the local ones left an all-external epic announcing "All
// child issues are closed ()" (joshuafolkken/kit#864).
function build_close_comment(epic: EpicChildren): string {
	const list = [
		...epic.children.map((child) => `#${String(child)}`),
		...epic.external_children.map((child) => `${child.repo}#${String(child.number)}`),
	].join(', ')

	return `All child issues are closed (${list}). ${CLOSE_ANNOUNCEMENT}`
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

function has_announcement(comments: ReadonlyArray<RestCommentData>): boolean {
	return comments.some((comment) => (comment.body ?? '').includes(CLOSE_ANNOUNCEMENT))
}

// One request, and it is spent only on a run that is about to close an epic: the caller reaches this
// after every child has been read and found closed, which happens once in an epic's life. Every
// other `josh followup` run leaves the epic short of complete and never gets here, so the ordinary
// path costs nothing.
//
// An epic that has already **closed** is a different situation and never arrives here at all: the
// auto-close reads its candidates from an `state=open` listing (`git-gh-issue-list.ts`), so a closed
// epic is not among them and no comment of any kind is considered for it.
async function read_close_comment_state(epic_number: string): Promise<CloseCommentState> {
	const raw_json = await git_gh_command.issue_list_comments(epic_number)
	if (raw_json === undefined) return 'unreadable'

	const listing = read_json_listing(raw_json, rest_comment_schema)
	if (listing.kind !== 'read') return 'unreadable'

	return has_announcement(listing.rows) ? 'present' : 'absent'
}

const git_epic_close_comment = {
	build_close_comment,
	read_close_comment_state,
}

export type { CloseCommentState, EpicChildren }
export { git_epic_close_comment, CLOSE_ANNOUNCEMENT }
