#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { parse_json_array_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import {
	epic_audit_logic,
	type AuditFinding,
	type IssueReference,
	type ReferenceState,
} from './epic-audit'
import { epic_audit_checks, type AuditChild } from './epic-audit-checks'
import { epic_audit_report, type AuditResult } from './epic-audit-report'
import { epic_cross_repo } from './epic-cross-repo'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph } from './epic-graph'
import { epic_issue } from './epic-issue'
import { epic_next } from './epic-next'

// `josh epic:audit <E>` — read an epic's children against each other and report what contradicts
// what (joshuafolkken/kit#870).

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const SEARCH_LIMIT = 50
const USAGE = 'Usage: josh epic:audit <epic-number>'
const PARENT_MARKERS: ReadonlyArray<string> = ['親:', 'Parent:', '親：']

const searched_issue_schema = z.object({ number: z.number(), body: z.string().nullable() })

// Each child again, this time with its body. `epic:next`'s fetch reads state, labels and relations;
// the bodies are what this command exists to read, so they are fetched here rather than widening
// that one — a `wait` poll should not pay for prose it never looks at.
//
// The scope comes from `epic_fetch.scope_for`, the same convention the state and relation reads
// follow, rather than a second spelling here. Without it a cross-repository child's body was read
// from *this* repository's issue of that number, and all four body-reading checks then ran against
// the wrong text (joshuafolkken/kit#1012).
async function attach_bodies(
	children: ReadonlyArray<AuditChild>,
	repo: string,
): Promise<Array<AuditChild>> {
	const bodies = await Promise.all(
		children.map(
			async (child) =>
				await git_gh_command.issue_get_body(
					String(child.number),
					epic_fetch.scope_for(child.repo, repo),
				),
		),
	)

	return children.map((child, index) => ({ ...child, body: bodies[index] }))
}

// Whether each referenced issue is open, closed, or absent. Only issues actually cited are probed,
// so an epic whose children cite nothing costs no extra calls.
//
// Each one is asked of the repository whose body named it, through the same `epic_fetch.scope_for`
// every other read goes through, and the answers are keyed by that repository and number both. Asked
// unqualified, a cross-repository child's `#40` was answered by *this* repository's issue 40 — a
// different issue, whose state then decided the warning (joshuafolkken/kit#1014).
async function resolve_reference_states(
	referenced: ReadonlyArray<IssueReference>,
	current_repo: string,
): Promise<Map<string, ReferenceState>> {
	const fetched = await Promise.all(
		referenced.map(
			async (reference) =>
				await epic_fetch.fetch_child(
					reference.number,
					reference.repo,
					epic_fetch.scope_for(reference.repo, current_repo),
				),
		),
	)

	return new Map(
		referenced.map((reference, index) => [
			epic_audit_logic.key_of(reference),
			fetched[index]?.state ?? 'UNRESOLVED',
		]),
	)
}

// The issues the children cite that are not children themselves — the ones check 3 resolves.
//
// A reference in a repository this owner does not own is left out rather than probed, inheriting
// joshuafolkken/kit#869's restriction exactly as `fetch_external_children` does: a body mentioning a
// third party's issue must not send this command to their tracker.
function outside_references(
	children: ReadonlyArray<AuditChild>,
	current_owner: string,
): Array<IssueReference> {
	const own = new Set(children.map((child) => epic_audit_logic.key_of(child)))
	const cited = children.flatMap((child) =>
		epic_audit_logic.parse_issue_references(child.body ?? '', child.repo),
	)

	return epic_audit_logic
		.unique_references(cited)
		.filter((reference) => !own.has(epic_audit_logic.key_of(reference)))
		.filter((reference) => epic_cross_repo.is_same_owner_repo(reference.repo, current_owner))
}

function has_parent_marker(line: string): boolean {
	return PARENT_MARKERS.some((marker) => line.includes(marker))
}

// Whether an issue's body names this epic as its parent, in the shape the issue template uses.
//
// Both halves must be on the *same line*. An issue parented to a different epic routinely backlinks
// this one elsewhere in its body, and matching the marker and the number independently reported
// every such issue as an orphan.
//
// The number is read through the same reference parse the checks use, so `親: owner/other#858` names
// that repository's epic and not this one's (joshuafolkken/kit#1014).
function names_this_epic(line: string, epic_number: number, repo: string): boolean {
	return epic_audit_logic
		.parse_issue_references(line, repo)
		.some((reference) => reference.repo === repo && reference.number === epic_number)
}

function claims_parent(body: string | null, epic_number: number, repo: string): boolean {
	return (body ?? '')
		.split('\n')
		.some((line) => has_parent_marker(line) && names_this_epic(line, epic_number, repo))
}

// Open issues naming this epic as their parent. Searched rather than derived, because an orphan is
// by definition absent from the one list that would otherwise name it. A failed search yields
// nothing: an unavailable search is not evidence of an orphan.
async function find_claiming_issues(epic_number: number, repo: string): Promise<Array<number>> {
	const raw = await git_gh_command.issue_search_body(`#${String(epic_number)}`, SEARCH_LIMIT)
	if (raw === undefined) return []

	return parse_json_array_safe(raw, searched_issue_schema)
		.filter((issue) => issue.number !== epic_number && claims_parent(issue.body, epic_number, repo))
		.map((issue) => issue.number)
}

// The task-list numbers that name issues in *this* repository. `snapshot.child_numbers` appends the
// cross-repository children's numbers, and an orphan is recognized by number alone — so a local
// issue whose number collided with a child in another repository was accepted as tracked and never
// reported (joshuafolkken/kit#1014). Read with the same parser `epic_fetch` reads the local rows
// with, which never matches a `- [ ] owner/repo#N` row.
function locally_tracked(snapshot: EpicSnapshot): Array<number> {
	return git_epic_parse.parse_task_list_issue_numbers(snapshot.body)
}

// Everything read from GitHub that the checks need.
interface AuditInput {
	epic_number: number
	// The `owner/repo` the command runs in. A reference is written bare when it names an issue here
	// and `owner/repo#N` when it does not, so the reader is never handed a number that resolves
	// somewhere else (joshuafolkken/kit#1014).
	repo: string
	children: ReadonlyArray<AuditChild>
	tracked: ReadonlyArray<number>
	reference_states: ReadonlyMap<string, ReferenceState>
	claiming: ReadonlyArray<number>
	anomalies: ReadonlyArray<AuditFinding>
	// Computed before the implicit-dependency check so that check can skip the pairs already reported
	// as errors — the acceptance criteria are part of the body, so every one of them would otherwise
	// arrive twice.
	contradictions: ReadonlyArray<AuditFinding>
}

// The audit itself, from already-gathered data, so the whole decision is testable without GitHub.
function audit(input: AuditInput): AuditResult {
	return epic_audit_report.build_result([
		...input.anomalies,
		...input.contradictions,
		...epic_audit_checks.find_implicit_dependencies(
			input.children,
			input.repo,
			input.contradictions,
		),
		...epic_audit_checks.find_unresolved_references(
			input.children,
			input.reference_states,
			input.repo,
		),
		...epic_audit_checks.find_orphans(input.tracked, input.claiming),
	])
}

// The graph anomalies, taken from joshuafolkken/kit#860's detection rather than re-derived here —
// including its rule for whether the body declares an order at all, which is imported rather than
// restated for exactly the drift this comment warns about.
function graph_anomalies(
	snapshot: EpicSnapshot,
	children: ReadonlyArray<AuditChild>,
): Array<AuditFinding> {
	const links = git_epic_parse.parse_dependency_links(snapshot.body)
	const is_declared = epic_next.is_order_declared(snapshot.body, links)

	return epic_audit_report.anomaly_findings(epic_graph.find_anomalies(children, links, is_declared))
}

// A child that could not be read makes every check below unreliable, and `epic:next` already refuses
// to run on that state — an audit that reported a clean bill on the same input would contradict the
// command that acts on it.
function unreadable_findings(snapshot: EpicSnapshot): Array<AuditFinding> {
	const missing = [...snapshot.unreadable, ...snapshot.skipped]
	if (missing.length === 0) return []
	const list = missing.map((issue_number) => `#${String(issue_number)}`).join(', ')

	return [
		{
			level: 'error',
			check: 'unreadable children',
			message: `Could not read ${list}; the audit would be reading an incomplete epic.`,
		},
	]
}

async function gather(epic_number: number, repo: string): Promise<AuditInput | undefined> {
	const snapshot = await epic_fetch.fetch_epic(epic_number, repo)

	if (snapshot.child_numbers.length === 0) {
		console.error(`#${String(epic_number)} tracks no children in a task list.`)

		return undefined
	}

	const children = await attach_bodies(
		snapshot.children.map((child) => ({ ...child, body: undefined })),
		repo,
	)

	if (snapshot.has_external_children) console.info(epic_next.EXTERNAL_NOTICE)

	const referenced = outside_references(children, epic_cross_repo.owner_of(repo))

	return {
		epic_number,
		repo,
		children,
		tracked: locally_tracked(snapshot),
		reference_states: await resolve_reference_states(referenced, repo),
		claiming: await find_claiming_issues(epic_number, repo),
		anomalies: [...unreadable_findings(snapshot), ...graph_anomalies(snapshot, children)],
		contradictions: epic_audit_checks.find_order_contradictions(children, repo),
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const epic_number = epic_issue.parse_epic_number(argv[0])

	if (epic_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const repo = (await git_gh_command.repo_get_name_with_owner()) ?? 'unknown/unknown'
	const input = await gather(epic_number, repo)
	if (input === undefined) return FAILURE_EXIT_CODE
	const result = audit(input)

	console.info(epic_audit_report.format_report(result))

	return result.exit_code
}

// `process.exitCode` rather than `process.exit()`: the answer goes to standard output and a write to
// a pipe is asynchronous on macOS, so exiting can tear the process down before it drains. This
// command's answer is what a workflow reads and acts on, which is exactly that pipe. The same shape
// is in `scripts/cost/cost-cli.ts`, which met the truncation first (joshuafolkken/kit#1005).
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const epic_audit_cli = {
	USAGE,
	parse_epic_number: epic_issue.parse_epic_number,
	attach_bodies,
	resolve_reference_states,
	outside_references,
	unreadable_findings,
	claims_parent,
	find_claiming_issues,
	locally_tracked,
	audit,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { AuditInput }
export { epic_audit_cli }
