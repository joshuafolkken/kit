#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { ALREADY_DONE_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { cli_body } from '#scripts/josh/cli-body'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'

// `josh issue:already-done <N> --evidence-file <path>` — the exit for an Issue whose work is already
// merged (`issue-comments.md` → "When the work turns out to be already merged"): the evidence
// comment, the `already-done` label and the `run:release`, in that order.
//
// **The order is the point.** The label without the comment is the uncited claim the exit refuses,
// so the comment goes first and each step runs only once the one before it landed — a failure stops
// there and names the step. The label is provisioned by `josh start`, so nothing here creates it.
// **The Issue is never closed**: closing is a person's (Tier C), and the label is the run's exit.

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const EVIDENCE_FILE_FLAG = '--evidence-file'
const USAGE = `Usage: josh issue:already-done <issue-number> ${EVIDENCE_FILE_FLAG} <path>`
const OPTIONS = { 'evidence-file': { type: 'string' } } as const

interface AlreadyDoneRequest {
	issue_number: string
	evidence: string
}

// An evidence file that is empty or whitespace only is refused before anything is written: a comment
// with no citations is not the finding this exit is for. The throw carries the reason to `run`.
function parse_request(argv: ReadonlyArray<string>): AlreadyDoneRequest | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)
	if (parsed === undefined) return undefined
	const issue_number = issue_number_shape.single_of(parsed.positionals)
	const file_path = parsed.values['evidence-file']
	if (issue_number === undefined || file_path === undefined) return undefined
	const evidence = cli_body.read_file_or_stdin(file_path).trim()
	if (evidence.length === 0) throw new Error(`Evidence file is empty: ${file_path}`)

	return { issue_number, evidence }
}

// A file-read failure or an empty file is an `Error` naming the path, printed as-is; every other
// refusal is `undefined`, which `USAGE` explains.
function resolve_request(argv: ReadonlyArray<string>): AlreadyDoneRequest | undefined {
	try {
		const request = parse_request(argv)

		if (request === undefined) console.error(USAGE)

		return request
	} catch (error) {
		console.error(error_text.message_of(error))

		return undefined
	}
}

async function post_evidence(request: AlreadyDoneRequest): Promise<boolean> {
	try {
		console.info(await git_gh_command.issue_comment(request.issue_number, request.evidence))

		return true
	} catch (error) {
		console.error(`Evidence comment not posted: ${error_text.message_of(error)}`)

		return false
	}
}

async function apply_label(request: AlreadyDoneRequest): Promise<boolean> {
	const write = await git_gh_command.issue_apply_label(request.issue_number, ALREADY_DONE_LABEL)

	if (!write.is_applied) console.error(`${ALREADY_DONE_LABEL} not applied: ${write.reason}`)

	return write.is_applied
}

// Each write runs only once the one before it landed: `&&` stops at the first that did not.
async function write_exit(request: AlreadyDoneRequest): Promise<boolean> {
	return (await post_evidence(request)) && (await apply_label(request))
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = resolve_request(argv)
	if (request === undefined) return FAILURE_EXIT_CODE

	return (await write_exit(request))
		? await run_hold_cli.run(['--release', request.issue_number])
		: FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_already_done_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_already_done_cli }
