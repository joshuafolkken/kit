import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { git_epic_add_body, type RewriteOutcome } from './git-epic-add-body'
import { git_epic_chains } from './git-epic-chains'
import { git_epic_decision } from './git-epic-decision'
import { chain_links, git_epic_parse, type DependencyLink } from './git-epic-parse'
import { format_dependency_link, format_dependency_links } from './git-epic-reference'
import { git_epic_shape } from './git-epic-shape'

// Everything `josh epic --remove` decides before it writes anything.
//
// A declared order lives in two places at once — the epic body's `Dependencies` declaration and the
// native `blocked-by` relations — and until this command there was no way to delete one from both at
// once. The only route was the hand edit `CLAUDE.md` forbids plus a bare `DELETE` on the
// dependencies endpoint, and doing either half alone leaves `epic:next` answering
// `declaration_mismatch`, which stops an unattended run. Epic joshuafolkken/kit#1262 recorded
// twenty-nine such removals before the command existed (joshuafolkken/kit#1712).
//
// Kept apart from the GitHub calls for the reason `git-epic-add-plan.ts` is: the whole decision is
// asserted without a network, and a refusal path only reachable through `gh` is one nobody tests.

// The path whose consecutive pairs name the orders to delete. `--remove <E> 101 102 103` deletes
// `#101 -> #102` and `#102 -> #103`, which is the shape a declared chain is written in — so removing
// a whole chain is one invocation rather than one per link.
interface RemovePlanInput {
	epic_number: number
	body: string | undefined
	labels: ReadonlyArray<string>
	path: ReadonlyArray<number>
	// The epic's current children with their native relations, as `epic:next` reads them.
	recorded: ReadonlyArray<EpicChild>
	repo: string
	// The record `--decision-file` supplied, or `undefined`. It says why the order was deleted, and it
	// reaches the epic's `## Decisions` and both ends of every deleted order.
	decision?: string | undefined
}

interface RemovePlan {
	body: string
	// Every order deleted from the declaration — what the report names.
	links: ReadonlyArray<DependencyLink>
	// The subset of them a native relation actually backs, which is what there is to drop.
	removed: ReadonlyArray<DependencyLink>
	// The children a decision record is posted on: both ends of every deleted order.
	ends: ReadonlyArray<number>
}

type RemoveOutcome = { plan: RemovePlan } | { error: string }

const MINIMUM_PATH_LENGTH = 2

// The consecutive pairs of the path, as links. `chain_links` rather than a second walk of its own:
// what the caller typed is a chain, and it must be read exactly as a declared one is.
function to_path_links(path: ReadonlyArray<number>): Array<DependencyLink> {
	return chain_links(path)
}

function find_path_error(path: ReadonlyArray<number>): string | undefined {
	if (path.length < MINIMUM_PATH_LENGTH) {
		return 'Two issue numbers are required after the epic: the order to remove is `<M> <N>`, and a longer list removes each consecutive pair.'
	}

	return to_path_links(path).length === path.length - 1
		? undefined
		: 'The path names the same issue twice in a row, which declares no order.'
}

// A link the declaration does not name. Refused rather than passed through as a no-op: the caller
// believes an order exists, and answering "done" to a removal that removed nothing is how a false
// order survives the one command written to delete it.
function find_undeclared_error(
	links: ReadonlyArray<DependencyLink>,
	chains: ReadonlyArray<ReadonlyArray<number>>,
): string | undefined {
	const declared = new Set(
		git_epic_chains.links_of(chains).map((link) => format_dependency_link(link)),
	)
	const missing = links.filter((link) => !declared.has(format_dependency_link(link)))

	return missing.length === 0
		? undefined
		: `The declared dependency order does not name ${format_dependency_links(missing)}; there is nothing to remove.`
}

// A decision record that cannot be written is refused here rather than dropped, exactly as it is for
// an insertion: `--decision-file` was given because the record has to exist.
function find_decision_error(decision: string | undefined): string | undefined {
	return decision === undefined ? undefined : git_epic_decision.find_decision_error(decision)
}

function find_input_error(
	input: RemovePlanInput,
	tracked: ReadonlyArray<number>,
	chains: ReadonlyArray<ReadonlyArray<number>>,
): string | undefined {
	return (
		git_epic_shape.find_subject_error(input, tracked) ??
		find_path_error(input.path) ??
		find_undeclared_error(to_path_links(input.path), chains) ??
		find_decision_error(input.decision)
	)
}

function to_ends(links: ReadonlyArray<DependencyLink>): Array<number> {
	return [...new Set(links.flatMap((link) => [link.blocker, link.blocked]))]
}

// The rewrite is the insertion's, with nothing placed: a removal touches the declaration and never
// the task list, so the children stay exactly where they are and only the arrows go. What it does
// have to say is `does_clear_declaration` — deleting the last link means writing that there is no
// order rather than leaving the deleted chain in place.
function to_body(
	input: RemovePlanInput,
	chains_after: ReadonlyArray<ReadonlyArray<number>>,
): RewriteOutcome {
	return git_epic_add_body.rewrite_body({
		body: input.body ?? '',
		placed: [],
		chains_after,
		decision: input.decision,
		does_clear_declaration: true,
	})
}

function build_removal_plan(input: RemovePlanInput): RemoveOutcome {
	const tracked = git_epic_parse.parse_task_list_issue_numbers(input.body)
	const chains_before = git_epic_parse.parse_dependency_chains(input.body)
	const error = find_input_error(input, tracked, chains_before)
	if (error !== undefined) return { error }

	const links = to_path_links(input.path)
	const chains_after = git_epic_chains.remove_links(chains_before, links)
	const rewritten = to_body(input, chains_after)
	if ('error' in rewritten) return { error: rewritten.error }

	return {
		plan: {
			body: rewritten.body,
			links,
			// Only the links a relation actually backs: asking `gh` to remove one that was never
			// recorded is reported as a failure the user cannot act on.
			removed: epic_graph.recorded_relations(links, input.recorded, input.repo),
			ends: to_ends(links),
		},
	}
}

const git_epic_remove_plan = {
	build_removal_plan,
}

export { git_epic_remove_plan }
export type { RemovePlan, RemovePlanInput, RemoveOutcome }
