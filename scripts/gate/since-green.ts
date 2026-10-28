import type { FileMapStampAccess } from '#scripts/josh/file-map-stamp'
import { gate_tree, type GateTree } from './gate-tree'
import { moved_paths, type MovedParts } from './moved-paths'
import { verification_inputs } from './verification-inputs'

// **A scoped check re-run reads only what moved since its last green run on this checkout**
// (joshuafolkken/kit#4393). A lane's ship retry — after a review fix or a preflight stop — re-ran
// `josh lint:related` and `josh test:related` (the gate's unit step too) over the whole branch diff,
// though everything outside the fix had been green on the tree before it.
//
// **The check is no weaker.** The green record (`scoped-green.ts`) vouches that the check passed over
// the branch diff of the tree it names; what moved since is every path whose content can differ from
// that tree (`moved-paths.ts`), a main sync's own changes included. A record written by a narrowed run
// vouches for the same thing, by the same argument one run earlier — except a bare `josh test:related`
// over a file every test imports, which ran only its direct importers, so the gate's unit leg never
// narrows by it while the branch changes one (`is_green_narrowable` in `test-related.ts`, #5122).
//
// **Whatever cannot be narrowed answers `undefined`**, and the caller reads the whole branch change as
// before: no record, one that cannot be compared, one written under other tools or environment, or a
// moved file the check's declaration names a configuration — a file green under the old configuration
// says nothing under the new one. An empty list is
// the positive fact that nothing moved: the gate's unit step on the tree the preflight just passed.

// Why a command that found nothing moved ran nothing, in the words both scoped commands print.
const UNMOVED_REASON = 'nothing moved since its last green run on this checkout'

// The narrowing line each command prints before it runs, so a since-green run is never read as one
// over the whole branch.
function describe(label: string, moved: ReadonlyArray<string>): string {
	return `${label}: reading only the ${String(moved.length)} file(s) changed since its last green run on this checkout.`
}

function is_narrowable(label: string, parts: MovedParts | undefined): parts is MovedParts {
	return parts !== undefined && !verification_inputs.configures(label, moved_paths.union_of(parts))
}

// What moved with a main sync's part kept apart, for a caller that records how much of its input the
// sync brought in (`josh test:related`, joshuafolkken/kit#4465). `label` names the gate check whose
// declaration (`verification-inputs.ts`) the record vouches for. `tree` is the caller's own reading of
// the gate tree, so a run that also records its green tree reads it once (joshuafolkken/kit#4655).
async function read_moved_parts(
	stamp: FileMapStampAccess,
	label: string,
	source?: string,
	tree?: GateTree,
): Promise<MovedParts | undefined> {
	const record = stamp.read(source)

	if (record === undefined || !stamp.describes_inputs(record)) return undefined

	const parts = await moved_paths.moved_parts(record, tree ?? (await gate_tree.read_gate_tree()))

	return is_narrowable(label, parts) ? parts : undefined
}

// Repository-root-relative paths, or `undefined` when the caller has to read the whole branch change.
async function read_moved(
	stamp: FileMapStampAccess,
	label: string,
	source?: string,
	tree?: GateTree,
): Promise<ReadonlyArray<string> | undefined> {
	const parts = await read_moved_parts(stamp, label, source, tree)

	return parts === undefined ? undefined : moved_paths.union_of(parts)
}

const since_green = { UNMOVED_REASON, describe, read_moved, read_moved_parts }

export { since_green }
