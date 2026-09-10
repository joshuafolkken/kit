import { chain_links, type DependencyLink } from './git-epic-parse'
import { DEPENDENCY_ARROW, format_dependency_link, to_issue_reference } from './git-epic-reference'

// The declared dependency order of an epic, as the shape an insertion needs.
//
// `epic:next` reads the declaration as a flat list of links, which is all a comparison against the
// native relations requires. An insertion cannot work from that: two disjoint chains and one
// branching chain produce the same links, and only the line structure says which chain a target sits
// in. So this module works in chains — one per declared line — and derives the links from them
// (joshuafolkken/kit#890).
//
// Every relation the caller applies comes from diffing the links before against the links after.
// That is what makes `--before` need no special case: inserting `#N` between `#B` and `#M` drops
// `#B -> #M` and adds `#B -> #N` and `#N -> #M` by construction, so the chain is never left broken.

const AMBIGUOUS_MATCH_COUNT = 2

type Chain = ReadonlyArray<number>
type Chains = ReadonlyArray<Chain>

type InsertKind = 'before' | 'after'

interface InsertPosition {
	kind: InsertKind
	target: number
}

// Either the new chains, or why the insertion was refused. Refusal is the point of the type: the
// caller must be able to stop before writing anything.
type InsertOutcome = { chains: Array<Array<number>> } | { error: string }

// One line per chain, in the form the parser reads back. A chain shorter than two references is not
// a declaration and is dropped rather than rendered as a bare `#N`, which would parse as prose.
function render_chains(chains: Chains): Array<string> {
	return chains
		.filter((chain) => chain.length > 1)
		.map((chain) => chain.map((number) => to_issue_reference(number)).join(DEPENDENCY_ARROW))
}

function links_of(chains: Chains): Array<DependencyLink> {
	return chains.flatMap((chain) => chain_links(chain))
}

// The relations to record and the relations to drop, as the difference between two declarations.
interface LinkDiff {
	added: Array<DependencyLink>
	removed: Array<DependencyLink>
}

function diff_links(before: Chains, after: Chains): LinkDiff {
	const before_links = links_of(before)
	const after_links = links_of(after)
	const before_keys = new Set(before_links.map((link) => format_dependency_link(link)))
	const after_keys = new Set(after_links.map((link) => format_dependency_link(link)))

	return {
		added: after_links.filter((link) => !before_keys.has(format_dependency_link(link))),
		removed: before_links.filter((link) => !after_keys.has(format_dependency_link(link))),
	}
}

// The indices of the chains naming `target`. More than one is ambiguous rather than wrong: the
// declaration is readable, but "immediately before #M" does not identify a single place.
function chains_containing(chains: Chains, target: number): Array<number> {
	return chains
		.map((chain, index) => (chain.includes(target) ? index : -1))
		.filter((index) => index !== -1)
}

// A chain that names the same issue twice already declares that issue to block itself. Reported
// before an insertion rather than after, since every position in such a chain is ambiguous.
function find_repeated_reference(chains: Chains): number | undefined {
	for (const chain of chains) {
		const repeated = chain.find((issue_number, index) => chain.indexOf(issue_number) !== index)

		if (repeated !== undefined) return repeated
	}

	return undefined
}

function replace_chain(
	chains: Chains,
	index: number,
	updated: ReadonlyArray<number>,
): Array<Array<number>> {
	return chains.map((chain, position) => (position === index ? [...updated] : [...chain]))
}

// The chain a position declares, on its own: `#P -> #N` for `before`, `#N -> #P` for `after`.
function chain_for(additions: ReadonlyArray<number>, position: InsertPosition): Array<number> {
	return position.kind === 'before'
		? [...additions, position.target]
		: [position.target, ...additions]
}

// An unordered batch with a position given: the position is the first order anyone declared, so it
// becomes the whole declaration. The children not named in it stay unordered, which is what the
// absence of a chain has always meant.
function start_chain(additions: ReadonlyArray<number>, position: InsertPosition): InsertOutcome {
	return { chains: [chain_for(additions, position)] }
}

// A second declaration alongside the existing ones. Every other chain is copied through untouched,
// so nothing that was declared about anything else changes. Two callers reach it: a target that no
// chain names yet, and a `--after` whose target already has a successor — a branch rather than a
// splice (joshuafolkken/kit#1080).
function add_chain(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition,
): InsertOutcome {
	return { chains: [...chains.map((chain) => [...chain]), chain_for(additions, position)] }
}

// No declared chain names the target. Two states look identical from the chains alone, and they are
// not the same thing: a child the epic tracks simply has no order yet — legitimate in an epic mixing
// ordered and unordered children — and gets the first order anyone declared for it, as a new line.
// A number that is not a child at all is still refused (joshuafolkken/kit#949).
// The only reason left to refuse a position. "Not named in the declared order" used to be it, and is
// now a legitimate state — a child with no order constraint (joshuafolkken/kit#949). The wording
// matches `find_addition_error`'s, which is what the workflow docs tell the operator to expect.
function not_a_child_error(target: number): InsertOutcome {
	return {
		error: `${to_issue_reference(target)} is not a child of this epic, so it cannot position an insertion.`,
	}
}

function insert_outside_chains(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition,
	tracked: ReadonlyArray<number>,
): InsertOutcome {
	if (tracked.includes(position.target)) return add_chain(chains, additions, position)

	return not_a_child_error(position.target)
}

// Whether the chain names anything after `target`, which is what separates a branch from a tail
// append.
function has_successor(chain: Chain, target: number): boolean {
	return chain.indexOf(target) < chain.length - 1
}

// `--after <M>` where the declaration already names something after `#M`. Splicing there puts the
// additions between `#M` and that successor, which records `#N -> #<successor>` — an order nobody
// declared, and the second of joshuafolkken/kit#1080's two paths. What `--after <M>` states is that
// `#M` must finish first, and a fan-out (`#A -> #B` beside `#A -> #C`) already expresses exactly
// that, so the addition becomes a chain line of its own and the existing one is left as it stood.
// Appending after the tail is not a branch: with no successor to displace it keeps extending the
// chain, which is what the operator asking for a tail append means.
//
// A branch needs no one chain to be identified — the addition becomes a line of its own either way —
// so a target several chains name is only ambiguous while one of them could still be *extended*.
// With a successor in every chain that names it, the answer is the same new line whichever chain a
// reader picks, and refusing would send the second branch at one fan-out point to the hand edit this
// command exists to avoid: declaring `#1107 -> #1100` beside `#1107 -> #1099` must not leave `#1107`
// impossible to position against.
function is_branching_after(
	chains: Chains,
	indices: ReadonlyArray<number>,
	position: InsertPosition,
): boolean {
	if (position.kind !== 'after') return false

	return indices.every((index) => has_successor(chains[index] ?? [], position.target))
}

function to_ambiguous_position_error(position: InsertPosition): string {
	return `${to_issue_reference(position.target)} appears in more than one declared chain, so "${position.kind}" does not identify one place; edit the declaration by hand.`
}

// The hub refusal, asked of a declaration the caller names rather than of the one an insertion is
// about to work from.
//
// A relocation splices its child out of every chain before re-inserting it, and that can **collapse**
// an ambiguity rather than resolve it: with `#890 -> #891` beside `#892 -> #891`, moving `#892` before
// `#891` leaves one chain naming `#891`, and the insertion then splices into a place nobody
// identified — recording `#890 -> #892`, an order the caller never asked for, and dropping
// `#890 -> #891`, one they never asked to lose. So the plan asks this of the declaration as it stands
// (joshuafolkken/kit#1701).
//
// **`before` is the only kind that can do it, and asking it of `after` too refuses the very case this
// Issue is about.** A `before` splices its child in *front* of the target, so the child inherits
// whatever that target was waiting on in the chain that happened to survive — a predecessor out of a
// chain nobody named. An `after` cannot: with a successor it branches into a line of its own, and
// without one it extends a tail, and in both the only relation recorded is the one the position asked
// for. So `--after #891` moving `#892` out of `#892 -> #891` correctly flips the pair to
// `#890 -> #891 -> #892`, which is exactly the reorder this command was given a move for.
function find_position_ambiguity(
	chains: Chains,
	position: InsertPosition | undefined,
): string | undefined {
	if (position?.kind !== 'before') return undefined
	if (chains_containing(chains, position.target).length < AMBIGUOUS_MATCH_COUNT) return undefined

	return to_ambiguous_position_error(position)
}

// Where a position that is not a branch lands: `--before` always, and `--after` at a chain's tail.
// Inserting between two references re-points the pair, which is what keeps `--before` from leaving
// the chain broken.
function splice_into_chain(
	chains: Chains,
	index: number,
	additions: ReadonlyArray<number>,
	position: InsertPosition,
): InsertOutcome {
	const chain = chains[index] ?? []
	const at = chain.indexOf(position.target) + (position.kind === 'after' ? 1 : 0)

	return {
		chains: replace_chain(chains, index, [...chain.slice(0, at), ...additions, ...chain.slice(at)]),
	}
}

function insert_at_position(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition,
	tracked: ReadonlyArray<number>,
): InsertOutcome {
	const indices = chains_containing(chains, position.target)
	const [index] = indices

	if (index === undefined) return insert_outside_chains(chains, additions, position, tracked)
	if (is_branching_after(chains, indices, position)) return add_chain(chains, additions, position)

	if (indices.length >= AMBIGUOUS_MATCH_COUNT) {
		return { error: to_ambiguous_position_error(position) }
	}

	return splice_into_chain(chains, index, additions, position)
}

// No position given: nothing was declared about the additions, so the declaration is copied through
// exactly as it stood. An order is recorded only where `--before` / `--after` names one.
//
// The additions used to extend the **last declared chain**, and that invented a dependency
// (joshuafolkken/kit#1253). An epic mixing ordered and unordered children is the normal state
// (joshuafolkken/kit#949), so an unrelated child added to one came out blocked by whatever issue
// happened to sit at that chain's tail — and `epic:next` then withheld it as blocked, with neither a
// park nor a `needs-decision` label to show that it was stuck. An epic with no chain at all was
// already left alone, which is the same answer this gives for every epic.
function keep_declaration(chains: Chains): InsertOutcome {
	return { chains: chains.map((chain) => [...chain]) }
}

// An epic with no chain at all, given a position. The target still has to be one of its children:
// without this the empty-declaration path accepts a target the non-empty one refuses, so the same
// input answers differently depending on whether anything happened to be declared yet.
function start_chain_or_refuse(
	additions: ReadonlyArray<number>,
	position: InsertPosition,
	tracked: ReadonlyArray<number>,
): InsertOutcome {
	if (!tracked.includes(position.target)) return not_a_child_error(position.target)

	return start_chain(additions, position)
}

function apply_insertion(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition | undefined,
	tracked: ReadonlyArray<number>,
): InsertOutcome {
	if (position === undefined) return keep_declaration(chains)
	if (chains.length === 0) return start_chain_or_refuse(additions, position, tracked)

	return insert_at_position(chains, additions, position, tracked)
}

// An addition the declaration already names, anywhere. `add_chain` can write into a chain the
// addition is not in, so the intra-chain out-guard below would not see it.
function find_already_declared_addition(
	chains: Chains,
	additions: ReadonlyArray<number>,
): number | undefined {
	const declared = new Set(chains.flat())

	return additions.find((addition) => declared.has(addition))
}

function already_declared_error(issue_number: number): string {
	const reference = to_issue_reference(issue_number)

	return `${reference} is already named in the declared dependency order; inserting it again would have it block itself.`
}

// Checked on the way in *and* on the way out. The result matters more than the input: a child the
// task list has lost but the declaration still names would otherwise be written into a chain a second
// time — `--after #892` on `#890 -> #891 -> #892 -> #891` produces a cycle, whose verdict is `error`,
// which halts the very run this command exists to keep going (joshuafolkken/kit#890). The example was
// a no-position add until joshuafolkken/kit#1253 stopped that path touching the declaration at all;
// the guard still matters, because a positioned insert writes into a chain.
//
// The two guards cover different things, and both are needed since `add_chain` can write into a
// chain the addition is not in. The in-guard refuses an addition the declaration already names
// **anywhere**; the out-guard catches a repeat **within one chain**. The out-guard deliberately does
// not scan across chains: one issue named by two of them is a fan-out — `#A -> #B` and `#A -> #C` —
// which is a legitimate declaration, not a duplicate (joshuafolkken/kit#949).
// `tracked` is the epic's task list, and it is required rather than defaulted. It separates "this
// child has no order yet" from "this number is not a child at all": the first gets a new chain, the
// second is refused. A default would make one path refuse everything and the other check nothing, so
// the same input would be accepted or refused depending only on whether anything happened to be
// declared yet (joshuafolkken/kit#949).
// Everything that can refuse the input, before anything is built from it.
function find_insertion_error(
	chains: Chains,
	additions: ReadonlyArray<number>,
): string | undefined {
	const repeated = find_repeated_reference(chains)

	if (repeated !== undefined) {
		return `The declared dependency order names ${to_issue_reference(repeated)} twice; fix the declaration before inserting.`
	}

	const declared = find_already_declared_addition(chains, additions)

	return declared === undefined ? undefined : already_declared_error(declared)
}

// A reorder expressed as a removal followed by the ordinary insertion. Splicing the child out of
// every chain that names it closes the chain around it — `#A -> #N -> #B` becomes `#A -> #B` — so the
// re-insertion goes through `insert_children` unchanged, and the relations to drop still fall out of
// diffing the declaration before against the declaration after (joshuafolkken/kit#1701).
//
// A chain left with one reference declares nothing and is dropped rather than rendered as a bare
// `#N`, which the parser would read as prose. Its remaining child simply has no order any more,
// which is the state an epic mixing ordered and unordered children is already in.
function remove_children(chains: Chains, children: ReadonlyArray<number>): Array<Array<number>> {
	const dropped = new Set(children)

	return chains
		.map((chain) => chain.filter((issue_number) => !dropped.has(issue_number)))
		.filter((chain) => chain.length > 1)
}

function insert_children(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition | undefined,
	tracked: ReadonlyArray<number>,
): InsertOutcome {
	const error = find_insertion_error(chains, additions)
	if (error !== undefined) return { error }

	const outcome = apply_insertion(chains, additions, position, tracked)
	if ('error' in outcome) return outcome

	const duplicated = find_repeated_reference(outcome.chains)

	return duplicated === undefined ? outcome : { error: already_declared_error(duplicated) }
}

const git_epic_chains = {
	render_chains,
	links_of,
	diff_links,
	find_position_ambiguity,
	remove_children,
	insert_children,
}

export { git_epic_chains }
export type { Chain, Chains, InsertKind, InsertOutcome, InsertPosition, LinkDiff }
