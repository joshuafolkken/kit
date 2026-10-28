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
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { error_text } from '#scripts/lib/error-message'
import type { PollOptions } from '#scripts/lib/poll'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold_member } from '#scripts/run/hold/run-hold-member'
import { split_resolution } from '#scripts/split/split-resolution'
import { issue_auto_ok } from './issue-auto-ok'
import { issue_cite } from './issue-cite'
import { issue_file, type FileArguments } from './issue-file'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_deferral } from './issue-file-deferral'
import { issue_file_fold } from './issue-file-fold'
import { issue_file_interrupt } from './issue-file-interrupt'
import { issue_file_lane_hint } from './issue-file-lane-hint'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_priority } from './issue-priority'
import { issue_release_cli } from './issue-release-cli'
import { issue_sample_required } from './issue-sample-required'
import { issue_sample_source } from './issue-sample-source'
import { issue_scout_cli } from './issue-scout-cli'
import { issue_wip } from './issue-wip'
import { size_estimate } from './size-estimate'

// `josh issue:file "<title>" --body-file <path> [--route <route>] [--label <name>]…
// [--repo <owner/repo>] [--distinct <N,…>] [--found-during <N>] [--over-cap] [--no-auto-ok]
// [--release] [--blocks-finder]` — file an Issue with every filing step run: the third-party refusal,
// the filing cap per origin and the fold question against the run's earlier filings, each ending the
// filing on its own; then, each tier printing every refusal of its own at once, the local checks — the body lint, the size estimate against the split guide, the start condition a measurement
// follow-up owes, the `## Origin` check for another repository, the `auto-ok` decision with the run
// label it owes; once those pass, the start condition read as a pull request and the WIP cap count;
// once those pass, the duplicate scout; then the missing
// workflow labels created, the create call
// carrying every label, a blocking interrupt's finder recorded as blocked by it, the release link on
// `--release`, and `epic:bundle`.
// A direct `gh api …/issues` filing is refused by the `direct-filing` delivered rule and pointed here.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE =
	'Usage: josh issue:file "<title>" --body-file <path> [--route <tier-a|split|interrupt|review-cap>] [--label <name>]… [--repo <owner/repo>] [--distinct <N,…>] [--found-during <N>] [--over-cap] [--no-auto-ok] [--release] [--blocks-finder]'
const UNKNOWN_REPO_MESSAGE =
	'Could not read this repository from `git remote`, so the filing has no repository to compare against — check `gh auth status`.'
const THIRD_PARTY_MESSAGE =
	'✖ third-party target: a tracker we do not own is Tier C — draft the Issue for a person to post instead (`CLAUDE.md` → "Third-party repositories are Tier C").'
const UNKNOWN_PARTY_MESSAGE =
	'✖ unknown party: the owner of this session or of the target could not be read (`git remote` / `--repo`), so the target is not known to be ours — check `pnpm josh repo:party`.'
// `GH_REPO` is the variable `gh` reads `{owner}/{repo}` from, so setting it points every listing the
// scout and `epic:bundle` make at the target repository rather than at this checkout.
const GH_REPO_VARIABLE = 'GH_REPO'
// The open listing `epic:bundle` reads trails the create call, so the issue just filed is looked for
// again for up to ten seconds before the placement is given up.
const FRESH_ISSUE_POLL: PollOptions = { attempts: 6, interval_ms: 2000 }

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

// An owner that cannot be read is refused like a third party — stricter than the `third-party-write`
// hook, which stays silent on `unknown`: a filing is admitted only when the target is known to be ours.
function party_refusal(target: string): string | undefined {
	const party = repo_party.classify(repo_party.current_owner(), repo_party.target_owner(target))

	if (party === repo_party.FIRST_PARTY) return undefined

	return party === repo_party.THIRD_PARTY ? THIRD_PARTY_MESSAGE : UNKNOWN_PARTY_MESSAGE
}

// Every refusal the body and the arguments carry, read locally — `[]` when the body is admitted.
function refusals_of(filing: Filing): ReadonlyArray<string> {
	const problems = [
		...issue_lint_cli.problems(filing.body),
		size_estimate.guide_problem(filing.body, filing.args.route),
		issue_sample_required.problem(filing.body),
		issue_auto_ok.declaration_problem(filing.body),
		issue_priority.problem(filing.body, filing.args.labels),
		issue_file.origin_problem(filing.body, filing.target, filing.current),
	]

	return problems.filter((problem) => problem !== undefined).map((problem) => `✖ ${problem}`)
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
	const answered = issue_file.acknowledged(filing.args, filing.target, filing.current)
	const open = issue_file.unacknowledged(outcome.candidates, answered)

	if (open.length > 0) console.error(unacknowledged_message(open))

	return open.length === 0
}

// Every label the create call carries, or `undefined` when an `auto-ok` filing names neither run label.
// The decision reads the labels the body's declarations add, so a declared breaking change is excluded
// like its label.
function labels_of(filing: Filing): ReadonlyArray<string> | undefined {
	const auto_ok = issue_auto_ok.decide({
		is_opted_out: filing.args.is_auto_ok_opted_out,
		is_cross_repository: !issue_file.is_same_repository(filing.target, filing.current),
		labels: issue_file.labels_of(filing.args, filing.body),
		body: filing.body,
	})

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

function issue_number_of(url: string): number {
	return Number(github_issue_url.parse(url)?.issue_number)
}

// `--release`: the filed Issue blocks the target's release Issue. Reported,
// never failed, for the reason `place` gives. The re-run hint names the target through `GH_REPO`:
// `issue:release` links in the repository `gh` resolves, which is not the target on a `--repo` filing.
async function link_release(url: string, filing: Filing): Promise<void> {
	if (!filing.args.is_release) return
	const issue_number = issue_number_of(url)
	const is_linked =
		Number.isSafeInteger(issue_number) &&
		(await issue_release_cli.link(issue_number, filing.target))

	if (is_linked) return
	console.error(
		`⚠ the release link did not complete for ${url} — run \`${GH_REPO_VARIABLE}=${filing.target} pnpm josh issue:release <N>\`.`,
	)
}

// The Issue exists once `create` returns, so a failed placement is reported rather than failed: a
// non-zero exit would read as "not filed" and invite the second filing the scout exists to stop.
async function place(url: string, target: string): Promise<void> {
	const issue_number = issue_number_of(url)
	const exit_code = Number.isSafeInteger(issue_number)
		? await epic_bundle_cli.report_for(issue_number, target, FRESH_ISSUE_POLL)
		: FAILURE_EXIT_CODE

	if (exit_code !== SUCCESS_EXIT_CODE) {
		console.error(`⚠ epic:bundle did not answer for ${url} — run \`pnpm josh epic:bundle <N>\`.`)
	}
}

// Every filing lands on the run's event stream: this is the one filing path, so
// one append here reaches `run:board` from every route. A filing outside a run lands too, unmarked as
// the run's (`run_hold_member`), and the board counts only the marked ones; a lane's overrun
// investigation marks its own, which the board draws after 🔍; the append is best-effort, as every emit is.
async function emit_filed(
	reference: string,
	filing: Filing,
	labels: ReadonlyArray<string>,
	found_during: string | undefined,
): Promise<void> {
	const kind = run_event_filed.kind_of(labels)
	const is_run = await run_hold_member.is_run_member()
	const is_overrun = lane_child_marker.is_overrun()
	const { title } = filing.args
	const text = run_event_filed.text_of({ reference, kind, title, found_during, is_run, is_overrun })

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.FILED, text)
}

async function record(url: string, filing: Filing, labels: ReadonlyArray<string>): Promise<void> {
	const number = String(issue_number_of(url))
	const reference = issue_cite.plain(
		number,
		issue_file_fold.reference_prefix(filing.target, filing.current),
	)
	const found_during = await issue_file_fold.finder(filing.args.found_during)

	await emit_filed(reference, filing, labels, found_during)
	await issue_file_deferral.note_finder({
		found_during: filing.args.found_during,
		reference,
		title: filing.args.title,
		current: filing.current,
	})
	await split_resolution.record_child({ route: filing.args.route, found_during, child: reference })
	await issue_file_interrupt.block_finder({
		route: filing.args.route,
		is_blocking_finder: filing.args.is_blocking_finder,
		found_during,
		blocker: issue_number_of(url),
		is_here: issue_file.is_same_repository(filing.target, filing.current),
	})
}

async function is_admitted(filing: Filing): Promise<boolean> {
	const refusals = refusals_of(filing)

	if (refusals.length === 0) return true
	const hint = await issue_file_lane_hint.lines_of(filing.args.found_during, filing.body)

	console.error([...refusals, ...hint].join('\n'))

	return false
}

// The start condition's citation read against GitHub.
async function is_source_clear(filing: Filing): Promise<boolean> {
	const is_here = issue_file.is_same_repository(filing.target, filing.current)
	const problem = await issue_sample_source.problem(
		filing.body,
		is_here ? undefined : filing.target,
	)

	if (problem === undefined) return true
	console.error(`✖ ${problem}`)

	return false
}

async function send(filing: Filing, labels: ReadonlyArray<string>): Promise<number> {
	const url = await create(filing, labels)

	if (url === undefined) return FAILURE_EXIT_CODE
	console.info(url)
	await record(url, filing, labels)
	await link_release(url, filing)
	await place(url, filing.target)

	return SUCCESS_EXIT_CODE
}

// The holds that end the filing whatever the body says, read first: the filing cap reads the local
// event stream, the fold the stream and diff.
async function is_run_clear(filing: Filing): Promise<boolean> {
	const prefix = issue_file_fold.reference_prefix(filing.target, filing.current)

	return (
		(await issue_file_cap.is_cap_clear(filing.args.found_during)) &&
		(await issue_file_fold.is_fold_clear(prefix, filing.args))
	)
}

// Every step the caller answers from the body and the arguments, cheapest first, each tier's refusals
// printed at once and fixed in one reissue: the local checks (the body's own refusals and the run
// label) before anything asks GitHub, then the start condition's citation and the WIP count, then the
// duplicate scout's search, run only once nothing else refuses. The labels, or `undefined` when any refused.
async function labels_in_one_pass(filing: Filing): Promise<ReadonlyArray<string> | undefined> {
	const is_body_clear = await is_admitted(filing)
	const labels = labels_of(filing)

	if (!is_body_clear || labels === undefined) return undefined
	const verdicts = [await is_source_clear(filing), await is_wip_clear(filing)]

	if (!verdicts.every(Boolean)) return undefined

	return (await is_scout_clear(filing)) ? labels : undefined
}

async function file(filing: Filing): Promise<number> {
	const party_problem = party_refusal(filing.target)

	if (party_problem !== undefined) {
		console.error(party_problem)

		return FAILURE_EXIT_CODE
	}

	if (!(await is_run_clear(filing))) return FAILURE_EXIT_CODE
	const labels = await labels_in_one_pass(filing)

	return labels === undefined ? FAILURE_EXIT_CODE : await send(filing, labels)
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

const issue_file_cli = {
	FRESH_ISSUE_POLL,
	THIRD_PARTY_MESSAGE,
	UNKNOWN_PARTY_MESSAGE,
	record,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_file_cli }
export type { Filing }
