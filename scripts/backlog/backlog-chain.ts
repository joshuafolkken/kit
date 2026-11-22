import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { backlog_overlap, type Declared } from './backlog-overlap'
import { backlog_plan } from './backlog-plan'

// The longest serial chain through a wave plan — the floor on the run's length that running more
// lanes cannot shorten (joshuafolkken/kit#8572).
//
// A link is a blocked-by edge (blocker → the issue waiting on it) or two issues whose declared paths
// overlap (`backlog_overlap.overlap_neighbors`, the comparison the offer separates them on), pointed
// from the earlier wave to the later. The offer never puts two overlapping issues in one wave, so
// every link points forward and the links form a DAG. Among chains of one length, the one starting in
// the earliest wave, then at the smallest issue number, is chosen.

const CHAIN_LABEL = 'Longest serial chain:'
const ARROW = ' → '

interface ChainNode {
	child: EpicChild
	wave: number
	key: string
}

function nodes_of(waves: ReadonlyArray<ReadonlyArray<EpicChild>>): Array<ChainNode> {
	return waves.flatMap((wave, index) =>
		wave.map((child) => ({ child, wave: index, key: epic_graph.key_of(child) })),
	)
}

function earlier_first(left: ChainNode, right: ChainNode): number {
	return left.wave - right.wave || left.child.number - right.child.number
}

function follows(
	earlier: ChainNode,
	later: ChainNode,
	neighbors: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
	const is_blocked = later.child.blocked_by.some(
		(blocker) => epic_graph.key_of(blocker) === earlier.key,
	)

	return is_blocked || (neighbors.get(earlier.key)?.has(later.key) ?? false)
}

// Each node's key mapped to the later nodes it links to, kept in `nodes`' order.
function successors(
	nodes: ReadonlyArray<ChainNode>,
	declared: Declared,
): ReadonlyMap<string, ReadonlyArray<ChainNode>> {
	const neighbors = backlog_overlap.overlap_neighbors(
		nodes.map((node) => ({ key: node.key, paths: declared.get(node.child.number) ?? new Set() })),
	)

	return new Map(
		nodes.map((node) => [
			node.key,
			nodes.filter((later) => later.wave > node.wave && follows(node, later, neighbors)),
		]),
	)
}

// The first of the longest chains starting at `nodes`; a strict comparison keeps the earliest on a tie.
function longest_of(
	nodes: ReadonlyArray<ChainNode>,
	chains: ReadonlyMap<string, ReadonlyArray<EpicChild>>,
): ReadonlyArray<EpicChild> {
	let best: ReadonlyArray<EpicChild> = []

	for (const node of nodes) {
		const chain = chains.get(node.key) ?? []

		if (chain.length > best.length) best = chain
	}

	return best
}

// Walked from the last wave back, so every successor's chain is known before the node that links to it.
function longest_chain(
	waves: ReadonlyArray<ReadonlyArray<EpicChild>>,
	declared: Declared,
): ReadonlyArray<EpicChild> {
	const nodes = nodes_of(waves).toSorted(earlier_first)
	const next = successors(nodes, declared)
	const chains = new Map<string, ReadonlyArray<EpicChild>>()

	for (const node of nodes.toReversed()) {
		chains.set(node.key, [node.child, ...longest_of(next.get(node.key) ?? [], chains)])
	}

	return longest_of(nodes, chains)
}

// One line naming the chain and its length, or none when no two issues are linked.
function chain_lines(chain: ReadonlyArray<EpicChild>, repo: string): Array<string> {
	if (chain.length <= 1) return []
	const references = chain.map((child) => backlog_plan.marked_reference(child, repo)).join(ARROW)

	return [`${CHAIN_LABEL} ${String(chain.length)} — ${references}`]
}

const backlog_chain = {
	ARROW,
	CHAIN_LABEL,
	chain_lines,
	longest_chain,
}

export { backlog_chain }
