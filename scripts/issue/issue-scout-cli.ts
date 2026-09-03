#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { epic_audit_logic } from '#scripts/epic/epic-audit'
import { epic_bundle, type BacklogIssue, type BundleDecision } from '#scripts/epic/epic-bundle'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { issue_scout, type DuplicateCandidate, type DuplicateSearch } from './issue-scout'

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

	return `  #${String(candidate.number)}  ${score}  ${candidate.title}${epic}`
}

// Weak matches are not padding for an empty answer: a list nobody trusts is read once and skipped
// afterwards, which is the failure this command is here to end rather than reproduce. The line names
// neither bar — a candidate has to clear both, so citing the similarity alone reports a false reason
// for the title dropped by the shared-word count.
const NO_DUPLICATE_LINE =
	"Duplicates: none — no open issue's title shares enough of this one's words to be worth reading."

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

// A draft belongs to no epic yet, so `none` can only mean no signal was found — never `epic:bundle`'s
// other `none`, which is an issue its own epic already tracks.
function format_epic_decision(decision: BundleDecision, has_citation: boolean): string {
	if (!has_citation) return NO_REFERENCE_LINE

	return decision.action === 'none' ? NO_EPIC_LINE : format_epic(decision).join('\n')
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

function format_epic_answer(
	draft: BacklogIssue,
	decision: BundleDecision,
	issues: ReadonlyArray<BacklogIssue>,
): string {
	const named = named_epics(draft, issues)

	if (named.length > 0) return format_named_epics(named, decision).join('\n')

	return format_epic_decision(decision, has_reference(draft))
}

function format_report(draft: BacklogIssue, issues: ReadonlyArray<BacklogIssue>): string {
	const duplicates = issue_scout.find_duplicates(draft.title ?? '', issues)
	const decision = epic_bundle.decide_bundle(draft, issues)

	return [format_duplicates(duplicates), format_epic_answer(draft, decision, issues)].join('\n')
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
	// the same widening `epic:bundle` does and for the same reason (joshuafolkken/kit#947).
	const widened = await epic_bundle_cli.widen_with_referenced(draft, backlog)

	epic_bundle_cli.warn_about_gaps(widened)
	console.info(format_report(draft, widened.issues))

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
