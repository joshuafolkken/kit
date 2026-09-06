#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { run_preflight, type PreflightDecision } from './run-preflight'

// `josh run:preflight <N>` — the reclaim question a run asks before it starts a child
// (joshuafolkken/kit#926).
//
// The contract is `run:hold`'s and `epic:next`'s: **standard output carries exactly one token** —
// `clean`, `reclaim`, `resume`, `park` or `unknown` — and every explanation goes to standard error,
// so `answer=$(pnpm josh run:preflight 926)` captures something a loop can branch on.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const SINGLE_ARGUMENT = 1
const USAGE = 'Usage: josh run:preflight <issue-number>'

const UNKNOWN_VERDICT = 'unknown'
const UNKNOWN_MESSAGE =
	'The working tree could not be read, so nothing was established. Stop and look at it yourself — this is not "the tree is clean".'

function report(decision: PreflightDecision): number {
	console.error(`${decision.reason}\n${decision.advice}`)
	console.info(decision.verdict)

	return SUCCESS_EXIT_CODE
}

// A tree that cannot be read is `unknown` and exits non-zero, never `clean`: the rule has established
// nothing there, and a run that proceeds on it is the run this command exists to stop.
function report_unknown(): number {
	console.error(UNKNOWN_MESSAGE)
	console.info(UNKNOWN_VERDICT)

	return FAILURE_EXIT_CODE
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

// The issue number is required, unlike `run:hold`'s optional one: this command answers about the
// branch and pull request *of a child*, and there is no such thing to ask about without one.
function parse_issue(argv: ReadonlyArray<string>): string | undefined {
	const [first] = argv

	if (first === undefined || argv.length > SINGLE_ARGUMENT) return undefined

	return run_preflight.ISSUE_NUMBER_PATTERN.test(first) ? first : undefined
}

// **Every path out of here prints exactly one token**, including the ones nobody planned: a `gh`
// binary that is not there, or a git directory that cannot be read, would otherwise leave standard
// output empty — and an empty `$answer` matches none of the tokens, which a loop reads as "nothing to
// reclaim" before walking straight past the guard.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue = parse_issue(argv)

	if (issue === undefined) return report_usage()

	try {
		return report(await run_preflight.check(issue))
	} catch {
		return report_unknown()
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_preflight_cli = {
	UNKNOWN_MESSAGE,
	UNKNOWN_VERDICT,
	USAGE,
	main,
	parse_issue,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_preflight_cli }
