#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { git_next_issues } from '#scripts/git/git-next-issues'
import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/schemas'

// `josh auto-ok:next` — which issue outside the epic an unattended run picks up next
// (joshuafolkken/kit#906).
//
// A command rather than a documented `gh` invocation, for the reason the label constant exists: the
// name `auto-ok` is single-sourced in `scripts/git/issue-labels.ts`, and a procedure that told an
// agent to type `gh issue list --label auto-ok` would put a second copy of it in prose, where
// nothing checks it. The contract is `epic:next`'s: one token on standard output, every explanation
// on standard error, so `answer=$(pnpm josh auto-ok:next)` reads it.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const EXCLUDE_FLAG = '--exclude'
const USAGE = `Usage: josh auto-ok:next [${EXCLUDE_FLAG} <issue-number>]`
// The token for "nobody has opted anything in", which is the ordinary answer: opting in is the
// default absence, so a repository that has never used the label answers this on every run.
const NONE_TOKEN = 'none'
// Wide enough that the cap is never what decides the order. `gh` lists newest first, so a truncated
// listing drops the *oldest* opted-in issues — which is reported rather than silently ranked.
const LISTING_LIMIT = 200

const UNREADABLE_MESSAGE = `Could not read the \`${AUTO_OK_LABEL}\` listing. That is not "nothing is opted in" — check \`gh auth status\` and ask again.`
const TRUNCATED_MESSAGE = `⚠ The listing hit the ${String(LISTING_LIMIT)}-issue cap, so the oldest \`${AUTO_OK_LABEL}\` issues are not in it; the answer below is opted in, but it may not be the highest-priority one.`
const NONE_OPTED_IN_MESSAGE = `No open issue carries \`${AUTO_OK_LABEL}\`.`

// The issue just merged, so the next answer cannot be it again. GitHub applies the `closes #N` side
// effect asynchronously, so for a few seconds after a merge the issue is still listed as open —
// which is why `prioritize` takes this number at all, and why a pickup loop that never passes it
// leaves an already-merged issue to be excluded only by the `in-progress` label it happens to still
// carry (joshuafolkken/kit#906).
interface NextOptions {
	exclude?: number
	usage?: string
}

// An issue number, or `undefined` for a value that is not a positive whole number — an empty string,
// a zero, a negative, or anything `Number` cannot read at all. Alternative spellings `Number` does
// accept (`1e3`, `0x38`, `12.0`) are read as the number they denote rather than refused; they cost
// a mistyped exclusion at worst, and the answer is still an opted-in issue.
function parse_issue_number(value: string): number | undefined {
	const parsed = Number(value)
	if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined

	return parsed
}

// The value of `--exclude`, or `undefined` when the flag was given without a usable one — a missing
// value, or a trailing argument nobody asked for.
function parse_exclude(argv: ReadonlyArray<string>): number | undefined {
	const [, value, ...rest] = argv
	if (value === undefined || rest.length > 0) return undefined

	return parse_issue_number(value)
}

function parse_options(argv: ReadonlyArray<string>): NextOptions {
	const [flag] = argv

	if (flag === undefined) return {}
	if (flag !== EXCLUDE_FLAG) return { usage: USAGE }
	const exclude = parse_exclude(argv)

	return exclude === undefined ? { usage: USAGE } : { exclude }
}

// Every open issue carrying the label. `undefined` means the listing could not be read — told apart
// from an empty one on purpose: reading a failed read as "none" ends the run reporting a confident
// absence built on a response nobody parsed (joshuafolkken/kit#950).
//
// A response whose *elements* are the wrong shape reaches the same answer, by the `catch`: the zod
// rejection `parse_json_array_or_undefined` deliberately rethrows would otherwise escape as a stack
// trace, which is the one gap this command is written to report in words.
async function fetch_opted_in(): Promise<Array<OpenIssueData> | undefined> {
	const raw = await git_gh_command.issue_list_by_label_summary(AUTO_OK_LABEL, LISTING_LIMIT)
	if (raw === undefined) return undefined

	try {
		return parse_json_array_or_undefined(raw, open_issue_schema)
	} catch {
		return undefined
	}
}

// The pickup order is `git_next_issues.prioritize` itself, not a copy of it: newest first, with the
// `epic` / `in-progress` / `needs-decision` exclusions. That display is printed at the end of every
// workflow, so ranking differently here would start something other than what the person was just
// told is next. Its display cap does not reach this caller, which reads only the first row.
//
// Membership of the label is the *query's* job, not this function's: `--label` is what makes the
// listing the opted-in set, so re-testing it here would be a second definition of opting in.
function pick_next(
	issues: ReadonlyArray<OpenIssueData>,
	exclude?: number,
): OpenIssueData | undefined {
	return git_next_issues.prioritize(issues, exclude)[0]
}

// Why there is nothing to run. "No open issue carries the label" and "every opted-in issue is
// excluded" look identical from the token, and telling a person the label is absent when it is
// applied sends them to apply it again.
function none_reason(count: number): string {
	if (count === 0) return NONE_OPTED_IN_MESSAGE

	return `All ${String(count)} open \`${AUTO_OK_LABEL}\` issue(s) are excluded — an epic, already in progress, parked, or the one just merged.`
}

function report(issues: ReadonlyArray<OpenIssueData>, exclude?: number): number {
	if (issues.length >= LISTING_LIMIT) console.error(TRUNCATED_MESSAGE)
	const next = pick_next(issues, exclude)

	if (next === undefined) {
		console.error(none_reason(issues.length))
		console.info(NONE_TOKEN)

		return SUCCESS_EXIT_CODE
	}

	console.error(`#${String(next.number)} ${next.title}`)
	console.info(String(next.number))

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const issues = await fetch_opted_in()

	if (issues === undefined) {
		console.error(UNREADABLE_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	return report(issues, options.exclude)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exit(await run(argv))
}

const auto_ok_cli = {
	USAGE,
	NONE_TOKEN,
	LISTING_LIMIT,
	UNREADABLE_MESSAGE,
	TRUNCATED_MESSAGE,
	NONE_OPTED_IN_MESSAGE,
	parse_issue_number,
	parse_exclude,
	parse_options,
	fetch_opted_in,
	pick_next,
	none_reason,
	report,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { auto_ok_cli }
export type { NextOptions }
