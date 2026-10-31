import { createHash } from 'node:crypto'
import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'

// **Why this ship ran `josh gate` again, or which tree it reused** (joshuafolkken/kit#5567). The gate
// stage, the commit stage's catch-up and the sync's merged push each meet the gate; on a tree whose
// green record the gate would only reuse, the ship starts no gate and logs `reused gate (<hash>)`. A
// gate that runs names why in one word, against the last tree this ship met the gate green on: the
// merge base moved (`merge`), the branch side moved (`fix`), or no green tree to compare (`no-record`).
// The verdict stays the gate's own — the reuse test is `josh gate`'s (`gate-skip.ts`).

const SUCCESS_EXIT_CODE = 0
const HASH_LENGTH = 12

const REASON = { MERGE: 'merge', FIX: 'fix', NO_RECORD: 'no-record' } as const

type Reason = (typeof REASON)[keyof typeof REASON]

const state: { last?: GateTree } = {}

// The tree's identity: the merge base and each changed file's digest, in path order.
function tree_hash(tree: GateTree): string {
	const files = Object.entries(tree.files).toSorted(([left], [right]) => left.localeCompare(right))
	const identity = JSON.stringify({ base: tree.base, files })

	return createHash('sha256').update(identity).digest('hex').slice(0, HASH_LENGTH)
}

function reason_of(tree: GateTree): Reason {
	const { last } = state

	if (last === undefined) return REASON.NO_RECORD
	if (last.base !== tree.base) return REASON.MERGE

	return scoped_green.is_unmoved(last, tree) ? REASON.NO_RECORD : REASON.FIX
}

function reused_line(tree: GateTree): string {
	return `reused gate (${tree_hash(tree)})`
}

function ran_line(reason: Reason): string {
	return `josh gate runs (${reason})`
}

// The tree a gate met and how it ended — only a green one is compared against.
function met(tree: GateTree, code: number): void {
	if (code === SUCCESS_EXIT_CODE) state.last = tree
}

function forget(): void {
	delete state.last
}

const run_ship_gate_runs = { REASON, forget, met, ran_line, reason_of, reused_line, tree_hash }

export type { Reason }
export { run_ship_gate_runs }
