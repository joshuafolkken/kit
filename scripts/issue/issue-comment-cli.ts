#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { cli_body } from '#scripts/josh/cli-body'

// `josh issue:comment <N> --body <text> | --body-file <path>` — post one comment to an issue (a PR
// comment is an issue comment over REST) and print the comment URL (joshuafolkken/kit#2304).
//
// **The write side had no command, so every park, decision record and plan comment fell to a raw
// `gh api … body=@<path>`.** The read side already had `issue:read` / `issue:state` / `issue:cite` /
// `issue:scout`, but a comment was posted by hand — and `gh`'s two path spellings differ by one
// character: `-F` / `--field` reads the file, `-f` / `--raw-field` sends the literal `@<path>`, and
// `gh` exits 0 with a URL either way. One command removes the choice: the body travels by path through
// `cli-body.ts` (shared with `notify` / `followup`), so no shell evaluates it and the wrong-flag
// misfire has nowhere left to happen.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const BODY_FLAG = '--body'
const BODY_FILE_FLAG = '--body-file'
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = `Usage: josh issue:comment <issue-number> ${BODY_FLAG} <text> | ${BODY_FILE_FLAG} <path>`

interface CommentRequest {
	issue_number: string
	body: string
}

// The value after a flag word, or `undefined` when the flag is absent. `cli_body.resolve` owns the
// both-flags-at-once refusal and the file read, so this stays the one narrow job of finding the token.
function flag_value(argv: ReadonlyArray<string>, flag: string): string | undefined {
	const index = argv.indexOf(flag)

	return index === -1 ? undefined : argv[index + 1]
}

// The number is the first argument, and it must be a real issue number: a missing or malformed one
// refuses the whole call rather than posting to some other issue. `resolve` may throw when both body
// flags are given, which `run` reports — the message names the two flags a caller must pick between.
function parse_request(argv: ReadonlyArray<string>): CommentRequest | undefined {
	const [issue_number] = argv

	if (issue_number === undefined || !ISSUE_NUMBER_PATTERN.test(issue_number)) return undefined

	const body = cli_body.resolve({
		inline: flag_value(argv, BODY_FLAG),
		file_path: flag_value(argv, BODY_FILE_FLAG),
		inline_flag: BODY_FLAG,
		file_flag: BODY_FILE_FLAG,
	})

	if (body === undefined || body.length === 0) return undefined

	return { issue_number, body }
}

// A both-flags refusal and a file-read failure both surface as an `Error` from `resolve`, and its
// message already names the flags or the resolved path — so it is printed as-is and `USAGE` is
// withheld. `undefined` is the other refusal: a bad number or an empty body, which `USAGE` explains.
function resolve_request(argv: ReadonlyArray<string>): CommentRequest | undefined {
	try {
		const request = parse_request(argv)

		if (request === undefined) console.error(USAGE)

		return request
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))

		return undefined
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = resolve_request(argv)

	if (request === undefined) return FAILURE_EXIT_CODE

	const url = await git_gh_command.issue_comment(request.issue_number, request.body)

	console.info(url)

	return SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_comment_cli = { USAGE, main, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_comment_cli }
