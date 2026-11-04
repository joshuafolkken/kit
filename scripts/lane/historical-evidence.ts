import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import { FULL_PAGE_QUERY, git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { read_pull } from '#scripts/gh/git-gh-pr-read'
import { git_closes_keyword } from '#scripts/git/git-closes-keyword'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { review_comment_round } from '#scripts/review/review-comment-round'
import { z } from 'zod'
import { historical_log_evidence } from './historical-log-evidence'

type EvidenceKind =
	'plan' | 'handoff' | 'review-record' | 'commit' | 'merge' | 'ship-review' | 'pinned'

interface HistoricalEvidence {
	kind: EvidenceKind
	at: string
	source: string
}

interface EvidenceRead {
	evidence: ReadonlyArray<HistoricalEvidence>
	// Failed reads stay distinguishable from an empty history; other sources can still contribute.
	unreadable: ReadonlyArray<string>
}

interface EvidenceRequest {
	issue: number
	// The caller's PR, checked against its closing keyword before its dates are used.
	pr_number?: number | undefined
}

const committer_schema = z.object({ date: z.string().nullish() }).nullish()
const commit_schema = z.object({
	html_url: z.string(),
	commit: z.object({ committer: committer_schema }),
})

function point(
	kind: EvidenceKind,
	at: string | undefined,
	source: string | undefined,
): Array<HistoricalEvidence> {
	if (
		at === undefined ||
		source === undefined ||
		!z.iso.datetime({ offset: true }).safeParse(at).success
	) {
		return []
	}

	return [{ kind, at, source }]
}

function comment_kind(comment: IssueComment): EvidenceKind | undefined {
	if (backlog_plan_comment.plan_of([comment]) !== undefined) return 'plan'
	const [heading] = review_comment_round.body_of([]).split('\n', 1)
	if (heading !== undefined && comment.body.startsWith(heading)) return 'review-record'
	if (/^#{1,3} (?:Handoff|引き継ぎ)(?:\s|$)/imu.test(comment.body)) return 'handoff'

	return undefined
}

function comment_points(comment: IssueComment): Array<HistoricalEvidence> {
	if (comment.is_trusted !== true) return []
	const kind = comment_kind(comment)

	return kind === undefined ? [] : point(kind, comment.created_at, comment.html_url)
}

async function comments(issue: number): Promise<EvidenceRead> {
	const raw = await git_gh_issue_read.issue_list_comments(String(issue))
	const parsed = await issue_read.parse_comments(raw)

	return parsed === undefined
		? { evidence: [], unreadable: ['comments'] }
		: { evidence: parsed.flatMap((comment) => comment_points(comment)), unreadable: [] }
}

async function commits(pr_number: number): Promise<ReadonlyArray<HistoricalEvidence>> {
	const raw = await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.pull_api_path(String(pr_number))}/commits${FULL_PAGE_QUERY}`,
		should_paginate: true,
	})
	const listing = read_json_listing(raw, commit_schema)
	if (listing.kind !== 'read') throw new Error('Could not read historical PR commits')

	return listing.rows.flatMap((row) =>
		point('commit', row.commit.committer?.date ?? undefined, row.html_url),
	)
}

async function pull({ issue, pr_number }: EvidenceRequest): Promise<EvidenceRead> {
	if (pr_number === undefined) return { evidence: [], unreadable: [] }
	const detail = await read_pull(pr_number)

	if (git_closes_keyword.parse_closes_issue_number(detail.body ?? '') !== String(issue)) {
		return { evidence: [], unreadable: ['pull does not close this issue'] }
	}

	const evidence = point('merge', detail.merged_at ?? undefined, detail.html_url)

	return { evidence: [...evidence, ...(await commits(pr_number))], unreadable: [] }
}

async function safely(
	read_source: () => Promise<EvidenceRead>,
	source: string,
): Promise<EvidenceRead> {
	try {
		return await read_source()
	} catch {
		return { evidence: [], unreadable: [source] }
	}
}

async function read(request: EvidenceRequest): Promise<EvidenceRead> {
	const results = await Promise.all([
		safely(async () => await comments(request.issue), 'comments'),
		safely(async () => await pull(request), 'pull'),
		safely(async () => await historical_log_evidence.read(request.issue), 'logs'),
	])

	return {
		evidence: results
			.flatMap((result) => result.evidence)
			.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at)),
		unreadable: results.flatMap((result) => result.unreadable),
	}
}

const historical_evidence = { read }

export { historical_evidence }
export type { EvidenceKind, EvidenceRead, EvidenceRequest, HistoricalEvidence }
