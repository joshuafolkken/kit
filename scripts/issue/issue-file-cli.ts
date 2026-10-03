#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_gh_exec } from '#scripts/git/git-gh-exec'
import { git_gh_issue_write } from '#scripts/git/git-gh-issue-write'
import { github_issue_url } from '#scripts/git/github-issue-url'
import { error_text } from '#scripts/lib/error-message'
import { issue_file, type FileArguments } from './issue-file'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_scout_cli } from './issue-scout-cli'

// `josh issue:file "<title>" --body-file <path> --depth <0|1|2> [--route <route>] [--label <name>]…
// [--repo <owner/repo>] [--distinct <N,…>]` — file an Issue with every filing step run in order
// (joshuafolkken/kit#2808): the third-party refusal, the body lint, the `## Origin` check for another
// repository, the duplicate scout, the create call carrying every label, and `epic:bundle` after it.
// A direct `gh api …/issues` filing is refused by the `direct-filing` delivered rule and pointed here.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE =
	'Usage: josh issue:file "<title>" --body-file <path> --depth <0|1|2> [--route <tier-a|split|interrupt|review-cap>] [--label <name>]… [--repo <owner/repo>] [--distinct <N,…>]'
const UNKNOWN_REPO_MESSAGE =
	'Could not read this repository from `git remote`, so the filing has no repository to compare against — check `gh auth status`.'
const THIRD_PARTY_MESSAGE =
	'✖ third-party target: a tracker we do not own is Tier C — draft the Issue for a person to post instead (`CLAUDE.md` → "Third-party repositories are Tier C").'
// `GH_REPO` is the variable `gh` reads `{owner}/{repo}` from, so setting it points every listing the
// scout and `epic:bundle` make at the target repository rather than at this checkout.
const GH_REPO_VARIABLE = 'GH_REPO'

interface Filing {
	args: FileArguments
	body: string
	target: string
	current: string
}

async function read_body(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, 'utf8')
	} catch {
		return undefined
	}
}

function is_third_party(target: string): boolean {
	const party = repo_party.classify(repo_party.current_owner(), repo_party.target_owner(target))

	return party === repo_party.THIRD_PARTY
}

// Every refusal the filing can meet before a request is sent, in the order the steps run — `[]` when
// the filing may go on to the scout.
function refusals_of(filing: Filing): ReadonlyArray<string> {
	if (is_third_party(filing.target)) return [THIRD_PARTY_MESSAGE]
	const problems = issue_lint_cli.problems(filing.body).map((problem) => `✖ ${problem}`)
	const origin = issue_file.origin_problem(filing.body, filing.target, filing.current)

	return origin === undefined ? problems : [...problems, `✖ ${origin}`]
}

function unacknowledged_message(numbers: ReadonlyArray<number>): string {
	const listed = numbers.map(String).join(',')

	return `✖ duplicate candidate(s) ${listed} not declared separate — read each (\`issue-fold-existing.md\`); fold into a duplicate, or reissue with \`--distinct ${listed}\` when each is a separate deliverable.`
}

// Set before the scout and left set for `epic:bundle`, so both read the target's backlog.
function point_listings_at(filing: Filing): void {
	if (issue_file.is_same_repository(filing.target, filing.current)) return

	process.env[GH_REPO_VARIABLE] = filing.target
}

// The scout's report is printed whatever it finds, and the filing is held until every candidate it
// names is declared separate.
async function is_scout_clear(filing: Filing): Promise<boolean> {
	point_listings_at(filing)
	const outcome = await issue_scout_cli.scout(
		{ title: filing.args.title, body: filing.body },
		filing.target,
	)

	if (outcome === undefined) return false
	console.info(outcome.report)
	const open = issue_file.unacknowledged(outcome.candidates, filing.args.distinct)

	if (open.length > 0) console.error(unacknowledged_message(open))

	return open.length === 0
}

// `undefined` when the create call failed. `gh`'s standard error is captured into the thrown error
// rather than printed, so it is printed here — otherwise the filing fails with no reason given.
async function create(filing: Filing): Promise<string | undefined> {
	const request = git_gh_issue_write.issue_create_request({
		title: filing.args.title,
		body: filing.body,
		labels: issue_file.labels_of(filing.args, filing.body),
		repo: filing.target,
	})

	try {
		return await git_gh_exec.exec_gh_api(request)
	} catch (error) {
		const reason = error_text.message_of(error)

		console.error(`✖ the create call failed: ${reason}`)

		return undefined
	}
}

// The Issue exists once `create` returns, so a failed placement is reported rather than failed: a
// non-zero exit would read as "not filed" and invite the second filing the scout exists to stop.
async function place(url: string, target: string): Promise<void> {
	const issue_number = Number(github_issue_url.parse(url)?.issue_number)
	const exit_code = Number.isSafeInteger(issue_number)
		? await epic_bundle_cli.report_for(issue_number, target)
		: FAILURE_EXIT_CODE

	if (exit_code !== SUCCESS_EXIT_CODE) {
		console.error(`⚠ epic:bundle did not answer for ${url} — run \`pnpm josh epic:bundle <N>\`.`)
	}
}

async function file(filing: Filing): Promise<number> {
	const refusals = refusals_of(filing)

	if (refusals.length > 0) {
		console.error(refusals.join('\n'))

		return FAILURE_EXIT_CODE
	}

	if (!(await is_scout_clear(filing))) return FAILURE_EXIT_CODE
	const url = await create(filing)

	if (url === undefined) return FAILURE_EXIT_CODE
	console.info(url)
	await place(url, filing.target)

	return SUCCESS_EXIT_CODE
}

async function filing_of(args: FileArguments): Promise<Filing | string> {
	const body = await read_body(args.body_file)

	if (body === undefined) return `Could not read the body file ${args.body_file}.`
	const current = await git_gh_command.repo_get_name_with_owner()

	if (current === undefined) return UNKNOWN_REPO_MESSAGE

	return { args, body, target: args.repo ?? current, current }
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const args = issue_file.parse(argv)

	if (args === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const filing = await filing_of(args)

	if (typeof filing === 'string') {
		console.error(filing)

		return FAILURE_EXIT_CODE
	}

	return await file(filing)
}

// `process.exitCode` rather than `process.exit()`, so the report on standard output drains first.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_file_cli = { THIRD_PARTY_MESSAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_file_cli }
