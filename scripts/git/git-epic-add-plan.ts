import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_epic_add_body, type RewriteInput } from './git-epic-add-body'
import { git_epic_chains, type InsertOutcome, type InsertPosition } from './git-epic-chains'
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
	// `--order-before` / `--order-after`: move the task-list row to `position` and write nothing else —
	// no declaration, no `blocked-by` (joshuafolkken/kit#1738). The position is carried in the field
	// above rather than in one of its own, because where the row goes is the same question either way;
	// what this flag decides is whether a dependency is recorded behind it.
	is_order_only?: boolean | undefined
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
	// The placed children an order-only move puts on the wrong side of an order the declaration already
	// states — ahead of an issue declared to block them, or behind one they are declared to block
	// (joshuafolkken/kit#1738). **The wrong side is judged against the whole resulting row order, not
	// against the move target alone** (joshuafolkken/kit#1753): a relocation can seat a row on the wrong
	// side of a *third* child the target never named, and a check that only compared the target missed
	// it. `epic:next` filters by `blocked_by` **before** it applies task-list
	// order, so such a row cannot take effect until the declaration itself changes, and a run that only
	// printed `📋 Placed …` would report a reordering that nothing can observe.
	//
	// **Reported rather than refused.** Reordering inside a partly-ordered epic is legitimate — the row
	// still decides where the child sits among the runnable ones once its blocker closes — so only this
	// one pairing is worth a word, and refusing it would take a route the Issue did not ask to close.
	// It is empty for every insertion that writes its own declaration, since that declaration is what
	// the move would have contradicted.
	contradicted: ReadonlyArray<number>
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

	return `${nothing} Name \`--before <M>\` or \`--after <M>\` to declare an order between children it already tracks, or \`--order-before <M>\` / \`--order-after <M>\` to move the row without declaring one.`
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
// An ordinary insertion records every link the declaration names that GitHub does not, which repairs a
// declared-but-unrecorded order in passing. **An order-only move records nothing at all**
// (joshuafolkken/kit#1738): `--order-*` exists so a row can move with no dependency appearing behind
// it, and a repair made under it would put back exactly the `blocked-by` the caller asked not to have.
// The declaration is unchanged either way, so the repair is still there for the next insertion to make.
function to_added_links(
	context: PlanContext,
	links_after: ReadonlyArray<DependencyLink>,
): ReadonlyArray<DependencyLink> {
	if (context.input.is_order_only === true) return []

	return epic_graph.missing_relations(links_after, context.input.recorded, context.input.repo)
}

// Whether the declaration already says `blocker` has to finish before `blocked`. A chain is written in
// execution order, so naming the blocker at a lower index is the whole test — and it covers the
// transitive case for free, which is what makes `#890 -> #891 -> #892` answer for `#890` and `#892`.
function does_declare_order(
	chains: ReadonlyArray<ReadonlyArray<number>>,
	blocker: number,
	blocked: number,
): boolean {
	return chains.some((chain) => {
		const at_blocker = chain.indexOf(blocker)

		return at_blocker !== -1 && at_blocker < chain.indexOf(blocked)
	})
}

// Whether the resulting row order puts `child` on the wrong side of any issue the declaration orders
// it against — ahead of one declared to block it, or behind one it is declared to block. The move
// target is not privileged: a relocation can seat a row on the wrong side of a *third* child the
// target never named, so the whole resulting order is cross-checked rather than the target alone
// (joshuafolkken/kit#1753).
function does_row_contradict_order(
	chains: ReadonlyArray<ReadonlyArray<number>>,
	rows: ReadonlyArray<number>,
	child: number,
): boolean {
	const child_at = rows.indexOf(child)

	return rows.some((other, other_at) => {
		if (other === child) return false
		if (other_at < child_at) return does_declare_order(chains, child, other)

		return does_declare_order(chains, other, child)
	})
}

// The placed children the resulting row order puts on the wrong side of a declared order — see
// `contradicted` above. Asked only of an order-only move: every other insertion rewrites the
// declaration to match the row it placed, so there is nothing left for the row to contradict. The
// rows are the ones the body rewrite produced, so the check reads the order that will actually be
// written rather than reconstructing it.
function to_contradicted(
	context: PlanContext,
	result_rows: ReadonlyArray<number>,
): ReadonlyArray<number> {
	if (context.input.position === undefined || context.input.is_order_only !== true) return []

	return context.placed.filter((child) =>
		does_row_contradict_order(context.chains_before, result_rows, child),
	)
}

function to_plan(context: PlanContext): PlanOutcome {
	const { removed: replaced } = git_epic_chains.diff_links(
		context.chains_before,
		context.chains_after,
	)
	const decision = git_epic_decision.append_replacements(context.input.decision, replaced)
	const rewritten = git_epic_add_body.rewrite_body(to_rewrite_input(context, decision))
	if ('error' in rewritten) return { error: rewritten.error }

	const links_after = git_epic_chains.links_of(context.chains_after)
	const result_rows = git_epic_parse.parse_task_list_issue_numbers(rewritten.body)

	return {
		plan: {
			body: rewritten.body,
			additions: context.additions,
			relocations: context.relocations,
			added: to_added_links(context, links_after),
			// Only the links a relation actually backs: asking `gh` to remove one that was never
			// recorded is reported as a failure the user cannot act on.
			removed: epic_graph.recorded_relations(replaced, context.input.recorded, context.input.repo),
			replaced,
			contradicted: to_contradicted(context, result_rows),
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

// Asked of the declaration as it stands, because a relocation's removal can collapse the very
// ambiguity this refuses (joshuafolkken/kit#1701).
//
// **An order-only move is not asked at all** (joshuafolkken/kit#1738). The ambiguity is about where a
// *dependency* would attach — `--before <hub>` cannot say which of the chains running through the hub
// the new link joins — and `--order-*` attaches no link, so the question has no subject. Asking it
// anyway would refuse a row move on the strength of a declaration the move never touches.
function find_ambiguity_error(
	input: PlanInput,
	chains_before: ReadonlyArray<ReadonlyArray<number>>,
): string | undefined {
	if (input.is_order_only === true) return undefined

	return git_epic_chains.find_position_ambiguity(chains_before, input.position)
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
		find_ambiguity_error(input, chains_before)
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

// The declaration the body will carry. A relocation is a removal followed by the ordinary insertion,
// so `--before` re-points the chain it lands in and the vacated chain closes around it — both by
// construction rather than by a second code path (joshuafolkken/kit#1701).
//
// **An order-only move takes neither step** (joshuafolkken/kit#1738): the declaration it started with
// is the declaration it ends with, which is `keep_declaration` — the same passthrough `--add` with no
// position already uses. Because the chains come back identical, `diff_links` finds nothing replaced
// and the body rewrite leaves the `## Dependencies` section byte-identical, so "writes no dependency"
// holds by construction rather than by a filter applied afterwards.
function to_chains_after(
	input: PlanInput,
	chains_before: ReadonlyArray<ReadonlyArray<number>>,
	moves: { placed: ReadonlyArray<number>; relocations: ReadonlyArray<number> },
	tracked: ReadonlyArray<number>,
): InsertOutcome {
	if (input.is_order_only === true) return git_epic_chains.keep_declaration(chains_before)

	return git_epic_chains.insert_children(
		git_epic_chains.remove_children(chains_before, moves.relocations),
		moves.placed,
		input.position,
		tracked,
	)
}

function build_plan(input: PlanInput): PlanOutcome {
	const tracked = git_epic_parse.parse_task_list_issue_numbers(input.body)
	const chains_before = git_epic_parse.parse_dependency_chains(input.body)
	const error = find_input_error(input, tracked, chains_before)
	if (error !== undefined) return { error }

	const additions = to_additions(input, tracked, declared_numbers(chains_before))
	const relocations = to_relocations(input, tracked)
	// `tracked` reaches the chain builder so it can tell a child with no order yet from a number that is
	// not a child at all; `find_movement_error` has already refused the second (joshuafolkken/kit#949).
	// What the builder does with a relocation, and what an order-only move does instead, is on
	// `to_chains_after` above.
	const placed = to_placed(input.children, additions, relocations)
	const inserted = to_chains_after(input, chains_before, { placed, relocations }, tracked)
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
