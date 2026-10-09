#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { cli_flags } from '#scripts/lib/cli-flags'
import { issue_report_failures, type ReadFailureKind } from './issue-report-failures'
import { issue_state, type IssueState } from './issue-state'

// `josh issue:state <N> [<N> ...]` — print each issue's state and labels, in the spelling the
// documents compare against, several numbers in one call.
//
// The numbers are read concurrently and reported together because the callers that need more than
// one need them all: `diag`'s ranking table reads a state per row, and one process start plus one
// round trip per row cost 1.6 seconds each — about 8 seconds of a five-row table spent on nothing
// but the states.
//
// It replaces the two reads the workflow documents told an agent to type — `gh issue view <N> --json
// state --jq .state` and `gh issue view <N> --json state,labels --jq …` — with one call that answers
// both. Those go through GraphQL, which a cloud session is refused, and that read is `epic-child`'s
// verifier: the whole reason a child of an epic may be delegated at all is that the parent re-reads
// the child's state from GitHub rather than trusting the unit's summary. A verifier that 403s leaves
// the delegation running with nothing checking it.
//
// **A failed read is never printed as a state.** `gh issue view` exited non-zero with nothing on
// stdout for a rate limit and for a number that does not exist alike, and a loop that read the empty
// answer as "not CLOSED" would report a child as failed because nobody could reach GitHub. The two
// are told apart here and neither is a state.

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh issue:state <issue-number> [<issue-number> ...] [--repo <owner/repo>]'
// A blank line between the blocks of a multi-number report, so a person sees where one issue ends
// while a reader matching `issue: ` still finds each block by its first line.
const BLOCK_SEPARATOR = '\n\n'
// The same bound `epic:bundle` puts on its reference lookup, for the same reason: every read is a
// `gh` process, and an unbounded fan-out is answered with secondary rate limiting rather than with
// states.
const READ_CONCURRENCY = 8
// The two fields, under the names `gh issue view --json` gave them. `git-gh-issue-rest.ts` maps them
// back from REST, which is what keeps `OPEN` / `CLOSED` / `MERGED` out of this file.
const STATE_FIELDS = 'state,labels'
const FAILURE_TERMS = { success_kind: 'state', misreading: 'the issue is open' } as const

interface StateRequest {
	issue_numbers: ReadonlyArray<string>
	repo?: string
}

// One issue's state, or the failure kind. Named for export because `run:prep` reads the state beside
// the body and the dependency-update scope, reusing this read rather than a
// second one that would drift from the `human_review` decision `parse_issue_state` owns.
type StateRead = { kind: 'state'; state: IssueState } | { kind: ReadFailureKind }

interface IssueReport {
	issue_number: string
	result: StateRead
}

// The read goes through `cli_flags`, both spellings gh itself accepts included (`--repo owner/repo`,
// `--repo=owner/repo`), and is strict. An unrecognized flag refuses the
// call: discarding `--rep=owner/repo` for starting with a dash would fall back to the session's
// repository and print a confident state for a *different* repository's issue of that number.
const OPTIONS = { repo: { type: 'string', multiple: true } } as const

// `absent` and "given but with nothing usable" are different answers. Falling back to the session's
// repository on the second — an empty value, or `--repo` given twice — would print a confident state
// for a *different* issue of the same number, which is the exact misread `--repo` exists to prevent.
function read_repo(given: ReadonlyArray<string> | undefined): { repo?: string } | undefined {
	if (given === undefined) return {}
	const [repo, ...rest] = given

	return repo !== undefined && rest.length === 0 && repo.length > 0 ? { repo } : undefined
}

// A token that is not a number refuses the whole invocation rather than being dropped. Dropping it
// answers fewer numbers than were asked for and still exits zero — and with one number left, the
// surviving block prints in the single-number shape, so nothing in the output says a number went
// unanswered. `#1262` copied out of a `diag` table is exactly that token.
function is_issue_numbers(positionals: ReadonlyArray<string>): boolean {
	return (
		positionals.length > 0 && positionals.every((argument) => ISSUE_NUMBER_PATTERN.test(argument))
	)
}

function parse_request(argv: ReadonlyArray<string>): StateRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const repo = read_repo(parsed.values.repo)

	if (repo === undefined || !is_issue_numbers(parsed.positionals)) return undefined

	// In the order they were typed, with a repeat dropped: repeating a number would spend a second
	// read on an answer already in hand, and print a second block a caller counting rows counts twice.
	return { issue_numbers: [...new Set(parsed.positionals)], ...repo }
}

// One number's read, reduced to what the report needs and nothing printed yet. Separating the two
// is what lets the whole batch be in flight at once: the numbers are independent, so reading them
// one after the other spends a round trip per number for no reason.
async function read_issue(issue_number: string, repo?: string): Promise<StateRead> {
	const read = await git_gh_command.issue_view_json_classified(issue_number, STATE_FIELDS, repo)

	if (read.kind !== 'read') return { kind: read.kind }

	const parsed = issue_state.parse_issue_state(read.json)

	return parsed === undefined ? { kind: 'unreadable' } : { kind: 'state', state: parsed }
}

// Through the shared pool rather than a raw `Promise.all`: each read spawns a `gh` process, and a
// whole epic's children fired at once draws GitHub's secondary rate limiting — which comes back as
// `unreadable` for issues that exist and are perfectly readable. Same bound `epic:bundle`'s
// reference lookup uses, and the pool is shared rather than spelled out again here.
async function read_all(request: StateRequest): Promise<ReadonlyArray<IssueReport>> {
	return await bounded_pool.bounded_map(
		request.issue_numbers,
		READ_CONCURRENCY,
		async (issue_number) => ({
			issue_number,
			result: await read_issue(issue_number, request.repo),
		}),
	)
}

// `[]` for a number that produced no state, so one unresolvable number costs the others nothing.
// The heading is withheld for a single number: `.claude/skills/workflow-commands/needs-human-review.md` and
// `.claude/skills/diag/SKILL.md` read that report's three lines verbatim.
function state_blocks(report: IssueReport, should_attribute: boolean): ReadonlyArray<string> {
	if (report.result.kind !== 'state') return []

	const { state } = report.result

	if (!should_attribute) return [issue_state.format_issue_state(state)]

	return [issue_state.format_attributed_issue_state(report.issue_number, state)]
}

function print_states(reports: ReadonlyArray<IssueReport>): void {
	// Derived from what was asked for rather than from what came back: a call for two numbers whose
	// first resolves to nothing must still name the number the surviving block belongs to.
	const should_attribute = reports.length > 1
	const blocks = reports.flatMap((report) => state_blocks(report, should_attribute))

	issue_report_failures.print_blocks(blocks, BLOCK_SEPARATOR, 'issue:state')
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reports = await read_all(request)

	print_states(reports)

	return issue_report_failures.report_failures(reports, FAILURE_TERMS)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_state_cli = {
	READ_CONCURRENCY,
	STATE_FIELDS,
	USAGE,
	main,
	parse_request,
	read_issue,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { StateRead }
export { issue_state_cli }
