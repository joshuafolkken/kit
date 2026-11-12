#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { epic_audit_logic } from '#scripts/epic/epic-audit'
import { epic_issue, type EpicIssue } from '#scripts/epic/epic-issue'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { github_issue_url, type IssueUrlTarget } from '#scripts/gh/github-issue-url'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { error_text } from '#scripts/lib/error-message'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh split:recover <origin> <child-issue-url>'
const FIELDS = 'number,body,labels,url'

function has_parent(
	child: EpicIssue,
	origin: string,
	repository: string,
	child_repo: string,
): boolean {
	const text = epic_audit_logic.parent_references(child.body)
	const known_repositories = new Set([repository, child_repo])
	const references = epic_audit_logic.parse_issue_references(text, child_repo, known_repositories)

	return references.some(({ repo, number }) => repo === repository && number === Number(origin))
}

function is_child(child: EpicIssue, target: IssueUrlTarget): boolean {
	const actual = github_issue_url.parse(child.url)

	return (
		child.number === Number(target.issue_number) &&
		actual?.name_with_owner === target.name_with_owner &&
		actual.issue_number === target.issue_number
	)
}

async function read_child(target: IssueUrlTarget): Promise<EpicIssue> {
	const json = await git_gh_issue_read.issue_view_json(
		target.issue_number,
		FIELDS,
		target.name_with_owner,
	)
	const child = epic_issue.parse_epic_issue(json)

	if (child === undefined) throw new Error('Could not read the child')
	if (!is_child(child, target)) throw new Error('The child URL did not resolve to that issue')

	return child
}

function is_origin(origin: string, repository: string, target: IssueUrlTarget): boolean {
	return repository === target.name_with_owner && origin === target.issue_number
}

async function verified_child(origin: string, target: IssueUrlTarget): Promise<void> {
	const repository = await git_gh_command.repo_get_name_with_owner()
	const child = await read_child(target)

	if (repository === undefined) throw new Error('Could not read the origin repository')

	if (is_origin(origin, repository, target)) {
		throw new Error('An origin cannot be its own split child')
	}

	if (!epic_issue.label_names(child).includes(SPLIT_ROUTE_LABEL)) {
		throw new Error('The child has no route:split label')
	}

	if (!has_parent(child, origin, repository, target.name_with_owner)) {
		throw new Error('The child does not name this origin as its parent')
	}
}

async function recover(origin: string, url: string): Promise<void> {
	issue_number_shape.require_issue_number(origin)
	const target = github_issue_url.parse(url)

	if (target === undefined) throw new Error('Not a GitHub issue URL')
	await verified_child(origin, target)
	await lane_ledger_write.record_split_filed({ issue: Number(origin), child: url })
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [origin, url, ...rest] = argv

	if (origin === undefined || url === undefined || rest.length > 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	try {
		await recover(origin, url)
		console.info(`Recovered split-child evidence for ${session_cite.issue(Number(origin))}: ${url}`)

		return SUCCESS_EXIT_CODE
	} catch (error) {
		console.error(`Split-child recovery failed: ${error_text.message_of(error)}`)

		return FAILURE_EXIT_CODE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const split_child_recover_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { split_child_recover_cli }
