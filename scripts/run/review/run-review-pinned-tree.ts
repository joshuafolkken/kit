import { createHash } from 'node:crypto'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { run_record_path } from '#scripts/josh/run-record-path'

// The tree a background `josh test:pinned` was launched on, as one digest (joshuafolkken/kit#4834):
// `josh run:review` writes it on the launch record, and `josh review:record` compares the fixed tree
// with it, so a round-1 fix that moved the tree starts the check again before the ship's pre-detach
// reads it. Read from the same changed-file map and base the gate stamps (`gate-tree.ts`).
//
// **A reading git could not answer is no key.** An empty map or an unresolved base is not a tree, and
// two of them would compare equal; the caller treats a missing key as "cannot tell" and starts nothing.
//
// **A run's own record is not the tree** (joshuafolkken/kit#5002): an observation line or a `josh
// metrics` approval written after the launch is read by no test, so it leaves the key — and the
// launch's answer — as it was (`run-record-path.ts`, the rule the verdict cache reads too).

function digest_of({ files, base }: GateTree): string | undefined {
	const entries = Object.entries(files)

	if (base === undefined || entries.length === 0) return undefined

	const code = entries
		.filter(([file]) => !run_record_path.is_run_record(file))
		.toSorted(([left], [right]) => left.localeCompare(right))

	return createHash('sha256')
		.update(JSON.stringify([base, code]))
		.digest('hex')
}

async function key(): Promise<string | undefined> {
	return digest_of(await gate_tree.read_gate_tree())
}

const run_review_pinned_tree = { digest_of, key }

export { run_review_pinned_tree }
