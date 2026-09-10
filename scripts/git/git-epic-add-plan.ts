import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_epic_add_body, type RewriteInput } from './git-epic-add-body'
import { git_epic_chains, type InsertPosition } from './git-epic-chains'
import { git_epic_decision } from './git-epic-decision'
import { git_epic_parse, type DependencyLink } from './git-epic-parse'
import { format_dependency_links, to_issue_reference } from './git-epic-reference'
import { git_epic_shape } from './git-epic-shape'

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
	// The epic's own repository — what a declared bare number names. Needed since
	// joshuafolkken/kit#1126 made a recorded relation carry the repository it lives in.
	repo: string
	// The decision record `--decision-file` supplied, or `undefined` for an insertion that records
	// none. It reaches the body rewrite rather than being posted separately, so the epic half of the
	// record rides on the body edit the insertion already makes (joshuafolkken/kit#1350).
	decision?: string | undefined
}

interface AddPlan {
	body: string
	additions: ReadonlyArray<number>
	// The children the epic already tracked, moved to the position the caller named. Kept apart from
	// `additions` because the two write different things: an addition gains a task-list row, while a
	// relocation only moves the row it already had (joshuafolkken/kit#1701).
	relocations: ReadonlyArray<number>
	added: ReadonlyArray<DependencyLink>
	removed: ReadonlyArray<DependencyLink>
	// Every link the declaration dropped, whether or not GitHub had recorded it natively — which is what
	// separates it from `removed` above (joshuafolkken/kit#1711). `removed` is a work list for `gh` and
	// is therefore filtered down to relations that exist to be removed; this is the *report*, and a
	// declared-but-unrecorded order the caller re-pointed is exactly as much a replacement as a recorded
	// one. Reporting from `removed` let those vanish without a word.
	replaced: ReadonlyArray<DependencyLink>
	// The `--decision-file` record as it will be written, with `replaced` appended. Carried on the plan
	// rather than recomposed by the caller so the epic's `## Decisions` and the child comments cannot
	// end up with two different texts.
	decision?: string | undefined
}

type PlanOutcome = { plan: AddPlan } | { error: string }

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

// The children the epic already tracks, given a position: what used to be filtered out as "nothing to
// do" is a reorder the moment `--before` / `--after` says where they go. Without a position there is
// still nothing to do, so the refusal below stands for that case (joshuafolkken/kit#1701).
//
// **The task list decides, not the declaration.** An issue a chain names while no row tracks it is
// what joshuafolkken/kit#890's cycle came out of, and a move that re-rendered its missing row would
// repair a body somebody has to reconcile by hand — so it stays outside a move and keeps the refusal
// it already had.
function to_relocations(input: PlanInput, tracked: ReadonlyArray<number>): Array<number> {
	if (input.position === undefined) return []

	return input.children.filter((child) => child !== input.epic_number && tracked.includes(child))
}

// The issues to place, in the order the caller gave them. Additions and relocations enter one chain
// segment together, so which comes first is the caller's word rather than which bucket it fell into
// — and the task list is written from this same list, which is what keeps the two agreeing
// (joshuafolkken/kit#1704).
function to_placed(
	children: ReadonlyArray<number>,
	additions: ReadonlyArray<number>,
	relocations: ReadonlyArray<number>,
): Array<number> {
	const placed = new Set([...additions, ...relocations])

	return [...new Set(children.filter((child) => placed.has(child)))]
}

// A position naming one of the issues being placed. `--after #N` for `#N` itself is neither an
// addition nor a move, and falling through to the refusal below would describe the wrong thing.
function find_self_position_error(input: PlanInput): string | undefined {
	const { position } = input
	if (position === undefined || !input.children.includes(position.target)) return undefined

	return `${to_issue_reference(position.target)} cannot position an insertion of itself.`
}

// Nothing to add and nothing to move. The remedy is named only where it applies: with a position
// already given, the issues are ones the declaration names but no row tracks, and telling the caller
// to name a position would send them round the same refusal.
function to_nothing_to_do_error(position: InsertPosition | undefined): string {
	const nothing = 'Every issue given is already tracked by this epic; nothing to add.'
	if (position !== undefined) return nothing

	return `${nothing} Name \`--before <M>\` or \`--after <M>\` to declare an order between children it already tracks.`
}

function find_movement_error(
	moves: { additions: ReadonlyArray<number>; relocations: ReadonlyArray<number> },
	position: InsertPosition | undefined,
	tracked: ReadonlyArray<number>,
): string | undefined {
	if (moves.additions.length === 0 && moves.relocations.length === 0) {
		return to_nothing_to_do_error(position)
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
// The other direction — declared but never recorded, which an older epic or a failed recording
// leaves behind — is not an error here. It is folded into the relations this command records, so the write repairs it.
function find_relation_error(
	links: ReadonlyArray<DependencyLink>,
	recorded: ReadonlyArray<EpicChild>,
	repo: string,
): string | undefined {
	const undeclared = epic_graph.undeclared_relations(links, recorded, repo)
	if (undeclared.length === 0) return undefined

	const list = format_dependency_links(undeclared)

	return `The epic already records relations its body does not declare (${list}); reconcile them before inserting.`
}

// What `build_plan` computed, handed to the composition below as one value: the epic's own input, the
// two kinds of placement, and the declaration before and after.
interface PlanContext {
	input: PlanInput
	additions: ReadonlyArray<number>
	relocations: ReadonlyArray<number>
	// The two above as one list, in the order the caller named them — what both the chain segment and
	// the task list are written from (joshuafolkken/kit#1704).
	placed: ReadonlyArray<number>
	chains_before: ReadonlyArray<ReadonlyArray<number>>
	chains_after: ReadonlyArray<ReadonlyArray<number>>
}

function to_rewrite_input(context: PlanContext, decision: string | undefined): RewriteInput {
	return {
		body: context.input.body ?? '',
		placed: context.placed,
		position: context.input.position,
		chains_after: context.chains_after,
		decision,
	}
}

// The write itself, once every refusal above has passed. Split out so `build_plan` stays a list of
// checks rather than a function that both checks and composes.
//
// **The replacements are folded into the decision record before the body is rewritten**, because the
// epic's `## Decisions` half rides on that same edit (joshuafolkken/kit#1350) — composing it afterwards
// would put the line on the child comments and leave the epic without it. The caller-supplied record
// has already been validated by `find_decision_error`; what is appended here is generated, not read
// from a file.
function to_plan(context: PlanContext): PlanOutcome {
	const { removed: replaced } = git_epic_chains.diff_links(
		context.chains_before,
		context.chains_after,
	)
	const decision = git_epic_decision.append_replacements(context.input.decision, replaced)
	const rewritten = git_epic_add_body.rewrite_body(to_rewrite_input(context, decision))
	if ('error' in rewritten) return { error: rewritten.error }

	const links_after = git_epic_chains.links_of(context.chains_after)

	return {
		plan: {
			body: rewritten.body,
			additions: context.additions,
			relocations: context.relocations,
			added: epic_graph.missing_relations(links_after, context.input.recorded, context.input.repo),
			// Only the links a relation actually backs: asking `gh` to remove one that was never
			// recorded is reported as a failure the user cannot act on.
			removed: epic_graph.recorded_relations(replaced, context.input.recorded, context.input.repo),
			replaced,
			decision,
		},
	}
}

// A decision record that cannot be written is refused here rather than dropped: `--decision-file` was
// given because the record has to exist, so writing the insertion without it would report success for
// half the job (joshuafolkken/kit#1350). `undefined` is "none was asked for", which is not a refusal.
function find_decision_error(decision: string | undefined): string | undefined {
	return decision === undefined ? undefined : git_epic_decision.find_decision_error(decision)
}

// The refusals about what is being placed and where: the position may not name one of the issues
// being placed, there has to be something to add or move, and the position has to identify one place.
function find_placement_error(
	input: PlanInput,
	tracked: ReadonlyArray<number>,
	chains_before: ReadonlyArray<ReadonlyArray<number>>,
): string | undefined {
	const declared = declared_numbers(chains_before)

	return (
		find_self_position_error(input) ??
		find_movement_error(
			{
				additions: to_additions(input, tracked, declared),
				relocations: to_relocations(input, tracked),
			},
			input.position,
			tracked,
		) ??
		// Asked of the declaration as it stands, because a relocation's removal can collapse the very
		// ambiguity this refuses (joshuafolkken/kit#1701).
		git_epic_chains.find_position_ambiguity(chains_before, input.position)
	)
}

// Every refusal, in the order a reader needs them: is this an epic, is there something to place and
// somewhere to put it, do the body and the relations already agree, and can the decision record be
// written.
function find_input_error(
	input: PlanInput,
	tracked: ReadonlyArray<number>,
	chains_before: ReadonlyArray<ReadonlyArray<number>>,
): string | undefined {
	return (
		git_epic_shape.find_subject_error(input, tracked) ??
		find_placement_error(input, tracked, chains_before) ??
		find_relation_error(git_epic_chains.links_of(chains_before), input.recorded, input.repo) ??
		find_decision_error(input.decision)
	)
}

function build_plan(input: PlanInput): PlanOutcome {
	const tracked = git_epic_parse.parse_task_list_issue_numbers(input.body)
	const chains_before = git_epic_parse.parse_dependency_chains(input.body)
	const error = find_input_error(input, tracked, chains_before)
	if (error !== undefined) return { error }

	const additions = to_additions(input, tracked, declared_numbers(chains_before))
	const relocations = to_relocations(input, tracked)
	// A relocation is a removal followed by the ordinary insertion, so `--before` re-points the chain
	// it lands in and the vacated chain closes around it — both by construction rather than by a second
	// code path (joshuafolkken/kit#1701). `tracked` reaches the chain builder so it can tell a child
	// with no order yet from a number that is not a child at all; `find_movement_error` has already
	// refused the second (joshuafolkken/kit#949).
	const placed = to_placed(input.children, additions, relocations)
	const inserted = git_epic_chains.insert_children(
		git_epic_chains.remove_children(chains_before, relocations),
		placed,
		input.position,
		tracked,
	)
	if ('error' in inserted) return { error: inserted.error }

	return to_plan({
		input,
		additions,
		relocations,
		placed,
		chains_before,
		chains_after: inserted.chains,
	})
}

const git_epic_add_plan = {
	build_plan,
}

export { git_epic_add_plan }
export type { AddPlan, PlanInput, PlanOutcome }
