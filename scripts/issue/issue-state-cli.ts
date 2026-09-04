#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { bounded_pool } from '#scripts/bounded-pool'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { issue_state, type IssueState } from './issue-state'

// `josh issue:state <N> [<N> ...]` — print each issue's state and labels, in the spelling the
// documents compare against (joshuafolkken/kit#1054; several numbers in one call,
// joshuafolkken/kit#1302).
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

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const REPO_FLAG = '--repo'
const FLAG_PREFIX = '-'
const INLINE_REPO_FLAG = `${REPO_FLAG}=`
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

interface StateRequest {
	issue_numbers: ReadonlyArray<string>
	repo?: string
}

// The two failure kinds a read can end in, kept apart all the way to the report: `missing` is the
// number resolving to nothing and `unreadable` is a read that failed, and the documents ask a
// caller to report the two differently. Folding them together to simplify the batch would destroy
// exactly that distinction.
type ReadFailureKind = 'missing' | 'unreadable'

type NumberResult = { kind: 'state'; state: IssueState } | { kind: ReadFailureKind }

interface IssueReport {
	issue_number: string
	result: NumberResult
}

// `absent` and "given but with nothing usable after it" are different answers. Falling back to the
// session's repository on the second would print a confident state for a *different* issue of the
// same number, which is the exact misread the `--repo` argument exists to prevent.
type RepoFlag = { kind: 'absent' } | { kind: 'named'; repo: string } | { kind: 'incomplete' }

// Both spellings gh itself accepts. `--repo=owner/repo` falling through to the separate-word branch
// would read as no repository at all, which is the fall back to the session's repository above.
function read_inline_repo(argv: ReadonlyArray<string>): RepoFlag | undefined {
	const inline = argv.find((argument) => argument.startsWith(INLINE_REPO_FLAG))

	if (inline === undefined) return undefined

	const repo = inline.slice(INLINE_REPO_FLAG.length)

	return repo.length === 0 ? { kind: 'incomplete' } : { kind: 'named', repo }
}

function read_separate_repo(argv: ReadonlyArray<string>): RepoFlag {
	const index = argv.indexOf(REPO_FLAG)

	if (index === -1) return { kind: 'absent' }

	const repo = argv[index + 1]

	if (repo === undefined || repo.startsWith(FLAG_PREFIX)) return { kind: 'incomplete' }

	return { kind: 'named', repo }
}

function read_repo_flag(argv: ReadonlyArray<string>): RepoFlag {
	return read_inline_repo(argv) ?? read_separate_repo(argv)
}

// The repository's own token, in either spelling, so it can never be read as the issue number.
function is_repo_token(argument: string, repo_flag: RepoFlag): boolean {
	if (repo_flag.kind !== 'named') return false

	return argument === repo_flag.repo || argument === `${INLINE_REPO_FLAG}${repo_flag.repo}`
}

function parse_request(argv: ReadonlyArray<string>): StateRequest | undefined {
	const repo_flag = read_repo_flag(argv)

	if (repo_flag.kind === 'incomplete') return undefined

	// The repository is read first so its value is never mistaken for an issue number, and the flags
	// go with it — what remains is everything the caller offered as an issue number.
	const rest = argv.filter(
		(argument) => !is_repo_token(argument, repo_flag) && !argument.startsWith(FLAG_PREFIX),
	)
	const numbers = rest.filter((argument) => ISSUE_NUMBER_PATTERN.test(argument))

	// A token that is not a number refuses the whole invocation rather than being dropped. Dropping
	// it answers fewer numbers than were asked for and still exits zero — and with one number left,
	// the surviving block prints in the single-number shape, so nothing in the output says a number
	// went unanswered. `#1262` copied out of a `diag` table is exactly that token.
	if (numbers.length === 0 || numbers.length !== rest.length) return undefined

	// In the order they were typed, with a repeat dropped: repeating a number would spend a second
	// read on an answer already in hand, and print a second block a caller counting rows counts twice.
	const issue_numbers = [...new Set(numbers)]

	return repo_flag.kind === 'named' ? { issue_numbers, repo: repo_flag.repo } : { issue_numbers }
}

// A number that resolves to nothing is an answer — a typo, or another repository's number quoted in
// prose — and it is reported as one. Everything else is a gap, and the message says so, because the
// caller's next move differs: a gap is retried, an answer is not.
function report_failure(kind: ReadFailureKind, issue_number: string): void {
	if (kind === 'missing') {
		console.error(`✖ issue #${issue_number} does not resolve — check the number and the repository`)
	} else {
		console.error(
			`✖ could not read issue #${issue_number} — a rate limit, expired auth, or a dropped connection. This is not "the issue is open"`,
		)
	}
}

// One number's read, reduced to what the report needs and nothing printed yet. Separating the two
// is what lets the whole batch be in flight at once: the numbers are independent, so reading them
// one after the other spends a round trip per number for no reason.
async function read_issue(issue_number: string, repo?: string): Promise<NumberResult> {
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
// The heading is withheld for a single number: `.claude/skills/workflow-commands/SKILL.md` §2z and
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

	if (blocks.length === 0) return

	console.info(blocks.join(BLOCK_SEPARATOR))
}

function report_one_failure(report: IssueReport): boolean {
	if (report.result.kind === 'state') return false

	report_failure(report.result.kind, report.issue_number)

	return true
}

// Every number that produced no state is named, so a caller is told which ones it has no answer for
// rather than being left to subtract the printed blocks from what it asked. A single failure still
// makes the exit code non-zero, exactly as it did when only one number could be passed.
function report_failures(reports: ReadonlyArray<IssueReport>): number {
	let has_failure = false

	for (const report of reports) {
		has_failure = report_one_failure(report) || has_failure
	}

	return has_failure ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reports = await read_all(request)

	print_states(reports)

	return report_failures(reports)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_state_cli = { STATE_FIELDS, USAGE, main, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_state_cli }
