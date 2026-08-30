#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { epic_issue } from '#scripts/epic/epic-issue'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { SUMMARY_FIELDS } from '#scripts/git/git-gh-issue'
import { git_next_issues } from '#scripts/git/git-next-issues'
import { AUTO_OK_LABEL } from '#scripts/git/issue-labels'
import { cutoff_cause, cutoff_of, type ScanCutoff } from '#scripts/git/listing-cutoff'
import { read_json_listing } from '#scripts/git/parse-json-array'
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
const EXCLUDE_SEPARATOR = ','
// A `--exclude` occurrence is the flag plus its value.
const EXCLUDE_PAIR_SIZE = 2
const USAGE = `Usage: josh auto-ok:next [${EXCLUDE_FLAG} <issue-number>[,<issue-number>...]]...`
// The token for "nobody has opted anything in", which is the ordinary answer: opting in is the
// default absence, so a repository that has never used the label answers this on every run.
const NONE_TOKEN = 'none'
// Wide enough that the cap is never what decides the order. The listing is newest first because
// `git-gh-issue-list.ts` spells `sort=created&direction=desc` into every request rather than leaning
// on REST's default (joshuafolkken/kit#1025), so a truncated listing drops the *oldest* opted-in
// issues — which is reported rather than silently ranked.
const LISTING_LIMIT = 200

// Two different gaps, told apart because they send a person to two different places. A listing that
// never arrived is an access or connectivity problem; a listing that arrived in a shape the schema
// rejects is the rows' fields having changed under the REST mapping in `git-gh-issue-rest.ts`, where
// `gh auth status` is green and checking it wastes the one hint the message had to give
// (joshuafolkken/kit#996).
//
// The second message named `gh --version` until joshuafolkken/kit#1069. The listing has been REST
// since joshuafolkken/kit#1025 and `git-gh-issue-list.ts` builds the JSON this parser reads, so the
// CLI's version cannot be what changed the row shape — the same misdirection the message below
// already refuses to repeat for the blocker relations, left standing one constant above it.
const UNREADABLE_MESSAGE = `Could not read the \`${AUTO_OK_LABEL}\` listing. That is not "nothing is opted in" — check \`gh auth status\` and ask again.`
const UNEXPECTED_SHAPE_MESSAGE = `Read the \`${AUTO_OK_LABEL}\` listing but could not parse it. That is not "nothing is opted in" — the rows came back in a shape this command does not recognize, so check the fields it asks for and the REST field mapping in \`scripts/git/git-gh-issue-rest.ts\` rather than your authentication.`
// The blocker relations failing takes the whole listing with them, and `issue_list_open` swallows
// the error — so the read looks exactly like an access failure and sends the reader to
// `gh auth status`, which is green. That is the misdirection joshuafolkken/kit#996 added the message
// above to remove, walked straight back in by the field the same change started asking for
// (joshuafolkken/kit#1005).
//
// The listing is REST now, so the cause is no longer `gh`'s version: the relations come from each
// issue's own `dependencies/blocked_by` endpoint, and it is those requests — not the CLI — that the
// probe has just shown to be the difference. Naming `gh --version` here would send a reader on a
// current `gh` to the one place the answer is not.
//
// It names both causes rather than asserting one. The probe separates "the relations" from "the
// listing", and it cannot separate a host that does not serve dependencies from a rate limit reached
// by the one-request-per-blocked-issue pass — so claiming the first would be the same misdirection
// in a new place (joshuafolkken/kit#1025).
const BLOCKERS_UNREADABLE_MESSAGE = `Could not read the \`${AUTO_OK_LABEL}\` listing, though the same listing reads once the blocker relations are dropped from it — so it is reading the relations that failed, not your authentication. That is one \`dependencies/blocked_by\` request per opted-in issue declaring a blocker: either this GitHub host does not serve issue dependencies, or those requests are being rate limited. Ask again, and check the host if it persists.`
// Said once the answer is known, so it never claims there is an answer below when there is not.
// Either cutoff only ever drops the *oldest* opted-in issues, the listing being newest first, so the
// consequence is one sentence — but the two cite different numbers and a reader who wants the
// listing widened reaches for a different knob for each (joshuafolkken/kit#1067).
const TRUNCATED_BY_LIMIT = `hit the ${String(LISTING_LIMIT)}-issue cap`
const TRUNCATED_WITH_ANSWER =
	'; the answer below is opted in, but it may not be the highest-priority one.'
const TRUNCATED_WITHOUT_ANSWER =
	', and every issue in it was excluded — an opted-in issue older than the cut may still be runnable.'

function truncated_cause(cutoff: ScanCutoff): string | undefined {
	return cutoff_cause(cutoff, TRUNCATED_BY_LIMIT)
}

const NONE_OPTED_IN_MESSAGE = `No open issue carries \`${AUTO_OK_LABEL}\`.`
const CLOSED_STATE = 'CLOSED'

// The issue just merged, so the next answer cannot be it again. GitHub applies the `closes #N` side
// effect asynchronously, so for a few seconds after a merge the issue is still listed as open —
// which is why `prioritize` takes this number at all, and why a pickup loop that never passes it
// leaves an already-merged issue to be excluded only by the `in-progress` label it happens to still
// carry (joshuafolkken/kit#906).
interface NextOptions {
	// Every number the caller asked to skip. A pickup loop passes the ones it has already run this
	// session, not just the last: `closes #N` can fail to fire — a reference dropped from a PR body —
	// and the `in-progress` label the procedure itself calls an unreliable guard is then the only
	// thing standing between the loop and running an issue twice (joshuafolkken/kit#996).
	exclude?: ReadonlyArray<number>
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

// One `--exclude` value, which may name several issues at once. `undefined` for a missing value or
// any entry that is not a usable issue number — a partly-valid list is refused whole, so a typo
// cannot silently narrow the exclusion.
function parse_exclude(value: string | undefined): ReadonlyArray<number> | undefined {
	if (value === undefined) return undefined
	const parsed = value.split(EXCLUDE_SEPARATOR).map((entry) => parse_issue_number(entry.trim()))

	return parsed.every((entry) => entry !== undefined) ? parsed : undefined
}

// One `--exclude <value>` pair at `index`, or `undefined` when that is not what is there.
function parse_pair(argv: ReadonlyArray<string>, index: number): ReadonlyArray<number> | undefined {
	if (argv[index] !== EXCLUDE_FLAG) return undefined

	return parse_exclude(argv[index + 1])
}

// `--exclude` may also be repeated, so a loop can add one number per pickup without rebuilding a
// list. Anything that is not a `--exclude` pair is a usage error rather than a silently ignored
// argument.
function parse_options(argv: ReadonlyArray<string>): NextOptions {
	const exclude: Array<number> = []

	for (let index = 0; index < argv.length; index += EXCLUDE_PAIR_SIZE) {
		const parsed = parse_pair(argv, index)
		if (parsed === undefined) return { usage: USAGE }
		exclude.push(...parsed)
	}

	return exclude.length === 0 ? {} : { exclude }
}

// Every open issue carrying the label, or which of two gaps stopped the read. Neither gap is an
// empty listing: reading a failed read as "none" ends the run reporting a confident absence built on
// a response nobody parsed (joshuafolkken/kit#950). They stay apart from each other because the zod
// rejection `parse_json_array_or_undefined` deliberately rethrows means the listing's *fields*
// changed, not that the caller's authentication lapsed (joshuafolkken/kit#996).
type OptedInRead =
	| { kind: 'read'; issues: Array<OpenIssueData>; cutoff: ScanCutoff }
	| { kind: 'unreadable' }
	| { kind: 'unexpected_shape' }
	| { kind: 'blockers_unreadable' }

// The two gaps `read_json_listing` names, carried through unchanged. Since joshuafolkken/kit#1025
// `raw` is the JSON `git-gh-issue-list.ts` assembles from the REST rows rather than a CLI's stdout,
// so a transport failure — a rate limit, a dropped connection — never reaches this parser at all:
// `issue_list_open` catches it into `json === undefined` and `classify_failed_read` decides what it
// was. What does reach here is the rethrown zod rejection, meaning the listing arrived and its
// *fields* were not what was asked for. `unreadable` is passed on rather than folded away because
// reading a gap as an empty listing is the confident absence kit#950 exists to prevent, and this is
// not the place to make that assumption.
function parse_listing(raw: string, is_capped: boolean): OptedInRead {
	const read = read_json_listing(raw, open_issue_schema)
	if (read.kind !== 'read') return { kind: read.kind }

	return {
		kind: 'read',
		issues: read.rows,
		cutoff: cutoff_of(read.rows.length, LISTING_LIMIT, is_capped),
	}
}

// Whether the *identical* listing reads once `blockedBy` is dropped from it. Named for what it
// answers rather than for what it implies, because the two are opposite: a `true` here means the
// field was the problem, and an earlier spelling returned the failure instead — correct only because
// its one call site inverted it back (joshuafolkken/kit#1005).
//
// **Only the field list changes.** Varying the limit as well would let a rate limit or a timeout that
// a smaller request happens to survive read as the blocker relations failing, on a host that serves
// them perfectly well.
async function reads_without_blocked_by(): Promise<boolean> {
	const probe = await git_gh_command.issue_list_by_label_summary(AUTO_OK_LABEL, LISTING_LIMIT, {
		json_fields: SUMMARY_FIELDS,
	})

	return probe.json !== undefined
}

// Which gap a failed listing was. Both probes run only here, so a healthy run never spends either.
//
// **The relations are blamed only when they fail twice and the form without them succeeds.** One
// success of that form is not enough on its own: a network blip or a passing rate limit on the first
// read clears by the time the probe runs, and the run would then send someone whose host serves
// dependencies perfectly well to look at it. `issue_list_open` swallows the underlying error, so
// repeating the original read is what separates a transient failure from a standing one
// (joshuafolkken/kit#1005).
async function classify_failed_read(): Promise<OptedInRead> {
	if (!(await reads_without_blocked_by())) return { kind: 'unreadable' }

	const retry = await git_gh_command.issue_list_by_label_summary(AUTO_OK_LABEL, LISTING_LIMIT)

	// The original form working on the second attempt means nothing was wrong with the field.
	return retry.json === undefined
		? { kind: 'blockers_unreadable' }
		: parse_listing(retry.json, retry.is_capped)
}

async function fetch_opted_in(): Promise<OptedInRead> {
	const { json, is_capped } = await git_gh_command.issue_list_by_label_summary(
		AUTO_OK_LABEL,
		LISTING_LIMIT,
	)

	return json === undefined ? await classify_failed_read() : parse_listing(json, is_capped)
}

// Whether every issue this one declares as a blocker has closed. `blockedBy` is the same native
// relation `epic:next` builds its graph from, and each blocker's state comes back alongside its
// number, so no blocker needs a read of its own.
//
// The relations are not in the listing response at all since joshuafolkken/kit#1025 — REST serves
// them from each issue's own dependencies endpoint — so this pickup pays one extra request per row
// whose own dependency summary does not report exactly zero blockers, and nothing for the rest.
//
// An unattended run must not start an issue whose prerequisite is still open: `auto-ok` is applied
// by a person to an issue they judged needs no decision, which says nothing about ordering, and the
// pickup previously consulted only the `epic` / `in-progress` / `needs-decision` labels
// (joshuafolkken/kit#996). A blocker with no state reads as standing — the safe direction, since the
// cost is deferring an issue rather than implementing one out of order.
// `nodes` is a page — fifty under GraphQL, one hundred under REST. When `totalCount` says there are
// more, the ones outside the page are unknown, and unknown reads as standing — the same direction
// as a blocker with no state. Deferring costs a poll; starting out of order costs the ordering
// itself. The `?? nodes.length` fallback reads a listing that carries no count at all as complete,
// which every row this pickup reads does carry, from its own dependency summary.
function is_page_complete(blocked_by: OpenIssueData['blockedBy']): boolean {
	const nodes = blocked_by?.nodes ?? []

	return (blocked_by?.totalCount ?? nodes.length) <= nodes.length
}

// `epic_issue.normalize_state` rather than a second spelling of it: the epic commands already read
// GitHub's state casing through one function, and "is this blocker closed" is the question it
// answers (joshuafolkken/kit#862). A blocker reported without a state reads as standing.
function is_closed(blocker: { state?: string | undefined }): boolean {
	return epic_issue.normalize_state(blocker.state ?? '') === CLOSED_STATE
}

function is_unblocked(issue: OpenIssueData): boolean {
	if (!is_page_complete(issue.blockedBy)) return false

	return (issue.blockedBy?.nodes ?? []).every((blocker) => is_closed(blocker))
}

// The pickup *order* is `git_next_issues.prioritize` itself, not a copy of it: newest first, with the
// `epic` / `in-progress` / `needs-decision` exclusions. Its display cap does not reach this caller,
// which reads only the first row.
//
// The two are no longer the same *set*, and deliberately so: since joshuafolkken/kit#996 the pickup
// also drops a candidate whose prerequisite is still open, while `🗒 Next issues` shows every open
// issue and leaves the judgement to the person reading it. So the display can name an issue this
// command refuses — a person can see a blocked issue is next and decide to start it anyway, and an
// unattended run must not.
//
// Membership of the label is the *query's* job, not this function's: `--label` is what makes the
// listing the opted-in set, so re-testing it here would be a second definition of opting in.
//
// The exclusions are applied **before** `prioritize`, not after: it keeps only its first few rows,
// so filtering its output would answer `none` whenever those rows happen to be blocked while a
// runnable issue sits below them.
//
// The `🗒 Next issues` display is deliberately *not* filtered this way; `git-next-issues.ts` records
// why, and the short version is that a person can see a blocked issue and choose to start it anyway
// while an unattended run cannot (joshuafolkken/kit#1005).
function pick_next(
	issues: ReadonlyArray<OpenIssueData>,
	exclude: ReadonlyArray<number> = [],
): OpenIssueData | undefined {
	const runnable = issues.filter((issue) => is_unblocked(issue) && !exclude.includes(issue.number))

	return git_next_issues.prioritize(runnable)[0]
}

// Why there is nothing to run. "No open issue carries the label" and "every opted-in issue is
// excluded" look identical from the token, and telling a person the label is absent when it is
// applied sends them to apply it again.
function none_reason(count: number): string {
	if (count === 0) return NONE_OPTED_IN_MESSAGE

	return `All ${String(count)} open \`${AUTO_OK_LABEL}\` issue(s) are excluded — an epic, already in progress, parked, blocked by an open issue, or the one just merged.`
}

// Said only when the cap actually bit, and worded from the answer rather than before it: the one run
// where truncation matters is the one where everything listed was excluded, and announcing "the
// answer below is opted in" there contradicted the `none` that followed (joshuafolkken/kit#996).
function truncation_note(cutoff: ScanCutoff, has_answer: boolean): string | undefined {
	const cause = truncated_cause(cutoff)
	if (cause === undefined) return undefined
	const tail = has_answer ? TRUNCATED_WITH_ANSWER : TRUNCATED_WITHOUT_ANSWER

	return `⚠ The listing ${cause}, so the oldest \`${AUTO_OK_LABEL}\` issues are not in it${tail}`
}

function report(
	issues: ReadonlyArray<OpenIssueData>,
	cutoff: ScanCutoff,
	exclude?: ReadonlyArray<number>,
): number {
	const next = pick_next(issues, exclude)
	const note = truncation_note(cutoff, next !== undefined)

	if (note !== undefined) console.error(note)

	if (next === undefined) {
		console.error(none_reason(issues.length))
		console.info(NONE_TOKEN)

		return SUCCESS_EXIT_CODE
	}

	console.error(`#${String(next.number)} ${next.title}`)
	console.info(String(next.number))

	return SUCCESS_EXIT_CODE
}

// The gap that stopped the read decides the message, so a changed field list does not send anyone to
// `gh auth status` (joshuafolkken/kit#996).
const READ_FAILURE_MESSAGES = {
	unreadable: UNREADABLE_MESSAGE,
	unexpected_shape: UNEXPECTED_SHAPE_MESSAGE,
	blockers_unreadable: BLOCKERS_UNREADABLE_MESSAGE,
} as const

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const options = parse_options(argv)

	if (options.usage !== undefined) {
		console.error(options.usage)

		return FAILURE_EXIT_CODE
	}

	const read = await fetch_opted_in()

	if (read.kind !== 'read') {
		console.error(READ_FAILURE_MESSAGES[read.kind])

		return FAILURE_EXIT_CODE
	}

	return report(read.issues, read.cutoff, options.exclude)
}

// `process.exitCode` rather than `process.exit()`: the answer is written with `console.info`, and on
// macOS a write to a pipe is asynchronous — `process.exit()` can tear the process down before it has
// drained, and this command's whole contract is `answer=$(pnpm josh auto-ok:next)`. The same shape
// is already in `scripts/cost/cost-cli.ts`, which met the truncation first (joshuafolkken/kit#996).
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const auto_ok_cli = {
	USAGE,
	NONE_TOKEN,
	LISTING_LIMIT,
	UNREADABLE_MESSAGE,
	UNEXPECTED_SHAPE_MESSAGE,
	BLOCKERS_UNREADABLE_MESSAGE,
	TRUNCATED_WITH_ANSWER,
	TRUNCATED_WITHOUT_ANSWER,
	NONE_OPTED_IN_MESSAGE,
	truncated_cause,
	parse_issue_number,
	parse_exclude,
	parse_pair,
	parse_options,
	fetch_opted_in,
	parse_listing,
	is_page_complete,
	is_closed,
	is_unblocked,
	pick_next,
	truncation_note,
	none_reason,
	report,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { auto_ok_cli }
export type { NextOptions, OptedInRead }
