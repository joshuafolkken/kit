#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_comment_cli, type CommentRequest } from '#scripts/issue/issue-comment-cli'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_step_section } from '#scripts/run/run-step-section'
import { run_park } from './run-park'
import { run_park_answered } from './run-park-answered'
import { run_park_body } from './run-park-body'
import { run_park_release } from './run-park-release'
import { run_park_write } from './run-park-write'

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
//
// **A park from inside a lane names the lane it keeps** (joshuafolkken/kit#5840): `run_park_lane`
// appends the lane directory, the held seat and the `lane:close` hint to the comment.
//
// **A released park prints the section it follows** (joshuafolkken/kit#5842), through
// `run_step_section.print_once`: "park and continue" for the parent, the park-then-stop for a lane child.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const CLEAR_FLAG = '--clear'
const USAGE = `Usage: josh run:park <issue-number> --body-file <path> | <issue-number> ${CLEAR_FLAG}\n\n${run_park_body.FORMAT}`
const CLEAR_OPTIONS = { clear: { type: 'boolean' } } as const

function clear_issue(argv: ReadonlyArray<string>): string | undefined {
	const parsed = cli_flags.arguments_of(argv, CLEAR_OPTIONS)

	if (parsed === undefined) return undefined

	return issue_number_shape.single_of(parsed.positionals)
}

// A released park prints what its caller does next, once per session.
async function release(issue_number: string, directory: string): Promise<number> {
	const exit_code = await run_park_release.release(issue_number)

	if (exit_code !== SUCCESS_EXIT_CODE) return exit_code

	return run_step_section.print_once(run_step_section.PARK, directory)
}

// **A park asks only what the Issue has not answered** (joshuafolkken/kit#6531): after the schema,
// `run_park_answered` judges the question against the Issue before any write.
async function stop_of(request: CommentRequest, directory: string): Promise<number | undefined> {
	if (run_park_write.is_refused(request.body)) return FAILURE_EXIT_CODE

	return await run_park_answered.refusal_of(request.issue_number, request.body, directory)
}

async function park(request: CommentRequest, directory: string): Promise<number> {
	const stop = await stop_of(request, directory)

	if (stop !== undefined) return stop

	const is_parked = await run_park_write.write(request, directory)

	return is_parked ? await release(request.issue_number, directory) : FAILURE_EXIT_CODE
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
