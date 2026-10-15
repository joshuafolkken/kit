import { createHash } from 'node:crypto'
import { issue_auto_ok, type AutoOkDecision } from '#scripts/issue/issue-auto-ok'
import { AUTO_OK_LABEL, has_label_name } from '#scripts/issue/issue-labels'
import type { WatchComment } from '#scripts/issue/issue-watch-diff'

// The pure half of `josh auto-ok:judge`: which open issues `backlogrun` judges for `auto-ok` when a lane
// is free and nothing is opted in, and whether one was already judged (joshuafolkken/kit#3854).
//
// **The mechanical exclusions are `issue_auto_ok.exclusion_of`**, the list a filing is judged by
// (joshuafolkken/kit#3853), never a second one. What a label cannot answer — whether a policy decision,
// an external account or a human visual check is needed — is the agent's reading of the body and the
// comments, so this module only says which issues still owe that reading.
//
// **The record is the judgement comment itself.** It carries a digest of the body it judged, so an
// issue is judged again only when its body changed or a person commented after it — the same line
// `issue_watch_diff` draws between a person's update and an automated one.

interface JudgeIssue {
	number: number
	labels: ReadonlyArray<string>
	body: string
}

const MARKER_PREFIX = '<!-- josh:auto-ok-judged body='
const MARKER_SUFFIX = ' -->'
const MARKER_PATTERN = /<!-- josh:auto-ok-judged body=(?<digest>[\da-f]+) -->/u
const DIGEST_LENGTH = 16
const CRLF = '\r\n'
const LF = '\n'

function is_candidate(issue: JudgeIssue): boolean {
	if (has_label_name(issue.labels, AUTO_OK_LABEL)) return false

	return issue_auto_ok.exclusion_of(issue.labels) === undefined
}

// GitHub stores a body saved in its web editor with CRLF, so the digest is taken over LF alone.
function body_digest(body: string): string {
	const normalized = body.split(CRLF).join(LF)

	return createHash('sha256').update(normalized).digest('hex').slice(0, DIGEST_LENGTH)
}

function digest_of(comment: WatchComment): string | undefined {
	return MARKER_PATTERN.exec(comment.body)?.groups?.['digest']
}

// Judged when the newest judgement comment covers the body as it stands and no person has commented
// since. A failed comment read never reaches here — the caller treats it as nothing learned.
function is_judged(body: string, comments: ReadonlyArray<WatchComment>): boolean {
	const judgement = comments.findLast((comment) => digest_of(comment) !== undefined)

	if (judgement === undefined || digest_of(judgement) !== body_digest(body)) return false

	return comments.every((comment) => comment.id <= judgement.id || comment.is_automated)
}

function comment_of(decision: AutoOkDecision, body: string): string {
	const marker = `${MARKER_PREFIX}${body_digest(body)}${MARKER_SUFFIX}`

	return `${issue_auto_ok.line_of(decision)}${LF}${LF}${marker}`
}

const auto_ok_judge = { comment_of, is_candidate, is_judged }

export type { JudgeIssue }
export { auto_ok_judge }
