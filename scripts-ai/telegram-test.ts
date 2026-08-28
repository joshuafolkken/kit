#!/usr/bin/env tsx
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { git_gh_issue_read } from '../scripts/git/git-gh-issue-read'
import { github_issue_url, type IssueUrlTarget } from '../scripts/git/github-issue-url'
import { telegram_notify } from '../scripts/git/telegram-notify'
import { load_optional_environment } from './environment-loader'
import { telegram_test_logic, type CliValues, type ResolvedContext } from './telegram-test-logic'

const exec_file_async = promisify(execFile)

const REPO_NAME_SEPARATOR = '/'

function parse_cli_arguments(): CliValues {
	const { values } = parseArgs({
		options: {
			'task-type': { type: 'string' },
			'repo-name': { type: 'string' },
			'issue-title': { type: 'string' },
			body: { type: 'string' },
			'issue-url': { type: 'string' },
			'pr-url': { type: 'string' },
		},
	})

	return values
}

async function exec_gh(arguments_: ReadonlyArray<string>): Promise<string | undefined> {
	try {
		const { stdout } = await exec_file_async('gh', [...arguments_])

		return stdout.trim()
	} catch {
		return undefined
	}
}

async function fetch_repo_name(): Promise<string | undefined> {
	const name_with_owner = await exec_gh([
		'repo',
		'view',
		'--json',
		'nameWithOwner',
		'-q',
		'.nameWithOwner',
	])

	if (name_with_owner === undefined) return undefined

	const parts = name_with_owner.split(REPO_NAME_SEPARATOR)

	return parts.at(-1)
}

// The title is read from the repository the URL names, through the same reader every other
// cross-repository read goes through. Read unqualified, `gh` would answer with the issue of that
// number in the working directory's repository — a different issue with a different title
// (joshuafolkken/kit#903).
//
// A repository the token cannot read answers the same `undefined` as an issue that does not exist,
// and the notification would then go out with no title line at all. Say so, so the gap is visible
// in the console beside the notification it belongs to.
async function fetch_issue_title(target: IssueUrlTarget | undefined): Promise<string | undefined> {
	if (target === undefined) return undefined

	const title = await git_gh_issue_read.issue_get_title(target.issue_number, target.name_with_owner)

	if (title === undefined) {
		console.warn(`⚠️  Could not read ${target.name_with_owner}#${target.issue_number}.`)
	}

	return title
}

// An explicit `--issue-title` already answers this, and `build_input` prefers it — so reading one
// would spend a `gh` call whose result is discarded, and a repository the token cannot read would
// warn about a notification that is not missing its title.
async function resolve_issue_title(
	values: CliValues,
	target: IssueUrlTarget | undefined,
): Promise<string | undefined> {
	if (telegram_test_logic.has_flag_value(values['issue-title'])) return undefined

	return await fetch_issue_title(target)
}

// Resolution order: an explicit `--repo-name` (applied by `build_input`, which prefers the flag),
// then the repository the `--issue-url` points at, then the one `--pr-url` points at, then the
// working directory. The last step is the backwards-compatible one, and it is reached only when
// there is no URL of either kind to read.
//
// `--issue-url` outranks `--pr-url` because it identifies the issue the title is read from as well
// as the repository. A pull URL answers the repository half only, which is why it is read for
// `repo_name` and not passed to `resolve_issue_title` — a completion notification carrying only a
// PR link used to go out under the working directory's repository while its link pointed elsewhere
// (joshuafolkken/kit#994).
async function resolve_context(values: CliValues): Promise<ResolvedContext> {
	const target = github_issue_url.parse(values['issue-url'])
	const pull_target = github_issue_url.parse_pull(values['pr-url'])
	const repo_name = target?.repo ?? pull_target?.repo ?? (await fetch_repo_name())
	const issue_title = await resolve_issue_title(values, target)

	return { repo_name, issue_title }
}

async function main(): Promise<void> {
	load_optional_environment()
	const values = parse_cli_arguments()
	const context = await resolve_context(values)
	const input = telegram_test_logic.build_input({ values, context })

	await telegram_notify.send(input)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const telegram_test = { fetch_repo_name, fetch_issue_title, resolve_context }

export { telegram_test }
