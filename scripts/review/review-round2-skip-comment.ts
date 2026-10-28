import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { review_round2, type RoundTwoAnswer } from './review-round2'

// `josh review:round2 --record <N>` — the `## Round 2 skipped` comment `prompts/review.md` asks for,
// written by the command rather than assembled by the run (joshuafolkken/kit#5286). It names the arm
// that fired and quotes the reason line verbatim, so a defect found later can be traced to the delta
// that went unreviewed. **A re-run writes nothing twice**: a trusted comment already carrying the same
// heading and reason line is the record.

const HEADING = '## Round 2 skipped'
const ARMS: Readonly<Record<string, string>> = {
	[review_round2.CODE.EMPTY]: 'A — the fix delta is empty',
	[review_round2.CODE.INERT]: 'B — every fixed path leaves what executes unchanged',
}

type SkipRecord = 'posted' | 'present' | 'unreadable' | 'failed' | 'not-skipped'

function body_of(answer: RoundTwoAnswer): string {
	return [
		HEADING,
		'',
		`- arm: ${ARMS[answer.code] ?? answer.code}`,
		`- reason: ${answer.reason}`,
	].join('\n')
}

function is_recorded(comment: IssueComment, body: string): boolean {
	return comment.is_trusted === true && comment.body.trimStart().startsWith(body)
}

async function read_comments(issue: number): Promise<ReadonlyArray<IssueComment> | undefined> {
	return await issue_read.parse_comments(await git_gh_issue_read.issue_list_comments(String(issue)))
}

// `not-skipped` for a `required` answer: only a skip is recorded. An unreadable listing posts nothing
// rather than risk the duplicate the record exists to avoid.
async function record(issue: number, answer: RoundTwoAnswer): Promise<SkipRecord> {
	if (answer.verdict !== review_round2.SKIPPED_VERDICT) return 'not-skipped'

	const body = body_of(answer)
	const comments = await read_comments(issue)

	if (comments === undefined) return 'unreadable'

	if (comments.some((comment) => is_recorded(comment, body))) return 'present'

	return (await git_gh_issue_write.issue_try_comment(String(issue), body)) ? 'posted' : 'failed'
}

const review_round2_skip_comment = { body_of, HEADING, record }

export type { SkipRecord }
export { review_round2_skip_comment }
