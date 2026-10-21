import type { FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { lint_gate_scope } from '#scripts/lint/lint-gate-scope'
import { gate_tree } from './gate-tree'
import { moved_paths } from './moved-paths'

// **A scoped check re-run reads only what moved since its last green run on this checkout**
// (joshuafolkken/kit#4393). A lane's ship retry — after a review fix or a preflight stop — re-ran
// `josh lint:related` and `josh test:related` (the gate's unit step too) over the whole branch diff,
// though everything outside the fix had been green on the tree before it.
//
// **The check is no weaker.** The green record (`scoped-green.ts`) vouches that the check passed over
// the branch diff of the tree it names; what moved since is every path whose content can differ from
// that tree (`moved-paths.ts`), a main sync's own changes included. A record written by a narrowed run
// vouches for the same thing, by the same argument one run earlier.
//
// **Whatever cannot be narrowed answers `undefined`**, and the caller reads the whole branch change as
// before: no record, one that cannot be compared, or a moved file that configures the toolchain or the
// linters — a file green under the old configuration says nothing under the new one. An empty list is
// the positive fact that nothing moved: the gate's unit step on the tree the preflight just passed.

// The narrowing line each command prints before it runs, so a since-green run is never read as one
// over the whole branch.
function describe(label: string, moved: ReadonlyArray<string>): string {
	return `${label}: reading only the ${String(moved.length)} file(s) changed since its last green run on this checkout.`
}

function is_narrowable(moved: ReadonlyArray<string> | undefined): moved is ReadonlyArray<string> {
	return moved !== undefined && !lint_gate_scope.configures_toolchain(moved)
}

// Repository-root-relative paths, or `undefined` when the caller has to read the whole branch change.
async function read_moved(
	stamp: FileMapStampAccess,
	source?: string,
): Promise<ReadonlyArray<string> | undefined> {
	const record = stamp.read(source)

	if (record === undefined) return undefined

	const moved = await moved_paths.moved_since(record, await gate_tree.read_gate_tree())

	return is_narrowable(moved) ? moved : undefined
}

const since_green = { describe, read_moved }

export { since_green }
