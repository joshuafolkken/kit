#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { issue_state } from './issue-state'

// `josh issue:state <N>` — print one issue's state and labels, in the spelling the documents compare
// against (joshuafolkken/kit#1054).
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
const USAGE = 'Usage: josh issue:state <issue-number> [--repo <owner/repo>]'
// The two fields, under the names `gh issue view --json` gave them. `git-gh-issue-rest.ts` maps them
// back from REST, which is what keeps `OPEN` / `CLOSED` / `MERGED` out of this file.
const STATE_FIELDS = 'state,labels'

interface StateRequest {
	issue_number: string
	repo?: string
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

	// The repository is read first so its value is never mistaken for the issue number.
	const rest = argv.filter((argument) => !is_repo_token(argument, repo_flag))
	const issue_number = rest.find((argument) => ISSUE_NUMBER_PATTERN.test(argument))

	if (issue_number === undefined) return undefined

	return repo_flag.kind === 'named' ? { issue_number, repo: repo_flag.repo } : { issue_number }
}

// A number that resolves to nothing is an answer — a typo, or another repository's number quoted in
// prose — and it is reported as one. Everything else is a gap, and the message says so, because the
// caller's next move differs: a gap is retried, an answer is not.
function report_failure(kind: 'missing' | 'unreadable', issue_number: string): number {
	if (kind === 'missing') {
		console.error(`✖ issue #${issue_number} does not resolve — check the number and the repository`)
	} else {
		console.error(
			`✖ could not read issue #${issue_number} — a rate limit, expired auth, or a dropped connection. This is not "the issue is open"`,
		)
	}

	return FAILURE_EXIT_CODE
}

function report_state(json: string, issue_number: string): number {
	const parsed = issue_state.parse_issue_state(json)

	if (parsed === undefined) return report_failure('unreadable', issue_number)

	console.info(issue_state.format_issue_state(parsed))

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const read = await git_gh_command.issue_view_json_classified(
		request.issue_number,
		STATE_FIELDS,
		request.repo,
	)

	if (read.kind === 'read') return report_state(read.json, request.issue_number)

	return report_failure(read.kind, request.issue_number)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_state_cli = { STATE_FIELDS, USAGE, main, parse_request, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_state_cli }
