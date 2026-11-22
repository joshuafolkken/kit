import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { backlog_overlap, type Declared } from './backlog-overlap'
import { backlog_plan } from './backlog-plan'

// The longest serial chain through a wave plan — the floor on the run's length that running more
// lanes cannot shorten (joshuafolkken/kit#8572).
//
// Two issues may never run together when one waits on the other down blocked-by, directly or through
// other planned issues, or when their declared paths overlap (`backlog_overlap.overlap_neighbors`, the
// comparison the offer separates them on). A chain is a set of issues no two of which may run
// together, so each needs its own turn whatever the lane count. Overlap is not transitive — A meeting
// B and B meeting C leaves A and C free to run together — so a chain is extended only by an issue
// that may run with none of its members. Listed in wave order; built from the last wave back, each
// node keeping the one longest chain it starts, so a longer set reached only through a shorter suffix
// can be missed — every printed chain is still a true floor. Among chains of one length, the one
// starting in the earliest wave, then at the smallest issue number, is chosen.

const CHAIN_LABEL = 'Longest serial chain:'
const ARROW = ' → '

// `ancestors` are the planned issues this one waits on down blocked-by; `chain` is the longest chain
// it starts, filled in by `longest_chain`.
interface ChainNode {
	child: EpicChild
	wave: number
	key: string
	ancestors: ReadonlySet<string>
	chain: ReadonlyArray<ChainNode>
}

// Blockers sit in earlier waves, so walking in wave order knows each blocker's ancestors first; a
// blocker outside the plan (closed, running or unreached) takes no turn in it.
function ancestors_of(child: EpicChild, by_key: ReadonlyMap<string, ChainNode>): Set<string> {
	const keys = child.blocked_by.flatMap((blocker) => {
		const found = by_key.get(epic_graph.key_of(blocker))

		return found === undefined ? [] : [found.key, ...found.ancestors]
	})

	return new Set(keys)
}

function nodes_of(waves: ReadonlyArray<ReadonlyArray<EpicChild>>): Array<ChainNode> {
	const by_key = new Map<string, ChainNode>()
	const ordered = waves.flatMap((wave, index) => wave.map((child) => ({ child, wave: index })))

	return ordered.map(({ child, wave }) => {
		const key = epic_graph.key_of(child)
		const node = { child, wave, key, ancestors: ancestors_of(child, by_key), chain: [] }

		by_key.set(key, node)

		return node
	})
}

function earlier_first(left: ChainNode, right: ChainNode): number {
	return left.wave - right.wave || left.child.number - right.child.number
}

function excludes(
	earlier: ChainNode,
	later: ChainNode,
	neighbors: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
	return later.ancestors.has(earlier.key) || neighbors.get(earlier.key)?.has(later.key) === true
}

// The first of the longest chains started at `nodes`; a strict comparison keeps the earliest on a tie.
function longest_of(nodes: ReadonlyArray<ChainNode>): ReadonlyArray<ChainNode> {
	let best: ReadonlyArray<ChainNode> = []

	for (const node of nodes) if (node.chain.length > best.length) best = node.chain

	return best
}

// Walked from the last wave back, so every later node's chain is known before a node it may extend;
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
		const later = nodes.filter(
			(next) =>
				next.wave > node.wave && next.chain.every((member) => excludes(node, member, neighbors)),
		)

		node.chain = [node, ...longest_of(later)]
	}

	return longest_of(nodes).map((node) => node.child)
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
