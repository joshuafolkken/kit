#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list, MAX_SCANNED } from '#scripts/gh/git-gh-issue-list'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { error_text } from '#scripts/lib/error-message'
import { repository_labels } from '#scripts/repo/repository-labels'
import { issue_auto_ok } from './issue-auto-ok'
import { issue_file, type FileArguments } from './issue-file'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_scout_cli } from './issue-scout-cli'
import { issue_wip } from './issue-wip'

// `josh issue:file "<title>" --body-file <path> --depth <0|1|2> [--route <route>] [--label <name>]…
// [--repo <owner/repo>] [--distinct <N,…>] [--over-cap] [--no-auto-ok]` — file an Issue with every
// filing step run in order (joshuafolkken/kit#2808): the third-party refusal, the body lint, the
// `## Origin` check for another repository, the `auto-ok` decision (joshuafolkken/kit#3213) with the
// run label it owes (joshuafolkken/kit#3313), the WIP cap count (joshuafolkken/kit#3181), the duplicate
// scout, the missing workflow labels created (joshuafolkken/kit#3176), the create call carrying every
// label, and `epic:bundle` after it.
// A direct `gh api …/issues` filing is refused by the `direct-filing` delivered rule and pointed here.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE =
	'Usage: josh issue:file "<title>" --body-file <path> --depth <0|1|2> [--route <tier-a|split|interrupt|review-cap>] [--label <name>]… [--repo <owner/repo>] [--distinct <N,…>] [--over-cap] [--no-auto-ok]'
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

// The target's open Issues, pull requests excluded by the listing itself; `undefined` when unreadable.
async function open_count(target: string): Promise<number | undefined> {
	const outcome = await git_gh_issue_list.issue_list({
		json_fields: 'number',
		limit: MAX_SCANNED,
		repo: target,
	})

	return outcome.json === undefined ? undefined : issue_wip.count_of(outcome.json)
}

// The count is printed whatever it answers, and the filing is held only past the cap with no
// exemption declared. An unreadable count warns and goes on: the cap makes growth visible, and a
// listing outage is not a reason to stop the run a blocked filing exists for.
async function is_wip_clear(filing: Filing): Promise<boolean> {
	const count = await open_count(filing.target)

	if (count === undefined) {
		console.error(issue_wip.UNREAD_MESSAGE)

		return true
	}

	const verdict = issue_wip.verdict_of(count, filing.args)

	console.info(issue_wip.count_line(count, filing.target, verdict))
	if (verdict === issue_wip.HELD) console.error(issue_wip.HELD_MESSAGE)

	return verdict !== issue_wip.HELD
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

// Every label the create call carries, or `undefined` when an `auto-ok` filing names neither run label
// (joshuafolkken/kit#3313). Decided before the WIP count and the scout, so a refusal costs no listing.
async function labels_of(filing: Filing): Promise<ReadonlyArray<string> | undefined> {
	const auto_ok = await issue_auto_ok.resolve(
		filing.args.is_auto_ok_opted_out,
		filing.target,
		filing.current,
	)

	console.info(issue_auto_ok.line_of(auto_ok))
	const labels = issue_file.labels_of(filing.args, filing.body, auto_ok.is_applied)
	const problem = issue_file.triage_problem(labels)

	if (problem === undefined) return labels
	console.error(`✖ ${problem}`)

	return undefined
}

// `undefined` when the create call failed. `gh`'s standard error is captured into the thrown error
// rather than printed, so it is printed here — otherwise the filing fails with no reason given. A label
// the create applies is provisioned first, so it never arrives with a generated color.
async function create(filing: Filing, labels: ReadonlyArray<string>): Promise<string | undefined> {
	repository_labels.ensure_labels(filing.target)
	const request = git_gh_issue_write.issue_create_request({
		title: filing.args.title,
		body: filing.body,
		labels,
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

function is_admitted(filing: Filing): boolean {
	const refusals = refusals_of(filing)

	if (refusals.length === 0) return true
	console.error(refusals.join('\n'))

	return false
}

async function send(filing: Filing, labels: ReadonlyArray<string>): Promise<number> {
	const url = await create(filing, labels)

	if (url === undefined) return FAILURE_EXIT_CODE
	console.info(url)
	await place(url, filing.target)

	return SUCCESS_EXIT_CODE
}

async function file(filing: Filing): Promise<number> {
	if (!is_admitted(filing)) return FAILURE_EXIT_CODE
	const labels = await labels_of(filing)

	if (labels === undefined) return FAILURE_EXIT_CODE
	if (!(await is_wip_clear(filing)) || !(await is_scout_clear(filing))) return FAILURE_EXIT_CODE

	return await send(filing, labels)
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
