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

// `chain` is the longest chain starting at this node, filled in by `longest_chain`.
interface ChainNode {
	child: EpicChild
	wave: number
	key: string
	chain: ReadonlyArray<EpicChild>
}

function nodes_of(waves: ReadonlyArray<ReadonlyArray<EpicChild>>): Array<ChainNode> {
	return waves.flatMap((wave, index) =>
		wave.map((child) => ({ child, wave: index, key: epic_graph.key_of(child), chain: [] })),
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

	return is_blocked || neighbors.get(earlier.key)?.has(later.key) === true
}

// The first of the longest chains starting at `nodes`; a strict comparison keeps the earliest on a tie.
function longest_of(nodes: ReadonlyArray<ChainNode>): ReadonlyArray<EpicChild> {
	let best: ReadonlyArray<EpicChild> = []

	for (const node of nodes) if (node.chain.length > best.length) best = node.chain

	return best
}

// Walked from the last wave back, so every later node's chain is known before a node that links to it;
// the later nodes stay in `nodes`' order, so a tie keeps the earliest.
function longest_chain(
	waves: ReadonlyArray<ReadonlyArray<EpicChild>>,
	declared: Declared,
): ReadonlyArray<EpicChild> {
	const nodes = nodes_of(waves).toSorted(earlier_first)
	const neighbors = backlog_overlap.overlap_neighbors(
		nodes.map((node) => ({ key: node.key, paths: declared.get(node.child.number) ?? new Set() })),
	)

	for (const node of nodes.toReversed()) {
		const later = nodes.filter((next) => next.wave > node.wave && follows(node, next, neighbors))

		node.chain = [node.child, ...longest_of(later)]
	}

	return longest_of(nodes)
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
