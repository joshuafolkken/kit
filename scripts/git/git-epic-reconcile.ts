import { epic_graph, type EpicChild, type IssueReference } from '#scripts/epic/epic-graph'
import { git_epic_add_body } from './git-epic-add-body'
import { git_epic_chains } from './git-epic-chains'
import { git_epic_parse, type DependencyLink } from './git-epic-parse'
import { git_epic_read } from './git-epic-read'
import { format_dependency_links } from './git-epic-reference'
import { git_epic_relations } from './git-epic-relations'
import { git_gh_command } from './git-gh-command'

// `josh epic --reconcile <E>` — bring an epic's `## Dependencies` declaration and its native
// `blocked-by` relations back into agreement, without a hand edit and without recording a decision
// (joshuafolkken/kit#2235).
//
// `--add` and `--remove` refuse the moment the two disagree, and `backlog:next` reports the graph
// unusable, so the only exit was to edit the epic body by hand — the very edit those commands exist
// to remove. There is no judgement in the repair: a relation recorded but never declared is written
// into the declaration (the relation is the GitHub-side fact, the body its copy), and an order
// declared but never recorded is aligned by recording it. The result declares exactly what it
// records, which is what `epic:audit` and `backlog:next` read.
//
// **It writes no `## Decisions`.** Synchronizing a copy is not a decision — there is no judgement to
// record — so the body edit carries the declaration alone, unlike `--add` / `--remove` whose
// `--decision-file` half rides on the same edit.

const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

const NOTHING_TO_RECONCILE = 'nothing to reconcile'

// The verdict the success path leads with, so a reader distinguishes a repair from a no-op by the
// token rather than by the exit code alone. The `lane:list` oracle reads its vocabulary from the
// emitting module the same way (`lane_occupancy`).
const RECONCILED = 'reconciled'

interface ReconcilePlanInput {
	body: string | undefined
	// The epic's children with their native relations, exactly as `git_epic_read` reads them.
	recorded: ReadonlyArray<EpicChild>
	// The epic's own repository — what a declared bare number names (joshuafolkken/kit#1126).
	repo: string
}

// What the repair will write. `declare` are relations recorded but never declared — added to the
// body; `record` are orders declared but never recorded — written as `blocked-by`. A `body` of
// `undefined` means only relations changed, so the body is left byte-identical.
interface Reconciliation {
	body: string | undefined
	declare: ReadonlyArray<DependencyLink>
	record: ReadonlyArray<DependencyLink>
}

type ReconcilePlan =
	| { kind: 'nothing' }
	| { kind: 'cycle'; message: string }
	| { kind: 'reconciled'; reconciliation: Reconciliation }
	| { kind: 'error'; error: string }

function to_chain(link: DependencyLink): Array<number> {
	return [link.blocker, link.blocked]
}

// A blocker of `blocked`, keyed to the epic's own repository so a declared bare number names the
// right issue (joshuafolkken/kit#1126).
function to_blocker(link: DependencyLink, repo: string): IssueReference {
	return { repo, number: link.blocker }
}

// The union link set as children, so the shared cycle check can read it. Each node carries the
// blockers the union records; an isolated node carries none and can never be stuck.
function to_children(links: ReadonlyArray<DependencyLink>, repo: string): Array<EpicChild> {
	const blockers = new Map<number, Array<IssueReference>>()

	for (const link of links) {
		blockers.set(link.blocked, [...(blockers.get(link.blocked) ?? []), to_blocker(link, repo)])
	}

	const numbers = new Set(links.flatMap((link) => [link.blocker, link.blocked]))

	return [...numbers].map((number) => ({
		number,
		repo,
		state: 'OPEN' as const,
		labels: [],
		blocked_by: blockers.get(number) ?? [],
	}))
}

// Whether the union of declared and recorded orders is circular, read through the one anomaly finder
// `epic:next` uses rather than a second cycle walk. With the children built from the links, only a
// cycle can surface — the declaration and the relations are equal by construction.
function find_cycle(links: ReadonlyArray<DependencyLink>, repo: string): string | undefined {
	const anomalies = epic_graph.find_anomalies(to_children(links, repo), links, true, repo)

	return anomalies.find((anomaly) => anomaly.kind === 'cycle')?.message
}

// The body that declares the union order, or the reason it could not be written. Reuses the insertion
// rewriter with no rows and no decision, so "declare these links" goes through the one code path that
// already rewrites `## Dependencies` and verifies the round trip.
function to_reconciled_body(
	body: string | undefined,
	target_chains: ReadonlyArray<ReadonlyArray<number>>,
): { body: string } | { error: string } {
	return git_epic_add_body.rewrite_body({
		body: body ?? '',
		placed: [],
		position: undefined,
		chains_after: target_chains,
		decision: undefined,
	})
}

// The two-directional difference between what the body declares and what the relations record, with
// the chains the body already carries. `declare` are relations recorded but never declared; `record`
// are orders declared but never recorded.
interface Mismatch {
	chains_before: ReadonlyArray<ReadonlyArray<number>>
	declare: ReadonlyArray<DependencyLink>
	record: ReadonlyArray<DependencyLink>
}

function read_mismatch(input: ReconcilePlanInput): Mismatch {
	const chains_before = git_epic_parse.parse_dependency_chains(input.body)
	const declared = git_epic_chains.links_of(chains_before)

	return {
		chains_before,
		declare: epic_graph.undeclared_relations(declared, input.recorded, input.repo),
		record: epic_graph.missing_relations(declared, input.recorded, input.repo),
	}
}

// The reconciliation for a non-empty mismatch: refuse a cycle, record alone when only relations are
// missing, and otherwise rewrite the body to declare the union order.
function to_reconciled_plan(input: ReconcilePlanInput, mismatch: Mismatch): ReconcilePlan {
	const declared_chains = mismatch.declare.map((link) => to_chain(link))
	const target_chains = [...mismatch.chains_before, ...declared_chains]
	const cycle = find_cycle(git_epic_chains.links_of(target_chains), input.repo)
	if (cycle !== undefined) return { kind: 'cycle', message: cycle }

	const { declare, record } = mismatch

	if (declare.length === 0) {
		return { kind: 'reconciled', reconciliation: { body: undefined, declare, record } }
	}

	const rewritten = to_reconciled_body(input.body, target_chains)
	if ('error' in rewritten) return { kind: 'error', error: rewritten.error }

	return { kind: 'reconciled', reconciliation: { body: rewritten.body, declare, record } }
}

function build_reconcile_plan(input: ReconcilePlanInput): ReconcilePlan {
	const mismatch = read_mismatch(input)
	if (mismatch.declare.length === 0 && mismatch.record.length === 0) return { kind: 'nothing' }

	return to_reconciled_plan(input, mismatch)
}

// The one line the acceptance asks the repair to state itself: after this, the two readers that
// refused the mismatched epic agree on its order.
function report_agreement(epic_number: number): void {
	console.info(
		`${RECONCILED} #${String(epic_number)} — epic:audit and backlog:next now agree on this epic's order.`,
	)
}

function report_declared(epic_number: number, declare: ReadonlyArray<DependencyLink>): void {
	if (declare.length === 0) return

	console.info(
		`📋 Declared ${format_dependency_links(declare)} in epic #${String(epic_number)} to match the recorded relations.`,
	)
}

async function record_relations(record: ReadonlyArray<DependencyLink>): Promise<void> {
	if (record.length === 0) return

	const failures = await git_epic_relations.apply_relations(record, 'record')

	console.info(
		git_epic_relations.format_relation_report({ links: record, failures, action: 'record' }),
	)
}

async function apply_reconciliation(
	epic_number: number,
	reconciliation: Reconciliation,
): Promise<number> {
	if (reconciliation.body !== undefined) {
		await git_gh_command.issue_edit_body(String(epic_number), reconciliation.body)
	}

	report_declared(epic_number, reconciliation.declare)
	await record_relations(reconciliation.record)
	report_agreement(epic_number)

	return SUCCESS_EXIT_CODE
}

async function apply_plan(epic_number: number, plan: ReconcilePlan): Promise<number> {
	if (plan.kind === 'nothing') {
		console.info(NOTHING_TO_RECONCILE)

		return SUCCESS_EXIT_CODE
	}

	if (plan.kind === 'reconciled') {
		return await apply_reconciliation(epic_number, plan.reconciliation)
	}

	console.error(`✖ ${plan.kind === 'cycle' ? plan.message : plan.error}`)

	return FAILURE_EXIT_CODE
}

// Reconcile an epic's declaration with its recorded relations, or refuse without writing anything.
// Every refusal — an unreadable epic, an unreadable graph, a cycle — happens before the body edit,
// so a rejected invocation leaves the epic exactly as it was.
async function reconcile_epic(epic_number: number): Promise<number> {
	const epic = await git_epic_read.read_epic(epic_number)

	if ('error' in epic) {
		console.error(`✖ ${epic.error}`)

		return FAILURE_EXIT_CODE
	}

	const plan = build_reconcile_plan({
		body: epic.subject.body,
		recorded: epic.recorded,
		repo: epic.repo,
	})

	return await apply_plan(epic_number, plan)
}

const git_epic_reconcile = {
	NOTHING_TO_RECONCILE,
	RECONCILED,
	build_reconcile_plan,
	reconcile_epic,
}

export { git_epic_reconcile }
export type { ReconcilePlan, ReconcilePlanInput, Reconciliation }
