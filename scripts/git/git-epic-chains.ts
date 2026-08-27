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

// A second declaration alongside the existing ones. Every other chain is copied through untouched:
// the target had no order, so nothing that was declared about anything else changes.
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

function insert_at_position(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition,
	tracked: ReadonlyArray<number>,
): InsertOutcome {
	const indices = chains_containing(chains, position.target)
	const [index] = indices

	if (index === undefined) return insert_outside_chains(chains, additions, position, tracked)

	if (indices.length >= AMBIGUOUS_MATCH_COUNT) {
		return {
			error: `${to_issue_reference(position.target)} appears in more than one declared chain, so "${position.kind}" does not identify one place; edit the declaration by hand.`,
		}
	}

	const chain = chains[index] ?? []
	const at = chain.indexOf(position.target) + (position.kind === 'after' ? 1 : 0)

	return {
		chains: replace_chain(chains, index, [...chain.slice(0, at), ...additions, ...chain.slice(at)]),
	}
}

// No position given: the additions extend the last declared chain. An epic with no chain at all is
// an unordered batch, and staying unordered is the right answer — adding a chain would claim an
// order nobody declared.
function append_to_last(chains: Chains, additions: ReadonlyArray<number>): InsertOutcome {
	if (chains.length === 0) return { chains: [] }
	const last = chains.length - 1

	return { chains: replace_chain(chains, last, [...(chains[last] ?? []), ...additions]) }
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
	if (position === undefined) return append_to_last(chains, additions)
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
// task list has lost but the declaration still names would otherwise be appended a second time,
// producing `#890 -> #891 -> #892 -> #891` — a cycle, whose verdict is `error`, which halts the very
// run this command exists to keep going (joshuafolkken/kit#890).
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
	insert_children,
}

export { git_epic_chains }
export type { Chain, Chains, InsertKind, InsertOutcome, InsertPosition, LinkDiff }
