import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { issue_read, type IssueComment } from './issue-read'

// Persist the author's conclusion with its evidence; drawing never infers a conclusion.
const SUMMARY_LIMIT = 80
const summary_schema = z
	.string()
	.min(1)
	.max(SUMMARY_LIMIT)
	.regex(/^[\u{20}-\u{7E}]+$/u)
	.refine((value) => value === value.trim())
const MARKER = /^<!-- josh:outcome (?<json>[^\n]+) -->$/gmu
const COMMENT_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+#issuecomment-\d+$(?![\s\S])/u
const url_schema = z.string().regex(COMMENT_URL)
const outcome_schema = z.object({ summary: summary_schema, url: url_schema.optional() })

interface IssueOutcome {
	summary: string
	url: string
}

interface OutcomeNote {
	body: string
	summary?: string | undefined
	url?: string | undefined
}

function body_of(note: OutcomeNote): string {
	if (note.summary === undefined && note.url === undefined) return note.body
	const outcome = outcome_schema.parse({ summary: note.summary, url: note.url })

	return `${note.body}\n\n<!-- josh:outcome ${JSON.stringify(outcome)} -->`
}

function evidence_of(comment: IssueComment, url: string): boolean {
	if (comment.html_url === undefined || !COMMENT_URL.test(url)) return false

	return url.split('#', 1)[0] === comment.html_url.split('#', 1)[0]
}

function record_of(body: string): z.infer<typeof outcome_schema> | undefined {
	const json = [...body.matchAll(MARKER)].at(-1)?.groups?.['json']

	return json_value.parse_with(json ?? '', outcome_schema)
}

function cited_outcome(
	record: z.infer<typeof outcome_schema>,
	comment: IssueComment,
): IssueOutcome | undefined {
	const url = record.url ?? comment.html_url

	return url === undefined || !evidence_of(comment, url)
		? undefined
		: { summary: record.summary, url }
}

function outcome_of(comment: IssueComment): IssueOutcome | undefined {
	if (comment.is_trusted !== true) return undefined
	const record = record_of(comment.body)

	return record === undefined ? undefined : cited_outcome(record, comment)
}

function from_comments(
	comments: ReadonlyArray<IssueComment>,
	candidates: ReadonlyArray<IssueComment> = comments,
): IssueOutcome | undefined {
	const outcomes = candidates.flatMap((comment) => {
		const outcome = outcome_of(comment)
		const evidence = comments.find((entry) => entry.html_url === outcome?.url)

		return outcome === undefined || evidence?.is_trusted !== true ? [] : [outcome]
	})

	return outcomes.at(-1)
}

async function read(issue: number): Promise<IssueOutcome | undefined> {
	try {
		const json = await git_gh_issue_read.issue_list_comments(
			String(issue),
			undefined,
			undefined,
			git_gh_issue_read.read_comments_conditionally,
		)
		const comments = json === undefined ? undefined : await issue_read.parse_comments(json)

		return comments === undefined ? undefined : from_comments(comments)
	} catch {
		return undefined
	}
}

async function recorded(issue: number, is_merged: boolean): Promise<{ outcome?: IssueOutcome }> {
	if (is_merged) return {}
	const outcome = await read(issue)

	return outcome === undefined ? {} : { outcome }
}

const issue_outcome = { body_of, from_comments, read, recorded, summary_schema, url_schema }

export { issue_outcome }
export type { IssueOutcome }
