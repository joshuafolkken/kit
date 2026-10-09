import { epic_parse } from '#scripts/epic/epic-parse'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { parse_json_object_safe } from '#scripts/git/parse-json-array'
import { session_cite } from '#scripts/issue/session-cite'
import { poll, type PollOptions } from '#scripts/lib/poll'
import { z } from 'zod'

// **A merged pull request whose `closes #N` GitHub did not apply**. GitHub can leave the issue open
// although the merge request, the merging account and the `closes #N` first line are all correct;
// the run would then report success, and a `backlogrun` would read the still-open child as a failure
// and stop.
//
// **The issue's state is what is checked, not `closingIssuesReferences`.** That field is GraphQL-only
// (a cloud session is answered 403 there) and it is not the fact that fails: it can name an issue
// the pull request never closed. The observable defect is an issue left open, so that is what is
// read, and what is repaired.
//
// **A short wait first**, because GitHub applies the keyword asynchronously — the closes it did apply
// landed within a second of the merge. Closing on the first read would take the close away from the
// pull request on every run that merely raced it.
const CLOSE_WAIT: PollOptions = { attempts: 3, interval_ms: 2000 }

const CLOSE_RECOVERY = 'gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f state=closed'

const state_read_schema = z.object({ state: z.string().optional() })

async function is_issue_closed(issue_number: string): Promise<boolean> {
	const raw = await git_gh_command.issue_get_state_and_relations(issue_number)
	const parsed = raw === undefined ? undefined : parse_json_object_safe(raw, state_read_schema)

	return epic_parse.is_state_closed(parsed?.state)
}

const FOLLOWUP_CLOSER = 'pnpm josh followup'

// English, like every other string a script posts: the comment says why the close came from this
// command rather than from the pull request, so a reader of the issue is not left guessing. `closer`
// names the command that closed it — `followup` at the merge, or `run:merge` when a `backlogrun`
// finds the child still open afterwards.
function build_close_comment(pr_url: string | undefined, closer: string = FOLLOWUP_CLOSER): string {
	return (
		`Closed by \`${closer}\`: ${pr_url ?? 'the merged pull request'} merged, ` +
		'but GitHub did not apply its ' +
		'`closes #N` keyword (joshuafolkken/kit#2770).'
	)
}

// **Throws when the issue is still open**, so the guard around it reports the failure with the
// command that finishes it by hand — an issue left open after a merge is the one thing this step
// exists to stop going unnoticed.
async function ensure_issue_closed(
	input: { issue_number: string | undefined; pr_url: string | undefined; closer?: string },
	wait: PollOptions = CLOSE_WAIT,
): Promise<void> {
	const { issue_number } = input
	const is_done =
		issue_number === undefined ||
		(await poll.poll_until(async () => await is_issue_closed(issue_number), wait))
	if (is_done) return

	console.warn(
		`⚠️  Issue ${session_cite.issue(issue_number)} is still open after the merge — closing it.`,
	)
	const comment = build_close_comment(input.pr_url, input.closer)

	if (!(await git_gh_command.issue_close(issue_number, comment))) {
		throw new Error(`gh api could not close issue ${session_cite.issue(issue_number)}`)
	}
}

const git_followup_issue_close = {
	ensure_issue_closed,
	build_close_comment,
	CLOSE_RECOVERY,
}

export { git_followup_issue_close }
