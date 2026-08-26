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

function insert_at_position(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition,
): InsertOutcome {
	const indices = chains_containing(chains, position.target)
	const [index] = indices

	if (index === undefined) {
		return {
			error: `${to_issue_reference(position.target)} is not named in the declared dependency order.`,
		}
	}

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

// An unordered batch with a position given: the position is the first order anyone declared, so it
// becomes the whole declaration. The children not named in it stay unordered, which is what the
// absence of a chain has always meant.
function start_chain(additions: ReadonlyArray<number>, position: InsertPosition): InsertOutcome {
	const chain =
		position.kind === 'before' ? [...additions, position.target] : [position.target, ...additions]

	return { chains: [chain] }
}

function apply_insertion(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition | undefined,
): InsertOutcome {
	if (position === undefined) return append_to_last(chains, additions)
	if (chains.length === 0) return start_chain(additions, position)

	return insert_at_position(chains, additions, position)
}

function already_declared_error(issue_number: number): string {
	const reference = to_issue_reference(issue_number)

	return `${reference} is already named in the declared dependency order; inserting it again would have it block itself.`
}

// Checked on the way in *and* on the way out. The result matters more than the input: a child the
// task list has lost but the declaration still names would otherwise be appended a second time,
// producing `#890 -> #891 -> #892 -> #891` — a cycle, whose verdict is `error`, which halts the very
// run this command exists to keep going (joshuafolkken/kit#890).
function insert_children(
	chains: Chains,
	additions: ReadonlyArray<number>,
	position: InsertPosition | undefined,
): InsertOutcome {
	const repeated = find_repeated_reference(chains)

	if (repeated !== undefined) {
		return {
			error: `The declared dependency order names ${to_issue_reference(repeated)} twice; fix the declaration before inserting.`,
		}
	}

	const outcome = apply_insertion(chains, additions, position)
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
