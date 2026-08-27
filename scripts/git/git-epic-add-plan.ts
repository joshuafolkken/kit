import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_epic_add_body } from './git-epic-add-body'
import { git_epic_chains, type InsertPosition } from './git-epic-chains'
import { git_epic_parse, type DependencyLink } from './git-epic-parse'
import { format_dependency_link, to_issue_reference } from './git-epic-reference'
import { EPIC_LABEL } from './issue-labels'

// Everything `josh epic --add` decides before it writes anything.
//
// Kept apart from the GitHub calls so the whole decision — which rows to add, which declaration to
// write, which relations to record and which to drop — is asserted without a network. That
// separation is the point: the command's value is that it refuses rather than half-applies, and a
// refusal path only reachable through `gh` is a refusal path nobody tests (joshuafolkken/kit#890).

interface PlanInput {
	epic_number: number
	body: string | undefined
	labels: ReadonlyArray<string>
	children: ReadonlyArray<number>
	position?: InsertPosition | undefined
	// The epic's current children with their native relations, as `epic:next` reads them.
	recorded: ReadonlyArray<EpicChild>
}

interface AddPlan {
	body: string
	additions: ReadonlyArray<number>
	added: ReadonlyArray<DependencyLink>
	removed: ReadonlyArray<DependencyLink>
}

type PlanOutcome = { plan: AddPlan } | { error: string }

function format_links(links: ReadonlyArray<DependencyLink>): string {
	return links.map((link) => format_dependency_link(link)).join(', ')
}

// Whether the body carries a declaration an insertion can be relative to. Split from the checks
// below so each stays one question.
function has_declaration(body: string | undefined): boolean {
	return (
		git_epic_parse.has_declared_dependency_chain(body) ||
		git_epic_parse.has_unordered_declaration(body)
	)
}

function missing_declaration_error(epic_number: number): string {
	const check = `josh epic:check ${String(epic_number)}`

	return `${to_issue_reference(epic_number)} has no machine-readable \`Dependencies\` declaration; run \`${check}\` first.`
}

// What to do about a target that is not an epic. The refusal is deliberate — this command never
// promotes an issue on its own, because promotion rewrites someone's issue into a container and the
// choice between promoting and creating a new epic depends on what the target *is*, which only a
// reader of it knows (`prompts/collaboration-workflow/split-assessment.md` → promote-or-create).
// Naming both arms is what keeps the refusal one command away from being actionable rather than a
// dead end, which is the whole point of `into <target>` (joshuafolkken/kit#985).
function promote_remedy(epic_number: number): string {
	const promote = `josh epic --promote ${String(epic_number)} <N...>`

	return `Promote it with \`${promote}\` when it is a request, a discussion or a container; create a new epic over both when it is itself one of the deliverables.`
}

// Whether the issue is an epic this command may edit. The label and the task list are checked
// separately from the declaration because they fail differently: without rows there is nowhere to
// put a new one, and without a declaration there is nothing for an insertion to be relative to.
function find_epic_shape_error(input: PlanInput, body: string): string | undefined {
	const reference = to_issue_reference(input.epic_number)

	if (!input.labels.includes(EPIC_LABEL)) {
		return `${reference} does not carry the \`${EPIC_LABEL}\` label, so it is not an epic. ${promote_remedy(input.epic_number)}`
	}

	if (git_epic_parse.has_external_task_list_entry(body)) {
		return `${reference} tracks a child in another repository; inserting into a cross-repository epic is joshuafolkken/kit#864's scope, not this command's.`
	}

	return undefined
}

function find_subject_error(input: PlanInput, tracked: ReadonlyArray<number>): string | undefined {
	const reference = to_issue_reference(input.epic_number)
	if (input.body === undefined) return `Could not read the body of ${reference}.`
	const shape_error = find_epic_shape_error(input, input.body)
	if (shape_error !== undefined) return shape_error

	if (tracked.length === 0) {
		return `${reference} tracks no child as a \`- [ ] #N\` row; there is nowhere to add one.`
	}

	return has_declaration(input.body) ? undefined : missing_declaration_error(input.epic_number)
}

// The requested children minus the ones there is nothing to do for. The epic itself is dropped
// rather than refused for the same reason `--promote` drops it: it would be asked to block itself.
function to_additions(
	input: PlanInput,
	tracked: ReadonlyArray<number>,
	declared: ReadonlyArray<number>,
): Array<number> {
	return input.children.filter(
		(child) => child !== input.epic_number && !tracked.includes(child) && !declared.includes(child),
	)
}

// Every issue the declaration names, whether or not the task list still tracks it. Filtered against
// as well as `tracked`, because the two can disagree — and re-adding an issue the chain already
// names is what produces a cycle.
function declared_numbers(chains: ReadonlyArray<ReadonlyArray<number>>): Array<number> {
	return [...new Set(chains.flat())]
}

function find_addition_error(
	additions: ReadonlyArray<number>,
	position: InsertPosition | undefined,
	tracked: ReadonlyArray<number>,
): string | undefined {
	if (additions.length === 0) {
		return 'Every issue given is already tracked by this epic; nothing to add.'
	}

	if (position !== undefined && !tracked.includes(position.target)) {
		const reference = to_issue_reference(position.target)

		return `${reference} is not a child of this epic, so it cannot position an insertion.`
	}

	return undefined
}

// A relation recorded between two children that the body never declares. Refused rather than
// repaired: someone recorded it deliberately, and rewriting the declaration around it would either
// drop that intent or leave the epic disagreeing with itself, which is what stops an unattended run.
//
// The other direction — declared but never recorded, routine when `gh` is older than 2.94.0 — is not
// an error here. It is folded into the relations this command records, so the write repairs it.
function find_relation_error(
	links: ReadonlyArray<DependencyLink>,
	recorded: ReadonlyArray<EpicChild>,
): string | undefined {
	const undeclared = epic_graph.undeclared_relations(links, recorded)
	if (undeclared.length === 0) return undefined

	const list = format_links(undeclared)

	return `The epic already records relations its body does not declare (${list}); reconcile them before inserting.`
}

// The relations to drop: declared before, not declared after, and actually recorded. Filtering by
// what is recorded keeps the command from asking `gh` to remove a link that was never there, which
// would be reported as a failure the user cannot act on.
function to_removed_links(
	dropped: ReadonlyArray<DependencyLink>,
	recorded: ReadonlyArray<EpicChild>,
): Array<DependencyLink> {
	const unapplied = epic_graph.missing_relations(dropped, recorded)
	const unrecorded = new Set(unapplied.map((link) => format_dependency_link(link)))

	return dropped.filter((link) => !unrecorded.has(format_dependency_link(link)))
}

// The write itself, once every refusal above has passed. Split out so `build_plan` stays a list of
// checks rather than a function that both checks and composes.
function to_plan(context: {
	input: PlanInput
	additions: ReadonlyArray<number>
	chains_before: ReadonlyArray<ReadonlyArray<number>>
	chains_after: ReadonlyArray<ReadonlyArray<number>>
}): PlanOutcome {
	const rewritten = git_epic_add_body.rewrite_body({
		body: context.input.body ?? '',
		additions: context.additions,
		chains_after: context.chains_after,
	})
	if ('error' in rewritten) return { error: rewritten.error }

	const links_after = git_epic_chains.links_of(context.chains_after)
	const { removed } = git_epic_chains.diff_links(context.chains_before, context.chains_after)

	return {
		plan: {
			body: rewritten.body,
			additions: context.additions,
			added: epic_graph.missing_relations(links_after, context.input.recorded),
			removed: to_removed_links(removed, context.input.recorded),
		},
	}
}

// Every refusal, in the order a reader needs them: is this an epic, is there anything to add, and do
// the body and the relations already agree.
function find_input_error(
	input: PlanInput,
	tracked: ReadonlyArray<number>,
	chains_before: ReadonlyArray<ReadonlyArray<number>>,
): string | undefined {
	return (
		find_subject_error(input, tracked) ??
		find_addition_error(
			to_additions(input, tracked, declared_numbers(chains_before)),
			input.position,
			tracked,
		) ??
		find_relation_error(git_epic_chains.links_of(chains_before), input.recorded)
	)
}

function build_plan(input: PlanInput): PlanOutcome {
	const tracked = git_epic_parse.parse_task_list_issue_numbers(input.body)
	const chains_before = git_epic_parse.parse_dependency_chains(input.body)
	const error = find_input_error(input, tracked, chains_before)
	if (error !== undefined) return { error }

	const additions = to_additions(input, tracked, declared_numbers(chains_before))
	// `tracked` reaches the chain builder so it can tell a child with no order yet from a number that
	// is not a child at all; `find_addition_error` has already refused the second (joshuafolkken/kit#949).
	const inserted = git_epic_chains.insert_children(
		chains_before,
		additions,
		input.position,
		tracked,
	)
	if ('error' in inserted) return { error: inserted.error }

	return to_plan({ input, additions, chains_before, chains_after: inserted.chains })
}

const git_epic_add_plan = {
	build_plan,
	format_links,
}

export { git_epic_add_plan }
export type { AddPlan, PlanInput, PlanOutcome }
