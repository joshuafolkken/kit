#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { issue_read, type IssueComment, type IssueFields } from './issue-read'
import { issue_report_failures, type ReadFailureKind } from './issue-report-failures'

// `josh issue:read <N> [<N> ...]` — the body *and* the comments of every issue named, in one call.
//
// It replaces the two `gh api` reads `.claude/skills/workflow-commands/issue-comments.md` tells an agent
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
// "no comments" — the block says which of the two it holds, because `issue-comments.md`'s rule is that the later text
// wins, and a comment nobody read cannot win anything.

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh issue:read <issue-number> [<issue-number> ...]'
const BLOCK_SEPARATOR = '\n\n---\n\n'
// The same bound `issue:state` puts on its batch read, for the same reason: every read is a `gh`
// process, and an unbounded fan-out is answered with secondary rate limiting rather than with issues.
const READ_CONCURRENCY = 8
const ISSUE_FIELDS = 'title,state,body'
const FAILURE_TERMS = { success_kind: 'issue', misreading: 'the issue is empty' } as const

interface IssueContent {
	fields: IssueFields
	comments: ReadonlyArray<IssueComment> | undefined
}

type NumberResult = { kind: 'issue'; content: IssueContent } | { kind: ReadFailureKind }

// The formatted block for one issue, or the failure kind — what `run:prep` bundles beside the state
// and the dependency-update scope. It reuses this file's read and the shared
// `format_issue` rather than reproducing either, so the two `gh` reads and the block shape stay
// single-sourced here.
type BlockRead = { kind: 'ok'; block: string } | { kind: ReadFailureKind }

interface IssueReport {
	issue_number: string
	result: NumberResult
}

// A token that is not an issue number refuses the whole invocation rather than being dropped.
// Dropping it answers fewer numbers than were asked for and still exits zero — and nothing in the
// output then says a number went unanswered. `#1262` copied out of a table is exactly that token.
function parse_numbers(argv: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	const numbers = argv.filter((argument) => issue_number_shape.is_issue_number(argument))

	if (numbers.length === 0 || numbers.length !== argv.length) return undefined

	// In the order they were typed, with a repeat dropped: repeating a number spends a second read on
	// an answer already in hand and prints a second block a caller counting rows counts twice.
	return [...new Set(numbers)]
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

// One issue's block for a caller that wants the text rather than the printing — `run:prep` composes it
// with the state block and the dependency-update line. A failed read is returned as its kind, never as
// an empty block, so `issue-comments.md`'s "a comment nobody read cannot win anything" holds through the bundle too.
async function read_block(issue_number: string): Promise<BlockRead> {
	const result = await read_issue(issue_number)

	if (result.kind !== 'issue') return { kind: result.kind }

	const { fields, comments } = result.content

	return { kind: 'ok', block: issue_read.format_issue(issue_number, fields, comments) }
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

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_numbers = parse_numbers(argv)

	if (issue_numbers === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reports = await read_all(issue_numbers)

	issue_report_failures.print_blocks(
		reports.flatMap((report) => issue_blocks(report)),
		BLOCK_SEPARATOR,
		`issue:read ${issue_numbers.join(' ')}`,
	)

	return issue_report_failures.report_failures(reports, FAILURE_TERMS)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_read_cli = {
	USAGE,
	parse_numbers,
	read_block,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { BlockRead }
export { issue_read_cli }
