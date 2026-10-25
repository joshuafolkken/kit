import { createHash } from 'node:crypto'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'

// The tree a background `josh test:pinned` was launched on, as one digest (joshuafolkken/kit#4834):
// `josh run:review` writes it on the launch record, and `josh review:record` compares the fixed tree
// with it, so a round-1 fix that moved the tree starts the check again before the ship's pre-detach
// reads it. Read from the same changed-file map and base the gate stamps (`gate-tree.ts`).
//
// **A reading git could not answer is no key.** An empty map or an unresolved base is not a tree, and
// two of them would compare equal; the caller treats a missing key as "cannot tell" and starts nothing.

function digest_of({ files, base }: GateTree): string | undefined {
	const entries = Object.entries(files).toSorted(([left], [right]) => left.localeCompare(right))

	if (base === undefined || entries.length === 0) return undefined

	return createHash('sha256')
		.update(JSON.stringify([base, entries]))
		.digest('hex')
}

async function key(): Promise<string | undefined> {
	return digest_of(await gate_tree.read_gate_tree())
}

const run_review_pinned_tree = { digest_of, key }

export { run_review_pinned_tree }
