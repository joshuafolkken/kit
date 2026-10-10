import { bash_triggers } from './bash-triggers'
import { gh_api } from './gh-api'
import { prior_comment_read } from './prior-comment-read'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `issue-comments` row of `delivered-rules.ts`, moved
// out of the enumeration so the list stays a list.

// **A shell line carries several commands, and the subcommand has to be the one being invoked.**
// Each segment is judged on its own, anchored at its start, so `gh issue comment <N> -b "… gh issue
// view <N> …"` is read as the write it is rather than as the read it quotes. The cut itself is
// `shell-segments.ts`, shared with the triggers that need the same one.
// Global flags may precede the subcommand (`gh --repo o/r issue view 1`), so they are skipped —
// the same optional-flag prefix `gh-api.ts` skips in front of `api`, shared from there.
const ISSUE_VIEW_COMMAND = new RegExp(String.raw`^gh\s+${gh_api.GH_FLAGS}issue\s+view\s`, 'u')
// `…/issues/<N>` — **one** Issue's body. The number has to end the path, so the listing
// (`…/issues`) and every sub-resource under it (`…/issues/1319/comments`) are left alone.
const ISSUE_BODY_PATH = /repos\/[^\s'"]*\/issues\/\d+(?=$|["'\s])/u
// **A write to that path is not a read of it**, which is why the body read below asks `gh_api.is_read`:
// `gh api` sends POST as soon as any field flag appears, and `kickoff` PATCHes `…/issues/<N>` to
// normalize a title and to fill a blank body — so without the read check the delivery would be spent
// refusing a write, and the genuine body read later in the same run would never be guarded.
// A segment that fetches comments: the flag, a `comments` field in a `--json` projection, or the
// comments endpoint. The short `-c` is deliberately absent — it belongs to `wc`, `grep` and `sort`
// far more often than to `gh`, and reading it as "comments included" silenced the rule on any line
// that ended in a pipe. A run that types it pays one round trip instead.
const FETCHES_COMMENTS = /--comments\b|--json\s[\w,]*\bcomments\b|\/comments\b/u
const ISSUES_PATH = /repos\/[^\s'"]*\/issues\//u

// A field projection — `--jq` for `gh api`, `--json` for `gh issue view` — whose value never names the
// body. `gh api …/issues/<N> --jq '{state, labels}'` fetches the Issue only to read its state or its
// labels, which is a state check and not the body read this rule guards; a
// `--jq '.body'` still names the body and stays a body read. The value is taken quoted or bare, so the
// comma list `--json state,labels` and the expression `'{state, labels}'` are read the same way.
const FIELD_PROJECTION = /(?:--jq|--json)[= ]\s*('[^']*'|"[^"]*"|\S+)/u
const NAMES_THE_BODY = /\bbody\b/u

function projects_away_body(segment: string): boolean {
	const projection = FIELD_PROJECTION.exec(segment)

	return projection !== null && !NAMES_THE_BODY.test(projection[1] ?? '')
}

function is_body_read_segment(segment: string): boolean {
	if (projects_away_body(segment)) return false

	if (ISSUE_VIEW_COMMAND.test(segment)) return true

	return gh_api.is_gh_api(segment) && ISSUE_BODY_PATH.test(segment) && gh_api.is_read(segment)
}

// **An Issue's comments, not just any comments.** Batching pushes a run to fetch the body and the
// comments on one line, so the allowance has to reach across segments — but `gh pr view 42 --json
// comments` says nothing about whether *this* Issue was read whole, so the segment doing the
// fetching has to be an Issue read itself.
function fetches_issue_comments(segment: string): boolean {
	if (!FETCHES_COMMENTS.test(segment)) return false

	return (
		ISSUE_VIEW_COMMAND.test(segment) || (gh_api.is_gh_api(segment) && ISSUES_PATH.test(segment))
	)
}

// **The trigger is the body read, not the start of implementation.** The moment an Issue's body
// reaches a run is the moment the rule binds, and it is one shell call — the test
// `prompts/collaboration-workflow/rule-delivery.md` sets for leaving residency.
function is_body_only_issue_read(command: string): boolean {
	const segments = shell_segments.segments_of(command)

	if (segments.some((segment) => fetches_issue_comments(segment))) return false

	return segments.some((segment) => is_body_read_segment(segment))
}

// **Keeping the comments rule is fetching them**, in any of the spellings the refusal hands back.
function reads_issue_comments(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => fetches_issue_comments(segment))
}

// **The refusal hands over the command that fixes it**, because reading is not the same as
// obeying: a sentence saying "also read the comments" is prose that moves nothing, while a refused
// body read leaves the run holding the reissue that makes the comments *present*. The conflict rule
// ships with it — a delivery that said only "read them" would hand back the deciding at the moment
// nothing else is open to read.
//
// **The command comes first, the reason after**. The first line is the guard's
// label and then the call itself — `issue:read` prints the body and every comment in one read, `<N>`
// being the Issue the refused call named — so a run that reads only the opening still leaves holding
// the fix. The label keeps `time_transcript_line.guard_from_refusal` naming this guard, not the command.
const ISSUE_COMMENTS_REASON =
	'⛔ issue comments: pnpm josh issue:read <N>\n' +
	"Run that in place of this read: <N> is the Issue it names, and an Issue's comments are part of " +
	'the Issue, so the body and every comment come back together. Without josh, add ' +
	"`gh api repos/{owner}/{repo}/issues/<N>/comments --jq '.[] | {user: .user.login, created_at, " +
	"body}'` beside the body read, or `gh issue view <N> --comments` where GraphQL is reachable.\n" +
	'Why: a decision recorded after the body was written lives only in a comment — a corrected ' +
	'diagnosis (joshuafolkken/kit#1537), a changed default and an added acceptance criterion ' +
	'(joshuafolkken/kit#1520), a scope handed to another Issue (joshuafolkken/kit#1304) — and ' +
	'nothing in the body says it was superseded, so a body-only reader builds the wrong thing and ' +
	'sees no contradiction. ' +
	'Then the later text is the agreement in force — a comment supersedes the body it contradicts — ' +
	"except for two answers that are not the run's to make: work a comment reassigns to another " +
	'Issue is out of scope and is not implemented, and a comment saying the Issue no longer has a ' +
	'reason to exist stops the run with a `confirmation` Telegram. The procedure is ' +
	'`.claude/skills/workflow-commands/issue-comments.md`. ' +
	'Every body-only read is refused until the comments are read.'

// The enumeration row itself, so `delivered-rules.ts` spreads one entry. `already_satisfied` stands it
// down once the comments are on the transcript tail, and until then it refuses every body-only read.
const ROW = {
	id: 'issue-comments',
	is_trigger: bash_triggers.on_bash_command(is_body_only_issue_read),
	reason: ISSUE_COMMENTS_REASON,
	already_satisfied: prior_comment_read.already_read_for_call,
	keeps: bash_triggers.on_bash_command(reads_issue_comments),
	// The opening the reason carried before it led with the command.
	former_reasons: ["⛔ an Issue's comments are part of the Issue: read them before implementing"],
}

const issue_comments = {
	ISSUE_COMMENTS_REASON,
	ROW,
	is_body_only_issue_read,
}

export { issue_comments }
