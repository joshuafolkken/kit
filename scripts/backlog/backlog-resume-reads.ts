import { epic_audit_logic } from '#scripts/epic/epic-audit'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { GRAPHQL_PATH } from '#scripts/gh/git-gh-pr-graphql-state'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { run_pause_comment } from '#scripts/run/pause/run-pause-comment'
import { z } from 'zod'

// One `backlog:next` scan's resume signals in a constant number of reads (joshuafolkken/kit#6610),
// not three per child: the open pull requests matched by the issues their bodies cite, and every child's newest
// comments in one GraphQL query. A child that window cannot settle — more comments than it holds, no
// answer, or GraphQL refused (403 in a cloud session) — falls back to its own paged comment read.

const COMMENTS_WINDOW = 100
const LINE_SEPARATOR = '\n'
const OPEN_PULLS_QUERY = '/pulls?state=open&per_page=100'
const PULL_FILTER = '.[] | {body: (.body // "")}'
const ALIAS_PREFIX = 'i'

const pull_schema = z.object({ body: z.string() })
const comment_schema = z.looseObject({ body: z.string().nullish() })
const page_info_schema = z.looseObject({ hasPreviousPage: z.boolean() })
const comments_schema = z.looseObject({
	pageInfo: page_info_schema,
	nodes: z.array(comment_schema),
})
const issue_node_schema = z.looseObject({ comments: comments_schema }).nullable()
const repository_schema = z.record(z.string(), issue_node_schema)
const response_schema = z.looseObject({ data: z.looseObject({ repository: repository_schema }) })

type IssueNode = z.infer<typeof issue_node_schema>
type CommentWindows = Partial<Record<string, IssueNode>>

function referenced_issues_of(line: string, repo: string): Array<string> {
	const pull = parse_json_object_or_undefined(line, pull_schema)

	if (pull === undefined) {
		throw new Error('the open pull request listing contains an unreadable row')
	}

	return epic_audit_logic.parse_references(pull.body, repo).map(String)
}

// Any reference counts, not only `closes #N`: the per-child timeline read this replaces counted every
// open pull request here that cross-referenced the child (#6440).
async function open_pr_issues(repo: string): Promise<ReadonlySet<string>> {
	const raw = await git_gh_exec.exec_gh_api({
		path: `${git_gh_api_path.repo_api_path(repo)}${OPEN_PULLS_QUERY}`,
		should_paginate: true,
		jq_filter: PULL_FILTER,
	})

	return new Set(
		raw
			.split(LINE_SEPARATOR)
			.filter((line) => line.trim() !== '')
			.flatMap((line) => referenced_issues_of(line, repo)),
	)
}

function alias_of(issue: string): string {
	return `${ALIAS_PREFIX}${issue}`
}

function comments_query(issues: ReadonlyArray<string>): string {
	const fields = issues.map(
		(issue) =>
			`${alias_of(issue)}: issue(number: ${issue}) { comments(last: ${String(COMMENTS_WINDOW)}) { pageInfo { hasPreviousPage } nodes { body } } }`,
	)

	return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join(' ')} } }`
}

async function read_windows(issues: ReadonlyArray<string>, repo: string): Promise<CommentWindows> {
	const separator = repo.indexOf('/')
	const owner = repo.slice(0, separator)
	const name = repo.slice(separator + 1)

	try {
		const json = await git_gh_exec.exec_gh_api({
			path: GRAPHQL_PATH,
			body: JSON.stringify({ query: comments_query(issues), variables: { owner, name } }),
		})

		return parse_json_object_or_undefined(json, response_schema)?.data.repository ?? {}
	} catch {
		return {}
	}
}

// `undefined` when the window cannot settle it: no answer, or older comments past the window.
function window_verdict(issue: string, node: IssueNode | undefined): boolean | undefined {
	if (node === undefined || node === null) return undefined
	const marker = run_pause_comment.marker_of(issue)
	if (node.comments.nodes.some((comment) => comment.body?.includes(marker) === true)) return true

	return node.comments.pageInfo.hasPreviousPage ? undefined : false
}

async function paused_issues(
	issues: ReadonlyArray<string>,
	repo: string,
): Promise<ReadonlySet<string>> {
	if (issues.length === 0) return new Set()
	const windows = await read_windows(issues, repo)
	const verdicts = await Promise.all(
		issues.map(
			async (issue) =>
				window_verdict(issue, windows[alias_of(issue)]) ??
				(await run_pause_comment.is_paused(issue)),
		),
	)

	return new Set(issues.filter((_issue, index) => verdicts[index] === true))
}

const backlog_resume_reads = { open_pr_issues, paused_issues }

export { backlog_resume_reads }
