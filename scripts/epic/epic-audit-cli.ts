#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_epic_decision } from '#scripts/git/git-epic-decision'
import { git_epic_parse, type DependencyLink } from '#scripts/git/git-epic-parse'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { issue_read } from '#scripts/issue/issue-read'
import { epic_audit_logic, type AuditFinding, type ReferenceState } from './epic-audit'
import { epic_audit_checks, type AuditChild } from './epic-audit-checks'
import { epic_audit_orphans, type ClaimingSearch } from './epic-audit-orphans'
import { epic_audit_rationale, type OrderPair } from './epic-audit-rationale'
import { epic_audit_report, type AuditResult } from './epic-audit-report'
import { epic_cross_repo } from './epic-cross-repo'
import { epic_fetch, type EpicSnapshot } from './epic-fetch'
import { epic_graph, type IssueReference } from './epic-graph'
import { epic_issue } from './epic-issue'
import { epic_next } from './epic-next'

// `josh epic:audit <E>` — read an epic's children against each other and report what contradicts
// what (joshuafolkken/kit#870).

const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const USAGE = 'Usage: josh epic:audit <epic-number>'
// Check 3 filters the issues the children cite down to this owner's repositories, so a repository
// name it could not read silently dropped every qualified reference and reported nothing. A check
// that disables itself without saying so is worse than one that fails: the report reads clean
// (joshuafolkken/kit#1016).
const UNREADABLE_REPO =
	'Could not read this repository as `owner/name`, so a reference could not be resolved against it — check `gh auth status` and that this checkout has a GitHub remote.'

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
			epic_graph.key_of(reference),
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
	current_repo: string,
): Array<IssueReference> {
	const own = new Set(children.map((child) => epic_graph.key_of(child)))
	const known = epic_audit_logic.known_repos(children, current_repo)
	const cited = children.flatMap((child) =>
		epic_audit_logic.parse_issue_references(child.body ?? '', child.repo, known),
	)
	const owner = epic_cross_repo.owner_of(current_repo)

	return epic_audit_logic
		.unique_references(cited)
		.filter((reference) => !own.has(epic_graph.key_of(reference)))
		.filter((reference) => epic_cross_repo.is_same_owner_repo(reference.repo, owner))
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
	// The orphan search's whole outcome, not just what it found: a listing that failed and a listing
	// the page ceiling cut short are both reported, because `[]` here is indistinguishable from
	// "nothing claims this epic" (joshuafolkken/kit#1033).
	claiming: ClaimingSearch
	anomalies: ReadonlyArray<AuditFinding>
	// Computed before the implicit-dependency check so that check can skip the pairs already reported
	// as errors — the acceptance criteria are part of the body, so every one of them would otherwise
	// arrive twice.
	contradictions: ReadonlyArray<AuditFinding>
	// The declared orders check 6 may speak about, already resolved to children and narrowed to the
	// open, local pairs (joshuafolkken/kit#1712).
	order_pairs: ReadonlyArray<OrderPair>
	// The epic's `## Decisions` section, and the comments on those pairs' ends — the two places a
	// placement decision is recorded, and therefore the whole of what check 6 reads.
	decisions: string
	order_comments: ReadonlyMap<string, ReadonlyArray<string>>
}

// The checks that read what the children say about each other.
function body_findings(input: AuditInput): Array<AuditFinding> {
	return [
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
		...epic_audit_checks.find_nested_epics(input.children, input.repo),
	]
}

// The checks that read the epic's own declaration and its task list.
function epic_findings(input: AuditInput): Array<AuditFinding> {
	return [
		...epic_audit_rationale.find_unjustified_orders({
			pairs: input.order_pairs,
			decisions: input.decisions,
			comments: input.order_comments,
			current_repo: input.repo,
		}),
		...epic_audit_orphans.search_findings(input.claiming),
		...epic_audit_checks.find_orphans(
			input.tracked,
			epic_audit_orphans.claimed_numbers(input.claiming),
		),
	]
}

// The audit itself, from already-gathered data, so the whole decision is testable without GitHub.
function audit(input: AuditInput): AuditResult {
	return epic_audit_report.build_result([
		...input.anomalies,
		...input.contradictions,
		...body_findings(input),
		...epic_findings(input),
	])
}

// The graph anomalies, taken from joshuafolkken/kit#860's detection rather than re-derived here —
// including its rule for whether the body declares an order at all, which is imported rather than
// restated for exactly the drift this comment warns about.
function graph_anomalies(
	snapshot: EpicSnapshot,
	children: ReadonlyArray<AuditChild>,
	links: ReadonlyArray<DependencyLink>,
): Array<AuditFinding> {
	const is_declared = epic_next.is_order_declared(snapshot.body, links)

	return epic_audit_report.anomaly_findings(
		epic_graph.find_anomalies(children, links, is_declared, snapshot.repo),
	)
}

// The findings that come from the fetch and the graph rather than from reading the bodies.
function fetch_anomalies(
	snapshot: EpicSnapshot,
	children: ReadonlyArray<AuditChild>,
	links: ReadonlyArray<DependencyLink>,
): Array<AuditFinding> {
	return [
		...epic_audit_report.unreadable_findings(
			epic_fetch.missing_children(snapshot),
			snapshot.current_repo,
		),
		...graph_anomalies(snapshot, children, links),
	]
}

// The comments on the ends of the declared orders check 6 asks about — and on nothing else. Most
// epics declare no order at all, so this reads nothing; an epic that declares a chain pays one
// listing per issue in it.
//
// A listing that could not be read is left out of the map rather than entered as `[]`, so a
// transport failure reads as "not asked" instead of "nobody recorded anything" — the finding it
// would otherwise manufacture is an `error`, which stops the epic.
async function read_order_comments(
	pairs: ReadonlyArray<OrderPair>,
): Promise<Map<string, ReadonlyArray<string>>> {
	const ends = epic_audit_rationale.pair_ends(pairs)
	const listings = await Promise.all(
		ends.map(async (child) => await git_gh_command.issue_list_comments(String(child.number))),
	)

	return new Map(
		ends.flatMap((child, index) => {
			const comments = issue_read.parse_comments(listings[index])

			return comments === undefined
				? []
				: [[epic_graph.key_of(child), comments.map((comment) => comment.body)] as const]
		}),
	)
}

// Why a snapshot yields nothing to audit, with the two reasons told apart (joshuafolkken/kit#1690).
// A body nobody could read parses to zero children exactly as an unpopulated task list does, so
// without this the audit reported an epic it never read as one tracking no children — and sent the
// reader to fill in a task list that is already there.
function no_children_reason(snapshot: EpicSnapshot, epic_number: number): string | undefined {
	if (snapshot.body_failure !== undefined) {
		return `Could not read the body of #${String(epic_number)}. Its task list is what names the children — check \`gh auth status\` and the connection.`
	}

	if (snapshot.child_numbers.length === 0) {
		return `#${String(epic_number)} tracks no children in a task list.`
	}

	return undefined
}

// Everything the input needs once the children have been read: the declaration is parsed once here
// and handed to both the graph anomalies and check 6, rather than parsed twice.
async function to_audit_input(
	snapshot: EpicSnapshot,
	children: ReadonlyArray<AuditChild>,
	epic_number: number,
	repo: string,
): Promise<AuditInput> {
	const links = git_epic_parse.parse_dependency_links(snapshot.body)
	const order_pairs = epic_audit_rationale.order_pairs(links, children, snapshot.repo, repo)

	return {
		epic_number,
		repo,
		children,
		tracked: epic_audit_orphans.locally_tracked(snapshot),
		reference_states: await resolve_reference_states(outside_references(children, repo), repo),
		claiming: await epic_audit_orphans.find_claiming_issues(epic_number, repo),
		anomalies: fetch_anomalies(snapshot, children, links),
		contradictions: epic_audit_checks.find_order_contradictions(children, repo),
		order_pairs,
		decisions: git_epic_decision.read_recorded_reasons(snapshot.body),
		order_comments: await read_order_comments(order_pairs),
	}
}

async function gather(epic_number: number, repo: string): Promise<AuditInput | undefined> {
	const snapshot = await epic_fetch.fetch_epic(epic_number, repo)
	const reason = no_children_reason(snapshot, epic_number)

	if (reason !== undefined) {
		console.error(reason)

		return undefined
	}

	const children = await attach_bodies(
		snapshot.children.map((child) => ({ ...child, body: undefined })),
		repo,
	)

	if (snapshot.has_external_children) console.info(epic_next.EXTERNAL_NOTICE)

	return await to_audit_input(snapshot, children, epic_number, repo)
}

async function report_audit(epic_number: number, repo: string): Promise<number> {
	const input = await gather(epic_number, repo)
	if (input === undefined) return FAILURE_EXIT_CODE
	const result = audit(input)

	console.info(epic_audit_report.format_report(result))

	return result.exit_code
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const epic_number = epic_issue.parse_epic_number(argv[0])

	if (epic_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const repo = await git_gh_command.repo_get_name_with_owner()

	if (repo === undefined) {
		console.error(UNREADABLE_REPO)

		return FAILURE_EXIT_CODE
	}

	return await report_audit(epic_number, repo)
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
	UNREADABLE_REPO,
	parse_epic_number: epic_issue.parse_epic_number,
	attach_bodies,
	resolve_reference_states,
	outside_references,
	read_order_comments,
	audit,
	run,
	main,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { AuditInput }
export { epic_audit_cli }
