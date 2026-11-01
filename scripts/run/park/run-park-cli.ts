#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_comment_cli, type CommentRequest } from '#scripts/issue/issue-comment-cli'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_park } from '#scripts/issue/issue-park'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_park } from './run-park'
import { run_park_release } from './run-park-release'

// `josh run:park <N> --body-file <path>` — park a lane child for a person's decision in one call: the
// question as a comment, `needs-decision`, and the local record the `lane-park` guard reads.
// `josh run:park <N> --clear` takes the park back off once the decision is recorded.
//
// **The park was two hand-typed commands, and a child could stop after either one**
// (joshuafolkken/kit#4132). One call writes both, and only a park that has both is recorded, so the
// guard falls silent on exactly the child that left a question behind.
//
// **Every parked ending owes the release, so the park runs it** (joshuafolkken/kit#5737): once the
// label and the comment are on, `run_park_release` drops the hold and `in-progress`. A failed release
// keeps the park.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const CLEAR_FLAG = '--clear'
const USAGE = `Usage: josh run:park <issue-number> --body-file <path> | <issue-number> ${CLEAR_FLAG}`
const CLEAR_OPTIONS = { clear: { type: 'boolean' } } as const

function has_recommendation(body: string): boolean {
	if (!/推奨|recommend/iu.test(body)) return false

	console.error(
		'Park refused: the reason contains a recommendation. Apply decision-autonomy in prompts/collaboration-workflow/operating-rules.md. For a reversible Tier A choice, adopt it and record the decision with pnpm josh epic --decide <E> <N...> --decision-file <path|-> (対象 / 採用 / 却下 / 理由 / 決定日), then continue. Tier C still requires explicit authorization; state the required action without recommending a choice.',
	)

	return true
}

function clear_issue(argv: ReadonlyArray<string>): string | undefined {
	const parsed = cli_flags.arguments_of(argv, CLEAR_OPTIONS)

	if (parsed === undefined) return undefined

	return issue_number_shape.single_of(parsed.positionals)
}

async function park(request: CommentRequest, directory: string): Promise<number> {
	const { issue_number, body } = request

	if (has_recommendation(body)) return FAILURE_EXIT_CODE

	const write = await issue_park.apply(issue_number, NEEDS_DECISION_LABEL, body)
	const is_parked = write.is_labelled && write.is_commented
	const is_recorded = is_parked && run_park.record(issue_number, directory)

	console.info(
		`park ${session_cite.issue(issue_number)} — label: ${String(write.is_labelled)} · comment: ${String(write.is_commented)} · recorded: ${String(is_recorded)}`,
	)

	return is_parked ? await run_park_release.release(issue_number) : FAILURE_EXIT_CODE
}

// **The record goes whatever the label answers**: the decision is a person's and already made, so a
// guard reading a stale park would only stay silent on the child's next stop.
async function clear(issue_number: string, directory: string): Promise<number> {
	run_park.clear(issue_number, directory)
	const is_cleared = await git_gh_issue_write.issue_clear_label(issue_number, NEEDS_DECISION_LABEL)

	console.info(`park ${session_cite.issue(issue_number)} — cleared: ${String(is_cleared)}`)

	return is_cleared ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

async function run_clear(argv: ReadonlyArray<string>, directory: string): Promise<number> {
	const issue_number = clear_issue(argv)

	if (issue_number !== undefined) return await clear(issue_number, directory)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function run(
	argv: ReadonlyArray<string>,
	directory: string = process.cwd(),
): Promise<number> {
	if (argv.includes(CLEAR_FLAG)) return await run_clear(argv, directory)

	const request = issue_comment_cli.resolve_request(argv, USAGE)

	return request === undefined ? FAILURE_EXIT_CODE : await park(request, directory)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_park_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_park_cli }
