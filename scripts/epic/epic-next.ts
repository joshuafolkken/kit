#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { epic_classify } from './epic-classify'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph, type GraphAnomaly } from './epic-graph'
import { epic_issue } from './epic-issue'
import { epic_report, type EpicNextResult, type EpicVerdict } from './epic-report'

// `josh epic:next <E>` — which of an epic's children can be started right now, bundled per
// repository, and what the rest are waiting on (joshuafolkken/kit#860).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const REPO_FLAG = '--repo'
const USAGE = 'Usage: josh epic:next <epic-number> [--repo <owner/repo>]'
// An epic in another repository needs its children resolved there too, which is joshuafolkken/kit#864.
// Refused with this rather than read as a bare number, which would answer about a different issue.
const CROSS_REPO_USAGE = `An epic in another repository is not supported yet (see joshuafolkken/kit#864). ${USAGE}`
const EXTERNAL_NOTICE =
	'Note: this epic tracks children in other repositories. Those are not resolved yet — see joshuafolkken/kit#864.'

interface NextOptions {
	epic_number?: number
	repo?: string
	usage?: string
}

function usage_for(raw = ''): string {
	return raw.includes('/') ? CROSS_REPO_USAGE : USAGE
}

function parse_repo(rest: ReadonlyArray<string>): string | undefined {
	const flag_index = rest.indexOf(REPO_FLAG)

	return flag_index === -1 ? undefined : rest[flag_index + 1]
}

function parse_options(argv: ReadonlyArray<string>): NextOptions {
	const [first, ...rest] = argv
	const epic_number = epic_issue.parse_epic_number(first)
	if (epic_number === undefined) return { usage: usage_for(first) }
	const repo = parse_repo(rest)
	if (repo === undefined) return rest.includes(REPO_FLAG) ? { usage: USAGE } : { epic_number }

	return { epic_number, repo }
}

// The answer for one epic, from an already-fetched snapshot. Split from the fetch so the whole
// decision is testable without GitHub.
// A child that could not be read stops the run. Continuing would answer with a graph that is
// missing a node: an epic whose children all failed to read reads as complete, and one missing child
// leaves whatever it blocks looking unblocked.
function unreadable_anomaly(snapshot: EpicSnapshot): GraphAnomaly | undefined {
	const missing = [...snapshot.unreadable, ...snapshot.skipped]
	if (missing.length === 0) return undefined
	const list = missing.map((issue_number) => `#${String(issue_number)}`).join(', ')

	return {
		kind: 'unreadable_children',
		message: `Could not read ${list}. The dependency graph would be missing them, so nothing is offered — check \`gh auth status\` and that the issues exist.`,
	}
}

// Whether the body states an order at all. Read through the same parser the links come from, so a
// body whose arrows are all prose cannot count as a declaration with zero links — which would report
// every correct relation as undeclared.
function is_order_declared(body: string | undefined, links: ReadonlyArray<unknown>): boolean {
	return links.length > 0 || git_epic_parse.has_unordered_declaration(body)
}

function decide(snapshot: EpicSnapshot): EpicNextResult {
	const links = git_epic_parse.parse_dependency_links(snapshot.body)
	const unreadable = unreadable_anomaly(snapshot)
	const anomalies =
		unreadable === undefined
			? epic_graph.find_anomalies(snapshot.children, links, is_order_declared(snapshot.body, links))
			: [unreadable]
	const classification = epic_classify.classify_children(snapshot.children)

	return epic_report.build_result(classification, anomalies)
}

// The verdict as it applies to *this* repository. `run` never reaches a caller here: it means some
// other repository has work, which for this session is something to wait on rather than a state its
// loop has a branch for. The whole-run timeout is what bounds that wait.
function repo_verdict(verdict: EpicVerdict): EpicVerdict {
	return verdict === 'run' ? 'wait' : verdict
}

// Print the answer for one repository, as one machine-readable token: the issue number when there
// is a child to run, otherwise the verdict — `wait`, `stop` or `complete`.
//
// The verdict is on stdout rather than only in prose because a loop has to tell "poll again" from
// "stop and report" from "finished"; collapsing all three into one line and exit 0 leaves the caller
// unable to make the distinction the whole classification exists for. Explanations go to stderr, so
// `child=$(josh epic:next 858 --repo …)` still captures a single token.
//
// An unusable graph is checked before a candidate is picked: printing a runnable child while the
// graph is broken would hand a caller work the anomaly says must not start.
function report_single(result: EpicNextResult, repo: string): number {
	if (result.verdict === 'error') {
		console.error(epic_report.format_result(result))

		return FAILURE_EXIT_CODE
	}

	const child = epic_report.pick_for_repo(result, repo)

	if (child === undefined) {
		console.error(`No runnable child in ${repo}.`)
		console.info(repo_verdict(result.verdict))

		return SUCCESS_EXIT_CODE
	}

	console.info(String(child.number))

	return SUCCESS_EXIT_CODE
}

function report(result: EpicNextResult, snapshot: EpicSnapshot, repo: string | undefined): number {
	if (snapshot.has_external_children) console.error(EXTERNAL_NOTICE)
	if (repo !== undefined) return report_single(result, repo)

	const text = epic_report.format_result(result)

	if (result.verdict === 'error') {
		console.error(text)

		return FAILURE_EXIT_CODE
	}

	console.info(text)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options.epic_number === undefined) {
		console.error(options.usage ?? USAGE)

		return FAILURE_EXIT_CODE
	}

	const current_repo = (await git_gh_command.repo_get_name_with_owner()) ?? 'unknown/unknown'
	const snapshot = await epic_fetch.fetch_epic(options.epic_number, current_repo)

	if (snapshot.child_numbers.length === 0) {
		console.error(`#${String(options.epic_number)} tracks no children in a task list.`)

		return FAILURE_EXIT_CODE
	}

	return report(decide(snapshot), snapshot, options.repo)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exit(await run(argv))
}

const epic_next = {
	USAGE,
	CROSS_REPO_USAGE,
	EXTERNAL_NOTICE,
	unreadable_anomaly,
	is_order_declared,
	parse_epic_number: epic_issue.parse_epic_number,
	repo_verdict,
	parse_options,
	decide,
	report,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { NextOptions }
export { epic_next }
