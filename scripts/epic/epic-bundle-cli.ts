#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { EPIC_LABEL } from '#scripts/git/issue-labels'
import { parse_json_array_or_undefined } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { epic_bundle, type BacklogIssue, type BundleDecision } from './epic-bundle'
import { epic_bundle_referenced, type ReferencedContext } from './epic-bundle-referenced'
import { epic_issue } from './epic-issue'

// `josh epic:bundle <N>` — after an issue is filed, look at the open backlog and say whether it
// belongs with something already there (joshuafolkken/kit#873).
//
// The machine finds the candidates; the decision to bundle is the caller's. This command prints what
// it found and what it recommends, and writes nothing.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
// The open backlog was 13 issues when this was written. Scanning all of them is instant, so there is
// no index and no cache; add one when the number makes it necessary, not before.
const BACKLOG_LIMIT = 200
const USAGE = 'Usage: josh epic:bundle <issue-number>'
const UNKNOWN_REPO = 'unknown/unknown'

const backlog_schema = z.object({ number: z.number(), body: z.string().nullable() })

// Which epic tracks each issue, from the epics' own task lists. An issue belongs to at most one,
// because that is what a task list can express.
function build_epic_index(
	epics: ReadonlyArray<{ number: number; body: string }>,
): Map<number, number> {
	const index = new Map<number, number>()

	for (const epic of epics) {
		for (const child of git_epic_parse.parse_task_list_issue_numbers(epic.body)) {
			index.set(child, epic.number)
		}
	}

	return index
}

function to_epic_field(epic: number | undefined): { epic?: number } {
	return epic === undefined ? {} : { epic }
}

// Undefined when the read failed, which the caller reports — as opposed to an issue that genuinely
// declares no relations, which is an empty array.
async function epic_issue_relations(issue_number: string): Promise<Array<number> | undefined> {
	const parsed = epic_issue.parse_epic_issue(
		await git_gh_command.issue_get_state_and_relations(issue_number),
	)

	return parsed === undefined ? undefined : epic_issue.blockers_of(parsed)
}

// One `gh issue view` per backlog issue, a few at a time.
//
// One read would do if `gh` exposed the reverse of `blockedBy`, but it does not (`blocks` is not a
// JSON field), so a dependency declared on the *other* issue is only visible by asking that issue.
// Spawning all of them at once is what turns a rate limit into a wrong answer: a refused read becomes
// an empty relation list, and a bundle that should have been proposed is reported as "no strong
// signal" instead. Batching bounds the burst; the `unreadable` list below is what keeps a refused
// read from passing as an answer (joshuafolkken/kit#873).
const RELATION_CONCURRENCY = 8

async function fetch_relations(
	numbers: ReadonlyArray<number>,
): Promise<Array<Array<number> | undefined>> {
	const results: Array<Array<number> | undefined> = []

	for (let index = 0; index < numbers.length; index += RELATION_CONCURRENCY) {
		const slice = numbers.slice(index, index + RELATION_CONCURRENCY)

		results.push(
			...(await Promise.all(
				slice.map(async (number) => await epic_issue_relations(String(number))),
			)),
		)
	}

	return results
}

// The open backlog, with each issue's relations and the epic tracking it. `unreadable` names the
// issues whose relations could not be read, so a "nothing to bundle" verdict is never quietly based
// on data that never arrived.
interface FetchedBacklog {
	issues: Array<BacklogIssue>
	unreadable: Array<number>
	is_readable: boolean
	is_truncated?: boolean
	has_epic_list?: boolean
	// The epic listing hit its own cap. Separate from `is_truncated`, which is the backlog listing:
	// the two hide different things, so a caller told only "something was truncated" cannot tell
	// whether the epic that tracks a candidate was among what it could not see.
	is_epic_list_truncated?: boolean
	// The epic view, kept so a referenced issue read afterwards can be placed without a second read.
	context?: ReferencedContext
}

async function fetch_backlog(
	repo: string,
	epics: Map<number, number>,
	epic_numbers: ReadonlySet<number> = new Set(epics.values()),
): Promise<FetchedBacklog> {
	const raw = await git_gh_command.issue_list_open_bodies(BACKLOG_LIMIT)
	// A failed listing is not an empty backlog. Reported rather than degraded into one, which would
	// have a `gh` failure arrive as "that issue does not exist".
	if (raw === undefined) return { issues: [], unreadable: [], is_readable: false }
	// Same reason as `fetch_epics`: an unparseable listing is not an empty backlog.
	const rows = parse_json_array_or_undefined(raw, backlog_schema)
	if (rows === undefined) return { issues: [], unreadable: [], is_readable: false }
	const relations = await fetch_relations(rows.map((row) => row.number))

	return {
		is_readable: true,
		// The listing is capped, and a related issue past the cap would be reported as "no existing
		// issue shares a reference" — an assertion about data that was never loaded.
		is_truncated: rows.length >= BACKLOG_LIMIT,
		issues: rows.map((row, index) => ({
			number: row.number,
			repo,
			body: row.body ?? '',
			blocked_by: relations[index] ?? [],
			is_epic: epic_numbers.has(row.number),
			...to_epic_field(epics.get(row.number)),
		})),
		unreadable: rows.filter((_, index) => relations[index] === undefined).map((row) => row.number),
	}
}

const ACTION_LINES: Readonly<Record<string, string>> = {
	add_to_epic: 'Add it to the epic that already tracks a related issue (Tier A — do it).',
	create_epic: 'Create an epic for these (Tier A — do it).',
	ask: 'Ask before bundling: merging epics is not a call to make without confirmation (Tier B).',
	none: 'Nothing to bundle.',
}

// `Nothing to bundle.` is right when nothing was found, and wrong when an epic already tracks the
// issue — there the answer is actionable: a caller looking for somewhere to put a prerequisite adds
// it to *that* epic rather than creating a second one (joshuafolkken/kit#943).
const ALREADY_TRACKED_LINE = 'Already in an epic — add to that one, do not create a second.'

function headline(decision: BundleDecision): string {
	if (decision.action === 'none' && decision.epics.length > 0) return ALREADY_TRACKED_LINE

	return ACTION_LINES[decision.action] ?? ''
}

interface FetchedEpics {
	epics: Array<{ number: number; body: string }>
	// The listing is capped like the backlog's. An epic past the cap is invisible, so the issue it
	// tracks reads as tracked by nothing and the command recommends creating a second epic over it —
	// the duplicate that joshuafolkken/kit#943 exists to prevent, arriving with exit 0
	// (joshuafolkken/kit#950).
	is_truncated: boolean
}

// The epics currently open, so a candidate can be matched to the one already tracking it.
//
// A failed read is reported rather than treated as "there are no epics": without the list, the
// guard that keeps an epic out of its own children's candidates is off, and an issue an epic already
// tracks is told to create a second one — confidently, and with exit 0.
async function fetch_epics(): Promise<FetchedEpics | undefined> {
	const raw = await git_gh_command.issue_list_by_label(EPIC_LABEL, BACKLOG_LIMIT)
	if (raw === undefined) return undefined
	// Not `parse_json_array_safe`: it answers `[]` for a response that is not JSON at all, which is
	// indistinguishable from "no epics are open" — the silent absence this whole rule is about.
	const rows = parse_json_array_or_undefined(raw, backlog_schema)
	if (rows === undefined) return undefined

	return {
		is_truncated: rows.length >= BACKLOG_LIMIT,
		epics: rows.map((row) => ({ number: row.number, body: row.body ?? '' })),
	}
}

function format_numbers(numbers: ReadonlyArray<number>): string {
	return numbers.map((issue_number) => `#${String(issue_number)}`).join(', ')
}

// The order to record alongside the bundle. Bundling without it records the batch and loses the
// reason it is a batch, so the recommendation carries it rather than leaving it to be remembered.
function format_links(links: ReadonlyArray<{ blocker: number; blocked: number }>): string {
	if (links.length === 0) return '  Order: none declared — do not invent one'
	const arrows = links.map((link) => `#${String(link.blocker)} -> #${String(link.blocked)}`)

	return `  Order: ${arrows.join(', ')}`
}

function format_order(
	decision: BundleDecision,
	subject: BacklogIssue,
	backlog: ReadonlyArray<BacklogIssue>,
): Array<string> {
	if (decision.action !== 'add_to_epic' && decision.action !== 'create_epic') return []
	const members = backlog.filter((issue) => decision.candidates.includes(issue.number))
	const children = epic_bundle.bundle_children(subject, members)

	return [
		`  Children: ${format_numbers(children)}`,
		format_links(epic_bundle.bundle_dependency_links(subject, members)),
	]
}

function format_decision(
	decision: BundleDecision,
	subject: BacklogIssue,
	backlog: ReadonlyArray<BacklogIssue>,
): string {
	const lines = [headline(decision), `  ${decision.reason}`]

	if (decision.candidates.length > 0) {
		lines.push(`  Related: ${format_numbers(decision.candidates)}`)
	}

	if (decision.epics.length > 1) {
		lines.push(`  Epics involved: ${format_numbers(decision.epics)}`)
	}

	return [...lines, ...format_order(decision, subject, backlog)].join('\n')
}

// The open backlog and the epics tracking it, read once.
async function read_backlog(repo: string): Promise<FetchedBacklog> {
	const open_epics = await fetch_epics()

	if (open_epics === undefined) {
		return { issues: [], unreadable: [], is_readable: false, has_epic_list: false }
	}

	const epics = build_epic_index(open_epics.epics)
	// From the epic list itself, not from the index's values: an epic tracking no child yet has no
	// entry in the index, and would enter the backlog as an ordinary issue that its own children then
	// propose bundling with (joshuafolkken/kit#873).
	const epic_numbers = new Set(open_epics.epics.map((epic) => epic.number))

	return {
		...(await fetch_backlog(repo, epics, epic_numbers)),
		has_epic_list: true,
		is_epic_list_truncated: open_epics.is_truncated,
		context: { repo, epics, epic_numbers },
	}
}

// The backlog the decision is made from: the open listing, plus the referenced issues it could not
// show. Without the second half the command answers about a window that closes minutes after the
// follow-up issue is filed (joshuafolkken/kit#947).
async function widen_with_referenced(
	subject: BacklogIssue,
	backlog: FetchedBacklog,
): Promise<FetchedBacklog> {
	const { context } = backlog
	if (context === undefined) return backlog
	// An issue an epic already tracks has nothing to bundle — `decide_bundle` answers from that alone
	// and never looks at the candidates. Widening first spends a request per reference on a verdict
	// that ignores them, and prints "⚠ Could not read #891." above "Already in an epic", which reads
	// as a gap in an answer the read was never part of.
	if (subject.epic !== undefined) return backlog
	const known = new Set(backlog.issues.map((issue) => issue.number))
	const found = await epic_bundle_referenced.referenced_candidates(subject, known, context)
	if (found === undefined) return backlog

	return {
		...backlog,
		issues: [...backlog.issues, ...found.issues],
		unreadable: [...backlog.unreadable, ...found.unreadable],
	}
}

// Why nothing could be recommended, when the backlog could not be read. A failed listing is not an
// empty backlog: degrading it into one had a `gh` failure arrive as "that issue does not exist".
function unreadable_backlog_message(backlog: FetchedBacklog): string {
	return backlog.has_epic_list === false
		? 'Could not list the open epics; no recommendation was made.'
		: 'Could not list the open issues; no recommendation was made.'
}

// What the read could not cover, so a verdict is never quietly based on data that never arrived.
function warn_about_gaps(backlog: FetchedBacklog): void {
	if (backlog.unreadable.length > 0) {
		console.error(`⚠ Could not read ${format_numbers(backlog.unreadable)}.`)
	}

	if (backlog.is_truncated === true) {
		console.error(
			`⚠ The backlog listing hit its ${String(BACKLOG_LIMIT)}-issue cap; older issues were not considered.`,
		)
	}

	// Named separately from the backlog's cap. What this one hides is which epic tracks a candidate,
	// so `Nothing to bundle.` under it may mean "the epic was past the cap" rather than "no epic
	// tracks it" — and acting on the second reading creates the duplicate epic (joshuafolkken/kit#950).
	if (backlog.is_epic_list_truncated === true) {
		console.error(
			`⚠ The epic listing hit its ${String(BACKLOG_LIMIT)}-epic cap; an epic past it was not considered.`,
		)
	}
}

function report_decision(subject: BacklogIssue, issues: ReadonlyArray<BacklogIssue>): number {
	const others = issues.filter((issue) => issue.number !== subject.number)

	console.info(format_decision(epic_bundle.decide_bundle(subject, others), subject, others))

	return SUCCESS_EXIT_CODE
}

// Widen, report what the read could not cover, then decide. Split out of `report_for`, which is
// otherwise all guard clauses.
async function report_widened(subject: BacklogIssue, backlog: FetchedBacklog): Promise<number> {
	const widened = await widen_with_referenced(subject, backlog)

	warn_about_gaps(widened)

	return report_decision(subject, widened.issues)
}

// The recommendation for one issue, from the open backlog around it.
async function report_for(issue_number: number, repo: string): Promise<number> {
	const backlog = await read_backlog(repo)

	if (!backlog.is_readable) {
		console.error(unreadable_backlog_message(backlog))

		return FAILURE_EXIT_CODE
	}

	const subject = backlog.issues.find((issue) => issue.number === issue_number)

	if (subject === undefined) {
		console.error(`#${String(issue_number)} is not an open issue in ${repo}.`)

		return FAILURE_EXIT_CODE
	}

	return await report_widened(subject, backlog)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = epic_issue.parse_epic_number(argv[0])

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const repo = (await git_gh_command.repo_get_name_with_owner()) ?? UNKNOWN_REPO

	return await report_for(issue_number, repo)
}

// `process.exitCode` rather than `process.exit()`: the answer goes to standard output and a write to
// a pipe is asynchronous on macOS, so exiting can tear the process down before it drains. This
// command's answer is what a workflow reads and acts on, which is exactly that pipe. The same shape
// is in `scripts/cost/cost-cli.ts`, which met the truncation first (joshuafolkken/kit#1005).
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const epic_bundle_cli = {
	USAGE,
	BACKLOG_LIMIT,
	ACTION_LINES,
	ALREADY_TRACKED_LINE,
	build_epic_index,
	format_numbers,
	format_order,
	unreadable_backlog_message,
	read_backlog,
	report_for,
	fetch_epics,
	fetch_backlog,
	widen_with_referenced,
	warn_about_gaps,
	format_decision,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { epic_bundle_cli }
