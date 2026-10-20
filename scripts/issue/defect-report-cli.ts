import { FULL_PAGE_QUERY, git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { parse_json } from '#scripts/git/parse-json-array'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { z } from 'zod'
import { defect_report, type OriginPr, type ReportIssue } from './defect-report'
import { defect_report_format } from './defect-report-format'
import { session_cite } from './session-cite'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const PR_CONCURRENCY = 4
const USAGE = 'Usage: pnpm josh defect:report'
const UNREADABLE_MESSAGE =
	'Could not read the bug issues from GitHub, so no report is printed — check `gh auth status`.'

const issue_schema = z.object({
	number: z.number(),
	created_at: z.string(),
	body: z.string().nullish(),
	pull_request: z.unknown().optional(),
})
const pull_schema = z.object({ merged_at: z.string().nullish() })
const file_schema = z.object({
	filename: z.string(),
	status: z.string(),
	additions: z.number(),
	deletions: z.number(),
})

// Every issue labelled `bug`, open or closed — the label `issue:file` derives from the declaration.
// The issues listing carries pull requests too, so those are dropped.
async function read_issues(repo: string): Promise<ReadonlyArray<ReportIssue> | undefined> {
	const raw = await git_gh_exec.exec_gh_api({
		path: `repos/${repo}/issues?labels=bug&state=all&per_page=100`,
		should_paginate: true,
	})
	const issues = parse_json.parse_json_object_or_undefined(raw, z.array(issue_schema))

	return issues
		?.filter((issue) => issue.pull_request === undefined)
		.map((issue) => ({
			number: issue.number,
			created_at: issue.created_at,
			body: issue.body ?? '',
		}))
}

async function read_pr(repo: string, pr: number): Promise<OriginPr | undefined> {
	const path = git_gh_api_path.pull_api_path(String(pr), repo)
	const [pull_raw, files_raw] = await Promise.all([
		git_gh_exec.exec_gh_api({ path }),
		git_gh_exec.exec_gh_api({ path: `${path}/files${FULL_PAGE_QUERY}`, should_paginate: true }),
	])
	const pull = parse_json.parse_json_object_or_undefined(pull_raw, pull_schema)
	const files = parse_json.parse_json_object_or_undefined(files_raw, z.array(file_schema))

	if (pull === undefined || files === undefined) return undefined

	return {
		pr,
		merged_at: pull.merged_at ?? '',
		kind: defect_report.change_kind(files),
		areas: defect_report.areas(files),
	}
}

// A pull request that cannot be read contributes nothing, and the report counts it as unread.
async function read_pr_or_none(repo: string, pr: number): Promise<ReadonlyArray<OriginPr>> {
	try {
		const origin = await read_pr(repo, pr)

		return origin === undefined ? [] : [origin]
	} catch {
		return []
	}
}

async function read_prs(repo: string, prs: ReadonlyArray<number>): Promise<Map<number, OriginPr>> {
	const read = await bounded_pool.bounded_map(
		prs,
		PR_CONCURRENCY,
		async (pr) => await read_pr_or_none(repo, pr),
	)

	return new Map(read.flat().map((origin) => [origin.pr, origin]))
}

function unreadable(): number {
	console.error(UNREADABLE_MESSAGE)

	return FAILURE_EXIT_CODE
}

async function report(repo: string): Promise<number> {
	const issues = await read_issues(repo)

	if (issues === undefined) return unreadable()

	const prs = await read_prs(repo, defect_report.origin_prs(issues))

	const aggregated = defect_report.aggregate(issues, prs)

	console.info(session_cite.text(defect_report_format.format(aggregated)))

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length > 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	try {
		const repo = await git_gh_command.repo_get_name_with_owner()

		return repo === undefined ? unreadable() : await report(repo)
	} catch {
		return unreadable()
	}
}

const defect_report_cli = { run }

export { defect_report_cli }
