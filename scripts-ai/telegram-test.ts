#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { git_error } from '../scripts/git/git-error'
import { git_gh_issue_read } from '../scripts/git/git-gh-issue-read'
import { git_gh_repo } from '../scripts/git/git-gh-repo'
import { github_issue_url, type IssueUrlTarget } from '../scripts/git/github-issue-url'
import { telegram_notify } from '../scripts/git/telegram-notify'
import { load_optional_environment } from './environment-loader'
import { telegram_test_logic, type CliValues, type ResolvedContext } from './telegram-test-logic'

const REPO_NAME_SEPARATOR = '/'

function parse_cli_arguments(): CliValues {
	const { values } = parseArgs({
		options: {
			'task-type': { type: 'string' },
			'repo-name': { type: 'string' },
			'issue-title': { type: 'string' },
			body: { type: 'string' },
			'body-file': { type: 'string' },
			'issue-url': { type: 'string' },
			'pr-url': { type: 'string' },
		},
	})

	return values
}

// The repository this notification is about, for the Telegram header.
//
// joshuafolkken/kit#1063: this used to spawn `gh repo view --json nameWithOwner` through a
// promisified `execFile`, which is why joshuafolkken/kit#1022's survey never counted it — the
// callee was not `execa` and the file was not `scripts/`. `gh repo view` goes through GraphQL and
// is answered 403 in a cloud session, so the header simply lost its repository name there.
//
// The same fact is already read over REST by `git_gh_repo`, whose failure contract is the
// `undefined` this caller was already handling, so it is read from there rather than from a second
// spawn (`CLAUDE.md` → "No clones").
async function fetch_repo_name(): Promise<string | undefined> {
	const name_with_owner = await git_gh_repo.repo_get_name_with_owner()

	if (name_with_owner === undefined) return undefined

	return name_with_owner.split(REPO_NAME_SEPARATOR).at(-1)
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

// **A notification nobody received must not read as success** (joshuafolkken/kit#1564). This command
// *is* the notification, so a failed send is its result and the exit code has to say so — the state
// that Issue measured was three lost messages, each printing a warning and exiting 0.
//
// `git_error.handle` is what every other script in this directory ends with: it prints the message
// and exits non-zero. Both the message and the `cause` whose text `handle` also prints reach it
// already free of the bot token and the chat id — `telegram_notify` redacts each before throwing.
//
// Separated from the `import.meta.url` guard so the wiring is reachable from a unit test; the guard
// itself stays the canonical one the in-process dispatcher matches on.
async function run_cli(): Promise<void> {
	try {
		await main()
	} catch (error) {
		git_error.handle(error)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run_cli()

const telegram_test = { fetch_repo_name, fetch_issue_title, resolve_context, run_cli }

export { telegram_test }
