import { createHash } from 'node:crypto'
import { gate_tree } from '#scripts/gate/gate-tree'
import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import type { JoshResult } from '#scripts/josh/josh-run'
import { run_ship_tree_stamp } from './run-ship-tree-stamp'

// A detached ship asks its preflight before hand-off and again as the supervisor's first stage
// (`run-ship-cli.ts`, `run-ship-steps.ts`). A pass is recorded on the tree it read, keyed by the
// title and the body the ship delivers, so the second ask on the same tree is skipped
// (joshuafolkken/kit#6986). Any move — tree, base, title or body — asks again, and `followup`
// still refuses the merge on every precondition.

const REUSED = 'ready — preflight reused: it passed on this tree, base, title and body'

interface PreflightKey {
	issue: string
	inputs: string
}

function digest(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function stamp(key: PreflightKey, root?: string): FileMapStampAccess {
	const inputs = digest(key.inputs)

	return file_map_stamp.create(`josh-ship-preflight-${key.issue}-`, root, () => inputs)
}

// A ship with no issue to key the record by asks every time.
async function run(
	key: PreflightKey | undefined,
	ask: () => Promise<JoshResult>,
	root?: string,
): Promise<JoshResult> {
	if (key === undefined) return await ask()
	const access = stamp(key, root)
	const tree = await gate_tree.read_gate_tree()

	if (run_ship_tree_stamp.is_reusable(access, tree)) return { code: 0, out: REUSED }
	// Cleared before asking, so a refused or interrupted ask never leaves an older pass to reuse.
	access.write(tree.files, undefined, tree.base)
	const result = await ask()

	run_ship_tree_stamp.complete(access, tree, result.code)

	return result
}

const run_ship_preflight_reuse = { REUSED, run, stamp }

export type { PreflightKey }
export { run_ship_preflight_reuse }
