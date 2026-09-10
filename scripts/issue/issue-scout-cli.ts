#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { epic_audit_logic } from '#scripts/epic/epic-audit'
import { epic_bundle, type BacklogIssue, type BundleDecision } from '#scripts/epic/epic-bundle'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { epic_bundle_gaps } from '#scripts/epic/epic-bundle-gaps'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { EPIC_LABEL, has_any_label } from '#scripts/git/issue-labels'
import { PAGE_CEILING_CAUSE } from '#scripts/git/listing-cutoff'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { issue_label_schema } from '#scripts/git/schemas'
import { z } from 'zod'
import {
	issue_scout,
	type DuplicateCandidate,
	type DuplicateSearch,
	type ScoutIssue,
} from './issue-scout'

// `josh issue:scout "<title>" [--body "<summary>"]` — before an issue is filed, answer the two
// questions every `new` entry point asks first: has this already been filed, and which epic does it
// belong to (joshuafolkken/kit#1252).
//
// Both were assembled by hand every time, differently every time: a measured `fullrun new` spent
// 7 minutes 32 seconds — 22% of the run — listing epics, reading their children and searching for
// duplicates before implementation began, and the session that measured it went on to file work that
// two open issues already covered, one of them filed three minutes earlier by another session.
//
// The epic half is `epic:bundle`'s decision, called rather than restated. The duplicate half is a
// signal that command deliberately does not have, and it lives in `issue-scout.ts`.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const SCORE_DIGITS = 2
const USAGE = 'Usage: josh issue:scout "<title>" [--body "<summary>"]'
const UNKNOWN_REPO_MESSAGE =
	'Could not read this repository from `git remote`, so the backlog cannot be scanned — check `gh auth status` and that this is a checkout with an `origin` remote.'

// The draft is handed to `decide_bundle` shaped like any other backlog issue, and it needs a number
// to be one. Zero is not a valid issue number, so it collides with nothing in the listing.
const DRAFT_NUMBER = 0

// How far back the closed half of the scan reaches (joshuafolkken/kit#1679). One page: the duplicate
// this half exists to catch closed hours ago, not months, and the listing is ordered by update so
// the newest hundred already covers a run's own day several times over.
//
// **It is a window, not a cut, which is why reaching it is not warned about.** Every other listing in
// this command reports its `limit` as a gap, because there the caller wanted the whole backlog and
// got part of it; here the hundredth-most-recently-updated closed issue is where the question itself
// stops. A warning printed on every invocation in any repository with a hundred closed issues would
// carry no signal and would train a reader past the gap lines beside it that do. **The page ceiling
// is still reported**, and `ClosedScan` below says why the two are not the same event.
const CLOSED_LIMIT = 100

// Read through `has_any_label` rather than compared directly, for the casing reason
// `issue-labels.ts` records: GitHub keeps the spelling a label was created with.
const EPIC_LABELS: ReadonlySet<string> = new Set([EPIC_LABEL])

// The listing's own label shape, not a second spelling of it: a copy here would be the drift the
// shared schema module exists to prevent.
const closed_labels_schema = z.array(issue_label_schema).optional()

const closed_row_schema = z.object({
	number: z.number(),
	title: z.string().nullable(),
	labels: closed_labels_schema,
})

type ClosedRow = z.infer<typeof closed_row_schema>

// `rows` is `undefined` — never `[]` — when the listing failed: "nothing closed recently" is the
// answer that sends a run straight on to file the duplicate, which is the failure this half was
// added to prevent.
function to_closed_row(row: ClosedRow): ScoutIssue {
	return {
		number: row.number,
		title: row.title ?? '',
		is_closed: true,
		// A closed epic is still a container, and `epic_bundle_cli`'s marking cannot reach it: that one
		// is built from the *open* epic listing. Reported as a duplicate it reads as "this work is
		// already done" against an epic that never had an implementation of its own.
		is_epic: has_any_label(row.labels, EPIC_LABELS),
	}
}

function to_closed_rows(json: string): Array<ScoutIssue> | undefined {
	const rows = parse_json_array_or_undefined(json, closed_row_schema)

	return rows?.map((row) => to_closed_row(row))
}

// The rows, and whether the **page ceiling** stopped the paging short of the window. That is a
// different thing from the `limit` above, which is the window itself: pull requests are filtered out
// client-side, so a repository whose recent closures are mostly merged pull requests can select
// fewer than `CLOSED_LIMIT` issue rows while the listing still has more to give. The scan then covers
// less than it was asked for, which `git-gh-issue.ts`'s disposition table records as a warning.
interface ClosedScan {
	rows: Array<ScoutIssue> | undefined
	is_capped: boolean
}

async function read_recently_closed(): Promise<ClosedScan> {
	const { json, is_capped } = await git_gh_command.issue_list_recently_closed(CLOSED_LIMIT)

	return { rows: json === undefined ? undefined : to_closed_rows(json), is_capped }
}

// The open half already ran, so both of these are gaps in the answer rather than failures of it —
// the same disposition every other truncated listing in this command takes.
const CLOSED_UNREADABLE_LINE =
	'⚠ The recently closed issues could not be read, so the scan below covers open issues only — work that finished hours ago will not appear in it.'
const CLOSED_CEILING_LINE = `⚠ The recently closed listing ${PAGE_CEILING_CAUSE}, so a duplicate that closed inside the window may not be below.`

function warn_about_closed(scan: ClosedScan): void {
	if (scan.rows === undefined) {
		console.error(CLOSED_UNREADABLE_LINE)

		return
	}

	if (scan.is_capped) console.error(CLOSED_CEILING_LINE)
}

interface ScoutArguments {
	title: string
	body: string
}

function parse_arguments(argv: ReadonlyArray<string>): ScoutArguments | undefined {
	const { values, positionals } = parseArgs({
		args: [...argv],
		options: { body: { type: 'string' } },
		allowPositionals: true,
	})
	const [title] = positionals

	if (title === undefined || title.trim() === '') return undefined

	return { title, body: values.body ?? '' }
}

// An unknown flag makes `parseArgs` throw. Caught so the answer is the usage line rather than a stack
// trace, on a command whose output a workflow reads.
function read_arguments(argv: ReadonlyArray<string>): ScoutArguments | undefined {
	try {
		return parse_arguments(argv)
	} catch {
		return undefined
	}
}

// The issue as it would be filed. The summary is carried as the body because that is what the epic
// half reads: the issue numbers its prose names are the references `decide_bundle` decides from.
function draft_of(args: ScoutArguments, repo: string): BacklogIssue {
	return {
		number: DRAFT_NUMBER,
		repo,
		title: args.title,
		body: args.body,
		blocked_by: [],
	}
}

// The epic beside a candidate is the placement answer for a draft that cites nothing: the epic half
// below decides from prose references, and a title-only draft has none to give it.
function format_duplicate(candidate: DuplicateCandidate): string {
	const score = candidate.score.toFixed(SCORE_DIGITS)
	const epic = candidate.epic === undefined ? '' : ` (epic #${String(candidate.epic)})`
	// The reader does two different things with the two states, so the row has to say which it is: an
	// open candidate means somebody is already tracking this, a closed one means it may already be
	// done — and the second is the exit `SKILL.md` → §2g names, not a second filing.
	const closed = candidate.is_closed === true ? ' (closed)' : ''

	return `  #${String(candidate.number)}  ${score}  ${candidate.title}${closed}${epic}`
}

// Weak matches are not padding for an empty answer: a list nobody trusts is read once and skipped
// afterwards, which is the failure this command is here to end rather than reproduce. The line names
// neither bar — a candidate has to clear both, so citing the similarity alone reports a false reason
// for the title dropped by the shared-word count.
const NO_DUPLICATE_LINE =
	"Duplicates: none — no open or recently closed issue's title shares enough of this one's words to be worth reading."

// What the list is, when there is one. `total` is what cleared the bar; the list is what fits.
function duplicates_headline(shown: number, total: number): string {
	const suffix = total > shown ? ` of ${String(total)}` : ''

	return `Duplicates: ${String(shown)}${suffix} candidate(s) — read these before filing.`
}

function format_duplicates(found: DuplicateSearch): string {
	const { candidates } = found

	if (candidates.length === 0) return NO_DUPLICATE_LINE

	return [
		duplicates_headline(candidates.length, found.total),
		...candidates.map((candidate) => format_duplicate(candidate)),
	].join('\n')
}

// `Nothing to bundle.` is `epic:bundle`'s wording for an issue that exists. For one that does not, the
// actionable half is what to do instead, which is to file it on its own.
const NO_EPIC_LINE = 'Epic: none — file it standalone; nothing open shares a reference with it.'

function format_epic(decision: BundleDecision): Array<string> {
	const lines = [`Epic: ${epic_bundle_cli.ACTION_LINES[decision.action] ?? ''}`]

	if (decision.epic !== undefined) lines.push(`  Target epic: #${String(decision.epic)}`)

	if (decision.candidates.length > 0) {
		lines.push(`  Related: ${epic_bundle_cli.format_numbers(decision.candidates)}`)
	}

	if (decision.epics.length > 1) {
		lines.push(`  Epics involved: ${epic_bundle_cli.format_numbers(decision.epics)}`)
	}

	return lines
}

// A draft cites nothing, so the epic half has nothing to decide from: its two signals are prose
// references and recorded dependencies, and a title carries neither. Saying "file it standalone" there
// reports a scan that found nothing when none was possible — the confident wrong answer the gap
// warnings exist to prevent everywhere else in this command.
const NO_REFERENCE_LINE =
	'Epic: not asked — no issue number in the summary. Pass --body "…#<N>…", or take the epic printed beside a duplicate above.'

// Every placing verdict above asserts that no epic already tracks the draft's relatives, and a cut
// epic listing cannot support that: `epic:bundle` withholds them for it (joshuafolkken/kit#1697),
// while this command drew the same lines out of `ACTION_LINES` and never passed through the gate that
// does (joshuafolkken/kit#1703). The verdict is `epic:bundle`'s own, reused rather than restated, with
// only the `Epic:` label the rest of this report is read by put in front of it.
function format_unconfirmed_epic(decision: BundleDecision): string {
	const related = epic_bundle_cli.format_numbers(decision.candidates)

	return `Epic: ${epic_bundle_gaps.unconfirmed_membership(related).join('\n')}`
}

// A draft belongs to no epic yet, so `none` can only mean no signal was found — never `epic:bundle`'s
// other `none`, which is an issue its own epic already tracks. `none` is answered before the cut is
// consulted because it places nothing: there is no candidate for a hidden epic to already track.
function format_epic_decision(
	decision: BundleDecision,
	has_citation: boolean,
	is_membership_established: boolean,
): string {
	if (!has_citation) return NO_REFERENCE_LINE
	if (decision.action === 'none') return NO_EPIC_LINE
	if (!is_membership_established) return format_unconfirmed_epic(decision)

	return format_epic(decision).join('\n')
}

// Whether the summary names an issue at all, read through the same parser the decision itself uses —
// a second reading of "does this body cite anything" could disagree with the one that matters.
function has_reference(draft: BacklogIssue): boolean {
	return epic_audit_logic.parse_references(draft.body, draft.repo).length > 0
}

// The open epics the summary names outright. `decide_bundle` excludes an epic from the candidate pool
// — a container is not a sibling — so a draft saying "part of epic #1153", which is the phrasing the
// workflow documents themselves suggest, otherwise reaches `none` and is told to file standalone with
// the epic it named never mentioned.
function named_epics(draft: BacklogIssue, issues: ReadonlyArray<BacklogIssue>): Array<number> {
	const named = new Set(epic_audit_logic.parse_references(draft.body, draft.repo))

	return issues
		.filter((issue) => issue.is_epic === true && named.has(issue.number))
		.map((issue) => issue.number)
}

// A person naming the epic is the strongest signal there is — it is what §2a's `into <target>` suffix
// means — so it is reported ahead of whatever the candidate search concluded, with the candidates
// still named beside it.
function format_named_epics(epics: ReadonlyArray<number>, decision: BundleDecision): Array<string> {
	const lines = [
		`Epic: the summary names ${epic_bundle_cli.format_numbers(epics)} — add it there (Tier A — do it).`,
	]

	if (decision.candidates.length === 0) return lines

	return [...lines, `  Related: ${epic_bundle_cli.format_numbers(decision.candidates)}`]
}

// The named-epic answer survives a cut listing untouched: the epic it names is one this run actually
// read — `is_epic` is set from the epic listing, and `named_epics` filters on it — and a membership
// that was found is exactly what a cut cannot unseat. An epic past the cut is still in `issues`, the
// open backlog being listed separately, but carries no `is_epic`, so the draft naming it falls
// through to the decision below and is withheld there as an ordinary candidate.
function format_epic_answer(
	draft: BacklogIssue,
	decision: BundleDecision,
	issues: ReadonlyArray<BacklogIssue>,
	is_membership_established: boolean,
): string {
	const named = named_epics(draft, issues)

	if (named.length > 0) return format_named_epics(named, decision).join('\n')

	return format_epic_decision(decision, has_reference(draft), is_membership_established)
}

// The closed rows reach the duplicate half only. `decide_bundle` places a draft among issues that
// are still being worked on, and a closed one can neither gain a sibling nor be recommended as an
// epic — so widening the placement pool with them would answer a different question from the one it
// was asked (joshuafolkken/kit#1679).
function format_report(
	draft: BacklogIssue,
	issues: ReadonlyArray<BacklogIssue>,
	is_membership_established: boolean,
	closed: ReadonlyArray<ScoutIssue> = [],
): string {
	const duplicates = issue_scout.find_duplicates(draft.title ?? '', [...issues, ...closed])
	const decision = epic_bundle.decide_bundle(draft, issues)

	return [
		format_duplicates(duplicates),
		format_epic_answer(draft, decision, issues, is_membership_established),
	].join('\n')
}

// The backlog is read without its `blocked-by` relations: a draft has no number, so no recorded
// dependency can name it and it declares none — the reads cannot change either half of the answer,
// and skipping them takes one request per open issue off the command a run makes before every filing.
async function report(args: ScoutArguments, repo: string): Promise<number> {
	const backlog = await epic_bundle_cli.read_backlog(repo, { include_relations: false })

	if (!backlog.is_readable) {
		console.error(epic_bundle_cli.unreadable_backlog_message(backlog))

		return FAILURE_EXIT_CODE
	}

	const draft = draft_of(args, repo)
	// A reference the open listing cannot show — the parent that merged minutes ago — is read directly,
	// the same widening `epic:bundle` does and for the same reason (joshuafolkken/kit#947). The closed
	// listing needs nothing from it, so the two requests go out together.
	const [widened, closed] = await Promise.all([
		epic_bundle_cli.widen_with_referenced(draft, backlog),
		read_recently_closed(),
	])

	epic_bundle_cli.warn_about_gaps(widened)
	warn_about_closed(closed)
	// The same cut `warn_about_gaps` reports on standard error, read once more so standard output is
	// held to it too — a ⚠ beside an executable instruction is not what stops a run acting on it.
	console.info(
		format_report(
			draft,
			widened.issues,
			epic_bundle_gaps.is_membership_established(widened.epic_cutoff),
			closed.rows ?? [],
		),
	)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const args = read_arguments(argv)

	if (args === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const repo = await git_gh_command.repo_get_name_with_owner()

	// Refused rather than stood in for, exactly as `epic:bundle` refuses it: the backlog is keyed by
	// repository, so a placeholder matches nothing and every answer becomes a confident "none" built on
	// a read that failed.
	if (repo === undefined) {
		console.error(UNKNOWN_REPO_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	return await report(args, repo)
}

// `process.exitCode` rather than `process.exit()`: the answer goes to standard output and a write to
// a pipe is asynchronous on macOS, so exiting can tear the process down before it drains.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_scout_cli = {
	USAGE,
	UNKNOWN_REPO_MESSAGE,
	NO_DUPLICATE_LINE,
	NO_EPIC_LINE,
	NO_REFERENCE_LINE,
	CLOSED_UNREADABLE_LINE,
	CLOSED_CEILING_LINE,
	DRAFT_NUMBER,
	read_arguments,
	draft_of,
	format_duplicates,
	format_epic_decision,
	format_report,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_scout_cli }
