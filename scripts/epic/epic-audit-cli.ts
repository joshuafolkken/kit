#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_epic_parse } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { parse_json_array_safe } from '#scripts/git/parse-json-array'
import { z } from 'zod'
import { epic_audit_logic, type AuditFinding } from './epic-audit'
import { epic_audit_checks, type AuditChild } from './epic-audit-checks'
import { epic_audit_report, type AuditResult } from './epic-audit-report'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph } from './epic-graph'
import { epic_next } from './epic-next'

// `josh epic:audit <E>` — read an epic's children against each other and report what contradicts
// what (joshuafolkken/kit#870).

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const SEARCH_LIMIT = 50
const USAGE = 'Usage: josh epic:audit <epic-number>'
const PARENT_MARKERS: ReadonlyArray<string> = ['親:', 'Parent:', '親：']
const EXTERNAL_NOTICE =
	'Note: this epic tracks children in other repositories, which are not read yet — see joshuafolkken/kit#864.'

type ReferenceState = 'OPEN' | 'CLOSED' | 'UNRESOLVED'

const searched_issue_schema = z.object({ number: z.number(), body: z.string().nullable() })

// Each child again, this time with its body. `epic:next`'s fetch reads state, labels and relations;
// the bodies are what this command exists to read, so they are fetched here rather than widening
// that one — a `wait` poll should not pay for prose it never looks at.
async function attach_bodies(children: ReadonlyArray<AuditChild>): Promise<Array<AuditChild>> {
	const bodies = await Promise.all(
		children.map(async (child) => await git_gh_command.issue_get_body(String(child.number))),
	)

	return children.map((child, index) => ({ ...child, body: bodies[index] }))
}

// Whether each referenced issue is open, closed, or absent. Only numbers actually cited are probed,
// so an epic whose children cite nothing costs no extra calls.
async function resolve_reference_states(
	referenced: ReadonlyArray<number>,
): Promise<Map<number, ReferenceState>> {
	const fetched = await Promise.all(
		referenced.map(async (issue_number) => await epic_fetch.fetch_child(issue_number, '')),
	)

	return new Map(
		referenced.map((issue_number, index) => [issue_number, fetched[index]?.state ?? 'UNRESOLVED']),
	)
}

// The issue numbers the children cite that are not children themselves — the ones check 3 resolves.
// `Set#difference` would say this in one call, but the ES2023 lib this project targets predates it.
function outside_references(children: ReadonlyArray<AuditChild>): Array<number> {
	const own = new Set(children.map((child) => child.number))
	const cited = children.flatMap((child) =>
		epic_audit_logic.parse_references(child.body ?? '', child.repo),
	)
	const outside = new Set<number>()

	for (const issue_number of cited) {
		if (!own.has(issue_number)) outside.add(issue_number)
	}

	const result: Array<number> = [...outside]

	return result
}

function has_parent_marker(line: string): boolean {
	return PARENT_MARKERS.some((marker) => line.includes(marker))
}

// Whether an issue's body names this epic as its parent, in the shape the issue template uses.
//
// Both halves must be on the *same line*. An issue parented to a different epic routinely backlinks
// this one elsewhere in its body, and matching the marker and the number independently reported
// every such issue as an orphan.
function claims_parent(body: string | null, epic_number: number): boolean {
	return (body ?? '')
		.split('\n')
		.some((line) => has_parent_marker(line) && line.includes(`#${String(epic_number)}`))
}

// Open issues naming this epic as their parent. Searched rather than derived, because an orphan is
// by definition absent from the one list that would otherwise name it. A failed search yields
// nothing: an unavailable search is not evidence of an orphan.
async function find_claiming_issues(epic_number: number): Promise<Array<number>> {
	const raw = await git_gh_command.issue_search_body(`#${String(epic_number)}`, SEARCH_LIMIT)
	if (raw === undefined) return []

	return parse_json_array_safe(raw, searched_issue_schema)
		.filter((issue) => issue.number !== epic_number && claims_parent(issue.body, epic_number))
		.map((issue) => issue.number)
}

// Everything read from GitHub that the checks need.
interface AuditInput {
	epic_number: number
	children: ReadonlyArray<AuditChild>
	tracked: ReadonlyArray<number>
	reference_states: ReadonlyMap<number, ReferenceState>
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
		...epic_audit_checks.find_implicit_dependencies(input.children, input.contradictions),
		...epic_audit_checks.find_unresolved_references(input.children, input.reference_states),
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
	)

	if (snapshot.has_external_children) console.info(EXTERNAL_NOTICE)

	return {
		epic_number,
		children,
		tracked: snapshot.child_numbers,
		reference_states: await resolve_reference_states(outside_references(children)),
		claiming: await find_claiming_issues(epic_number),
		anomalies: [...unreadable_findings(snapshot), ...graph_anomalies(snapshot, children)],
		contradictions: epic_audit_checks.find_order_contradictions(children),
	}
}

function parse_epic_number(raw = ''): number | undefined {
	if (raw.includes('/')) return undefined
	const parsed = Number(raw.replace('#', ''))

	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const epic_number = parse_epic_number(argv[0])

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

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exit(await run(argv))
}

const epic_audit_cli = {
	USAGE,
	parse_epic_number,
	attach_bodies,
	resolve_reference_states,
	outside_references,
	unreadable_findings,
	claims_parent,
	find_claiming_issues,
	audit,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { AuditInput, ReferenceState }
export { epic_audit_cli }
