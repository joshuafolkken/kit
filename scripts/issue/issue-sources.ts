import type { IssueComment } from './issue-read'
import { issue_read_cli, type IssueContent } from './issue-read-cli'

// **The trusted texts of one issue, each with its origin, in the order they were written** — the
// evidence a judgment child is handed. It reuses `issue:read`'s read and its per-author trust rather
// than reading or deciding either again. An untrusted text is dropped and only counted: it is never
// handed over as an instruction. A trust lookup that failed is its own failure, never read as "no
// trusted answer", and every failed read but a missing issue can be retried.

const BODY_ID = 'body'

// `order` is the place among the sources handed over, in written order — an untrusted text leaves no
// gap, so the body is told by its `id`, never by `order === 0`. A comment's `author` and `created_at`
// carry `issue-read.ts`'s placeholders when GitHub gave none; only the body has neither.
interface IssueSource {
	id: string
	order: number
	author: string | undefined
	created_at: string | undefined
	text: string
}

type SourcesFailureKind = 'missing' | 'unreadable' | 'comments-unreadable' | 'trust-unknown'

type SourcesRead =
	| { kind: 'sources'; sources: ReadonlyArray<IssueSource>; untrusted_count: number }
	| { kind: SourcesFailureKind; is_retryable: boolean; hint?: string }

interface Candidate {
	id: string
	author: string | undefined
	created_at: string | undefined
	text: string
	is_trusted: boolean | undefined
}

// A comment with no `html_url` is still named, by its place among the comments.
function comment_candidate(comment: IssueComment, index: number): Candidate {
	return {
		id: comment.html_url ?? `comment-${String(index + 1)}`,
		author: comment.author,
		created_at: comment.created_at,
		text: comment.body,
		is_trusted: comment.is_trusted,
	}
}

function candidates_of(
	content: IssueContent,
	comments: ReadonlyArray<IssueComment>,
): ReadonlyArray<Candidate> {
	const { body, is_body_trusted } = content.fields
	const body_candidate: Candidate = {
		id: BODY_ID,
		author: undefined,
		created_at: undefined,
		text: body,
		is_trusted: is_body_trusted,
	}

	return [body_candidate, ...comments.map((comment, index) => comment_candidate(comment, index))]
}

function to_source(candidate: Candidate, order: number): IssueSource {
	const { id, author, created_at, text } = candidate

	return { id, order, author, created_at, text }
}

function to_sources(content: IssueContent): SourcesRead {
	if (content.comments === undefined) return { kind: 'comments-unreadable', is_retryable: true }

	const candidates = candidates_of(content, content.comments)

	if (candidates.some((candidate) => candidate.is_trusted === undefined)) {
		return { kind: 'trust-unknown', is_retryable: true }
	}

	const trusted = candidates.filter((candidate) => candidate.is_trusted === true)
	const sources = trusted.map((candidate, order) => to_source(candidate, order))

	return { kind: 'sources', sources, untrusted_count: candidates.length - trusted.length }
}

async function read_sources(issue_number: string, repo?: string): Promise<SourcesRead> {
	const result = await issue_read_cli.read_issue(issue_number, repo)

	if (result.kind === 'issue') return to_sources(result.content)

	const hint = result.hint === undefined ? {} : { hint: result.hint }

	return { kind: result.kind, is_retryable: result.kind !== 'missing', ...hint }
}

const issue_sources = { BODY_ID, read_sources, to_sources }

export type { IssueSource, SourcesRead }
export { issue_sources }
