#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { bounded_pool } from '#scripts/bounded-pool'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { issue_read, type IssueComment, type IssueFields } from './issue-read'

// `josh issue:read <N> [<N> ...]` — the body *and* the comments of every issue named, in one call
// (joshuafolkken/kit#1715).
//
// It replaces the two `gh api` reads `.claude/skills/workflow-commands/SKILL.md` §2g tells an agent
// to type per issue. Measured over four recorded `backlogrun` parents, `issue bookkeeping` was the
// largest single contributor to the parent's turn count — 110 of 414 turns, 26.6% — and one issue
// read at a time was its dominant shape: 19 `…/issues/<N>` calls and 5 `…/comments` calls, each its
// own turn. A parent's cost grows as n²/2 in its own request count, so a turn removed there is worth
// more than a turn removed anywhere else in the batch.
//
// **No `--repo`, deliberately.** The comment listing is `issue_list_comments`, which reads the
// repository it runs in; a cross-repository read stays the two `gh api` calls it always was, and
// inventing a repository-aware comment reader here would be a second deliverable. Naming the flag and
// then ignoring it would be worse than not having it — a confident block for a *different*
// repository's issue of the same number is the misread `issue:state`'s own `--repo` exists to
// prevent.
//
// **A failed read is never printed as an issue**, and neither is a failed comment listing printed as
// "no comments" — the block says which of the two it holds, because §2g's rule is that the later text
// wins, and a comment nobody read cannot win anything.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh issue:read <issue-number> [<issue-number> ...]'
const BLOCK_SEPARATOR = '\n\n---\n\n'
// The same bound `issue:state` puts on its batch read, for the same reason: every read is a `gh`
// process, and an unbounded fan-out is answered with secondary rate limiting rather than with issues.
const READ_CONCURRENCY = 8
const ISSUE_FIELDS = 'title,state,body'

type ReadFailureKind = 'missing' | 'unreadable'

interface IssueContent {
	fields: IssueFields
	comments: ReadonlyArray<IssueComment> | undefined
}

type NumberResult = { kind: 'issue'; content: IssueContent } | { kind: ReadFailureKind }

interface IssueReport {
	issue_number: string
	result: NumberResult
}

// A token that is not an issue number refuses the whole invocation rather than being dropped.
// Dropping it answers fewer numbers than were asked for and still exits zero — and nothing in the
// output then says a number went unanswered. `#1262` copied out of a table is exactly that token.
function parse_numbers(argv: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	const numbers = argv.filter((argument) => ISSUE_NUMBER_PATTERN.test(argument))

	if (numbers.length === 0 || numbers.length !== argv.length) return undefined

	// In the order they were typed, with a repeat dropped: repeating a number spends a second read on
	// an answer already in hand and prints a second block a caller counting rows counts twice.
	return [...new Set(numbers)]
}

function report_failure(kind: ReadFailureKind, issue_number: string): void {
	if (kind === 'missing') {
		console.error(`✖ issue #${issue_number} does not resolve — check the number and the repository`)
	} else {
		console.error(
			`✖ could not read issue #${issue_number} — a rate limit, expired auth, or a dropped connection. This is not "the issue is empty"`,
		)
	}
}

// The comments are read beside the fields rather than after them: the two requests need nothing from
// one another, and reading them in sequence would put back one of the two round trips this command
// exists to remove.
async function read_issue(issue_number: string): Promise<NumberResult> {
	const [read, comments_json] = await Promise.all([
		git_gh_command.issue_view_json_classified(issue_number, ISSUE_FIELDS),
		git_gh_command.issue_list_comments(issue_number),
	])

	if (read.kind !== 'read') return { kind: read.kind }

	const fields = issue_read.parse_issue_fields(read.json)

	if (fields === undefined) return { kind: 'unreadable' }

	return { kind: 'issue', content: { fields, comments: issue_read.parse_comments(comments_json) } }
}

async function read_all(issue_numbers: ReadonlyArray<string>): Promise<ReadonlyArray<IssueReport>> {
	return await bounded_pool.bounded_map(issue_numbers, READ_CONCURRENCY, async (issue_number) => ({
		issue_number,
		result: await read_issue(issue_number),
	}))
}

// `[]` for a number that produced no issue, so one unresolvable number costs the others nothing.
function issue_blocks(report: IssueReport): ReadonlyArray<string> {
	if (report.result.kind !== 'issue') return []

	const { fields, comments } = report.result.content

	return [issue_read.format_issue(report.issue_number, fields, comments)]
}

function print_issues(reports: ReadonlyArray<IssueReport>): void {
	const blocks = reports.flatMap((report) => issue_blocks(report))

	if (blocks.length === 0) return

	console.info(blocks.join(BLOCK_SEPARATOR))
}

function report_one_failure(report: IssueReport): boolean {
	if (report.result.kind === 'issue') return false

	report_failure(report.result.kind, report.issue_number)

	return true
}

// Every number that produced no issue is named, so a caller is told which ones it has no answer for
// rather than being left to subtract the printed blocks from what it asked.
function report_failures(reports: ReadonlyArray<IssueReport>): number {
	let has_failure = false

	for (const report of reports) {
		has_failure = report_one_failure(report) || has_failure
	}

	return has_failure ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_numbers = parse_numbers(argv)

	if (issue_numbers === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reports = await read_all(issue_numbers)

	print_issues(reports)

	return report_failures(reports)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_read_cli = { BLOCK_SEPARATOR, ISSUE_FIELDS, USAGE, main, parse_numbers, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_read_cli }
