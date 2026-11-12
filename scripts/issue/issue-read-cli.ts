import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { IssueReadFailure } from '#scripts/gh/git-gh-issue-read'
import { gh_rate_limit } from '#scripts/gh/git-gh-rate-limit'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_flags } from '#scripts/lib/cli-flags'
import { issue_read, type IssueComment, type IssueFields } from './issue-read'
import { issue_report_failures, type ReadFailureKind } from './issue-report-failures'
import { issue_state_cli } from './issue-state-cli'

// `josh issue:read <N> [<N> ...]` — the body *and* the comments of every issue named, in one call.
//
// It replaces the two `gh api` reads `.claude/skills/workflow-commands/issue-comments.md` tells an agent
// to type per issue. Measured over four recorded `backlogrun` parents, `issue bookkeeping` was the
// largest single contributor to the parent's turn count — 110 of 414 turns, 26.6% — and one issue
// read at a time was its dominant shape: 19 `…/issues/<N>` calls and 5 `…/comments` calls, each its
// own turn. A parent's cost grows as n²/2 in its own request count, so a turn removed there is worth
// more than a turn removed anywhere else in the batch.
//
// **`--repo <owner/repo>` names the repository both reads go to** — the body *and* the comments
// (joshuafolkken/kit#5851). One read at the session's repository beside one at the named one would
// print a block mixing two issues of the same number, the misread `issue:state`'s own `--repo` exists
// to prevent; the flag is parsed by `issue:state`'s own rules, so an empty or repeated value refuses.
//
// **A failed read is never printed as an issue**, and neither is a failed comment listing printed as
// "no comments" — the block says which of the two it holds, because `issue-comments.md`'s rule is that the later text
// wins, and a comment nobody read cannot win anything.

const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh issue:read <issue-number> [<issue-number> ...] [--repo <owner/repo>]'
const BLOCK_SEPARATOR = '\n\n---\n\n'
const ISSUE_FIELDS = `title,state,body,${gh_author_association.AUTHOR_FIELDS}`
const FAILURE_TERMS = { success_kind: 'issue', misreading: 'the issue is empty' } as const

interface IssueContent {
	fields: IssueFields
	comments: ReadonlyArray<IssueComment> | undefined
}

type NumberResult =
	{ kind: 'issue'; content: IssueContent } | { kind: ReadFailureKind; hint?: string }

// The formatted block for one issue, or the failure kind — what `run:prep` bundles beside the state
// and the dependency-update scope. It reuses this file's read and the shared
// `format_issue` rather than reproducing either, so the two `gh` reads and the block shape stay
// single-sourced here. `trust` carries what the read already decided about its authors, so
// `run:entry` gates an untrusted issue without a second read (joshuafolkken/kit#4663). `undefined` is
// a read that failed — a write-access lookup, or the comment listing — never an untrusted author (#4703).
interface BlockTrust {
	is_body_trusted: boolean | undefined
	has_trusted_comment: boolean | undefined
}

type BlockRead = { kind: 'ok'; block: string; trust: BlockTrust } | { kind: ReadFailureKind }

interface IssueReport {
	issue_number: string
	result: NumberResult
}

interface ReadRequest {
	issue_numbers: ReadonlyArray<string>
	repo?: string
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

// An unrecognized flag refuses the call rather than being read as a number or dropped, for
// `issue:state`'s reason: `--rep=owner/repo` discarded would read the session's repository instead.
function parse_request(argv: ReadonlyArray<string>): ReadRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, issue_state_cli.REPO_OPTIONS)
	if (parsed === undefined) return undefined
	const repo = issue_state_cli.read_repo(parsed.values.repo)
	const issue_numbers = parse_numbers(parsed.positionals)

	if (repo === undefined || issue_numbers === undefined) return undefined

	return { issue_numbers, ...repo }
}

// A failed request's error text tells an exhausted rate limit — with its reset time — from expired
// auth or the network, so the report does not send a rate-limited run to refresh its token (#6614).
async function to_failure_result(failure: IssueReadFailure): Promise<NumberResult> {
	if (failure.kind === 'missing' || failure.detail === undefined) return { kind: failure.kind }

	return { kind: failure.kind, hint: await gh_rate_limit.failure_hint(failure.detail) }
}

// The comments are read with the fields rather than after them — in one GraphQL query, or two REST
// reads side by side when that query is refused — since reading them in sequence would put back one of
// the round trips this command exists to remove. Exported for `issue-sources.ts`, which keeps each
// trusted text with its origin rather than the printed block.
async function read_issue(issue_number: string, repo?: string): Promise<NumberResult> {
	const { read, comments_json } = await git_gh_command.issue_read_with_comments(
		issue_number,
		ISSUE_FIELDS,
		repo,
	)

	if (read.kind !== 'read') return await to_failure_result(read)

	const fields = await issue_read.parse_issue_fields(read.json, repo)

	if (fields === undefined) return { kind: 'unreadable' }

	const comments = await issue_read.parse_comments(comments_json, repo)

	return { kind: 'issue', content: { fields, comments } }
}

// A trusted comment is an answer whatever else failed; without one, a listing or a lookup that failed
// leaves the question unanswered rather than answered no.
function has_trusted_comment(
	comments: ReadonlyArray<IssueComment> | undefined,
): boolean | undefined {
	if (comments?.some((comment) => comment.is_trusted === true) === true) return true

	if (comments === undefined || comments.some((comment) => comment.is_trusted === undefined)) {
		return undefined
	}

	return false
}

// One issue's block for a caller that wants the text rather than the printing — `run:prep` composes it
// with the state block and the dependency-update line. A failed read is returned as its kind, never as
// an empty block, so `issue-comments.md`'s "a comment nobody read cannot win anything" holds through the bundle too.
async function read_block(issue_number: string): Promise<BlockRead> {
	const result = await read_issue(issue_number)

	if (result.kind !== 'issue') return { kind: result.kind }

	const { fields, comments } = result.content
	const trust = {
		is_body_trusted: fields.is_body_trusted,
		has_trusted_comment: has_trusted_comment(comments),
	}

	return { kind: 'ok', block: issue_read.format_issue(issue_number, fields, comments), trust }
}

// Every read requested at once: each is a `gh` process, and the `gh` layer's shared spawn limit
// (`GH_SPAWN_CONCURRENCY`, `git-gh-exec.ts`) keeps the fan-out from drawing secondary rate limiting.
async function read_all(request: ReadRequest): Promise<ReadonlyArray<IssueReport>> {
	return await Promise.all(
		request.issue_numbers.map(async (issue_number) => ({
			issue_number,
			result: await read_issue(issue_number, request.repo),
		})),
	)
}

// `[]` for a number that produced no issue, so one unresolvable number costs the others nothing.
function issue_blocks(report: IssueReport): ReadonlyArray<string> {
	if (report.result.kind !== 'issue') return []

	const { fields, comments } = report.result.content

	return [issue_read.format_issue(report.issue_number, fields, comments)]
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const reports = await read_all(request)

	issue_report_failures.print_blocks(
		reports.flatMap((report) => issue_blocks(report)),
		BLOCK_SEPARATOR,
		`issue:read ${request.issue_numbers.join(' ')}`,
	)

	return issue_report_failures.report_failures(reports, FAILURE_TERMS)
}

const issue_read_cli = {
	USAGE,
	parse_numbers,
	parse_request,
	read_block,
	read_issue,
	run,
}

export type { BlockRead, BlockTrust, IssueContent, NumberResult }
export { issue_read_cli }
