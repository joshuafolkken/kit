import { git_gh_issue_list, MAX_SCANNED } from '#scripts/gh/git-gh-issue-list'
import type { ImplementRate } from '#scripts/lane/lane-implement-rate'
import { lane_net_read } from '#scripts/lane/lane-net-read'
import type { SizeRatios } from '#scripts/lane/lane-size-stats'
import { issue_auto_ok } from './issue-auto-ok'
import { issue_file, type FileArguments } from './issue-file'
import { issue_file_lane_hint } from './issue-file-lane-hint'
import { issue_lint_cli } from './issue-lint-cli'
import { issue_priority } from './issue-priority'
import { issue_sample_required } from './issue-sample-required'
import { issue_sample_source } from './issue-sample-source'
import { issue_scout_cli, type ScoutOutcome } from './issue-scout-cli'
import { issue_wip } from './issue-wip'
import { measure_twin } from './measure-twin'
import { size_estimate } from './size-estimate'

// The one pass of `josh issue:file`: every check the body and the arguments are answered by — the
// local ones, the start condition read as a pull request, the WIP count and the duplicate scout — run
// on every call and each printing its own refusals, so one call prints every problem and one reissue
// fixes them all (joshuafolkken/kit#5833).

// `GH_REPO` is the variable `gh` reads `{owner}/{repo}` from, so setting it points every listing the
// scout and `epic:bundle` make at the target repository rather than at this checkout.
const GH_REPO_VARIABLE = 'GH_REPO'

interface Filing {
	args: FileArguments
	body: string
	target: string
	current: string
	scouted?: ScoutOutcome | undefined
}

// Every refusal the body and the arguments carry, read locally — `[]` when the body is admitted.
function refusals_of(
	filing: Filing,
	rate: ImplementRate | undefined,
	growth: SizeRatios,
): ReadonlyArray<string> {
	const problems = [
		...issue_lint_cli.problems(filing.body, issue_file.labels_of(filing.args, filing.body)),
		size_estimate.guide_problem(filing.body, filing.args.route, rate, growth),
		issue_sample_required.problem(filing.body),
		issue_auto_ok.declaration_problem(filing.body),
		issue_priority.problem(filing.body, filing.args.labels),
		issue_file.origin_problem(filing.body, filing.target, filing.current),
	]

	return problems.filter((problem) => problem !== undefined).map((problem) => `✖ ${problem}`)
}

// `open` names the candidates still unanswered; the `--distinct` to paste carries the ones the call
// already declared too, so the reissue drops none of them.
function unacknowledged_message(
	open: ReadonlyArray<number>,
	declared: ReadonlyArray<number>,
): string {
	const listed = open.map(String).join(',')
	const pasted = [...new Set([...declared, ...open])].map(String).join(',')

	return `✖ duplicate candidate(s) ${listed} not declared separate — read each (\`issue-fold-existing.md\`); fold into a duplicate, or reissue with \`--distinct ${pasted}\` when each is a separate deliverable.`
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

async function scout_filing(filing: Filing): Promise<ScoutOutcome | undefined> {
	point_listings_at(filing)

	return await issue_scout_cli.scout({ title: filing.args.title, body: filing.body }, filing.target)
}

// A measurement an open issue already declares is held whatever `--distinct` says: the same command
// against the same bound is one measurement, never a separate deliverable (joshuafolkken/kit#6008).
function is_measure_clear(outcome: ScoutOutcome): boolean {
	const problem = measure_twin.problem(outcome.measure_twins ?? [])

	if (problem === undefined) return true
	console.error(`✖ ${problem}`)

	return false
}

function is_candidate_clear(filing: Filing, outcome: ScoutOutcome): boolean {
	const answered = issue_file.acknowledged(filing.args, filing.target, filing.current)
	const open = issue_file.unacknowledged(outcome.candidates, answered)

	if (open.length > 0) console.error(unacknowledged_message(open, filing.args.distinct))

	return open.length === 0
}

// The scout's report is printed whatever it finds — by `issue:file --batch` for a filing it scouted —
// and the filing is held until every title match it names is declared separate and no open issue
// declares its measurement.
async function is_scout_clear(filing: Filing): Promise<boolean> {
	const outcome = filing.scouted ?? (await scout_filing(filing))

	if (outcome === undefined) return false
	if (filing.scouted === undefined) console.info(outcome.report)
	point_listings_at(filing)
	const verdicts = [is_candidate_clear(filing, outcome), is_measure_clear(outcome)]

	return verdicts.every(Boolean)
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

// The size estimate is judged at the ledger's recent implement rate (joshuafolkken/kit#6025).
async function is_admitted(filing: Filing): Promise<boolean> {
	const { implement_rate, growth } = await lane_net_read.measurements()
	const refusals = refusals_of(filing, implement_rate, growth)

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

// Every step runs whatever the others answer, cheapest first, so one call prints every refusal: the
// body's own refusals and the run label, then the start condition's citation, the WIP count and the
// duplicate scout's search (`--batch` scouts every filing up front). The labels, or `undefined` when
// any refused.
async function labels_in_one_pass(filing: Filing): Promise<ReadonlyArray<string> | undefined> {
	const is_body_clear = await is_admitted(filing)
	const labels = labels_of(filing)
	const verdicts = [
		is_body_clear,
		labels !== undefined,
		await is_source_clear(filing),
		await is_wip_clear(filing),
		await is_scout_clear(filing),
	]

	return verdicts.every(Boolean) ? labels : undefined
}

const issue_file_pass = {
	GH_REPO_VARIABLE,
	labels_in_one_pass,
	scout_filing,
}

export { issue_file_pass }
export type { Filing }
