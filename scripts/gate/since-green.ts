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
// **Whatever cannot be narrowed answers its fallback reason**, and the caller reads the whole branch
// change as before: no record, one that cannot be compared, one written under other tools or environment, or a
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

// **Why a check read the whole branch change, in one word** (joshuafolkken/kit#5531): printed on the
// check's summary line and carried into the ship's `scoped pair` lap, so `josh lane:breakdown` tells a
// minutes-long pair's cause apart. The last three are the test side's own (`test-related.ts`).
const FALLBACK = {
	NO_RECORD: 'no-record',
	INPUT_MISMATCH: 'input-mismatch',
	NO_BASE: 'no-base',
	CONFIG_FILE: 'config-file',
	AFTER_RED: 'after-red',
	NO_READ_MAP: 'no-read-map',
	HUB: 'hub',
} as const

type FallbackReason = (typeof FALLBACK)[keyof typeof FALLBACK]

type MovedVerdict = { parts: MovedParts } | { fallback: FallbackReason }

const FALLBACK_MARK = 'whole branch — since-green fell back:'
const FALLBACK_PATTERN = new RegExp(`${FALLBACK_MARK} ([a-z-]+)`, 'u')

function fallback_line(label: string, reason: FallbackReason): string {
	return `${label}: ${FALLBACK_MARK} ${reason}.`
}

// The reasons a scoped check's output printed, deduplicated in the order they appear.
function fallbacks_of(out: string): ReadonlyArray<string> {
	const reasons = out.split('\n').map((line) => FALLBACK_PATTERN.exec(line)?.[1])

	return [...new Set(reasons.filter((reason) => reason !== undefined))]
}

function narrowed_verdict(label: string, parts: MovedParts | undefined): MovedVerdict {
	if (parts === undefined) return { fallback: FALLBACK.NO_BASE }

	if (verification_inputs.configures(label, moved_paths.union_of(parts))) {
		return { fallback: FALLBACK.CONFIG_FILE }
	}

	return { parts }
}

// What moved with a main sync's part kept apart, or why it cannot be read. `label` names the gate
// check whose declaration (`verification-inputs.ts`) the record vouches for. `tree` is the caller's
// own reading of the gate tree, so a run that also records its green tree reads it once
// (joshuafolkken/kit#4655).
async function read_verdict(
	stamp: FileMapStampAccess,
	label: string,
	source?: string,
	tree?: GateTree,
): Promise<MovedVerdict> {
	const record = stamp.read(source)

	if (record === undefined) return { fallback: FALLBACK.NO_RECORD }
	if (!stamp.describes_inputs(record)) return { fallback: FALLBACK.INPUT_MISMATCH }

	const parts = await moved_paths.moved_parts(record, tree ?? (await gate_tree.read_gate_tree()))

	return narrowed_verdict(label, parts)
}

// For a caller that records how much of its input the sync brought in (`josh test:related`,
// joshuafolkken/kit#4465).
async function read_moved_parts(
	stamp: FileMapStampAccess,
	label: string,
	source?: string,
	tree?: GateTree,
): Promise<MovedParts | undefined> {
	const verdict = await read_verdict(stamp, label, source, tree)

	return 'parts' in verdict ? verdict.parts : undefined
}

const since_green = {
	FALLBACK,
	UNMOVED_REASON,
	describe,
	fallback_line,
	fallbacks_of,
	read_moved_parts,
	read_verdict,
}

export type { FallbackReason, MovedVerdict }
export { since_green }
