import { isDeepStrictEqual } from 'node:util'
import { metrics_logic, type Metrics } from './metrics-logic'
import { metrics_ratchet, type Baseline } from './metrics-ratchet'

// The three-way merge of `.josh/metrics-baseline.json`. Nearly every pull request that adds code
// rewrites every value in the file, so two lanes running side by side would conflict on it the moment
// one of them merged.
//
// **Each total is merged as `ours + theirs - base`** — what each side moved it by, added up. Two
// branches that each raised `scripts.code_lines` against the same main end with both raises, and a
// side that lowered a total keeps it lowered. The ratchet itself is untouched: the next `josh
// metrics` still measures the merged tree against this value, so a raise nobody accepted fails there
// exactly as before.
//
// **The comment ratio is recomputed, never added** — it is a quotient of two counts, so it is derived
// from the merged counts the way `metrics-logic.ts` derives it from a measured tree.
//
// **`accepted` is the record of the side that changed it, ours when both did**: the branch being
// merged into is the one whose pull request the record describes. A side that left the base's record
// as it was raised nothing, so the other side's newer record is kept rather than reverted. A side
// that cannot be read answers `undefined`, which the driver leaves to git as a conflict rather than
// guessing.

interface Sides {
	base: Metrics
	ours: Metrics
	theirs: Metrics
}

function added(sides: Sides, pick: (metrics: Metrics) => number): number {
	return pick(sides.ours) + pick(sides.theirs) - pick(sides.base)
}

function merged_scripts(sides: Sides): Metrics['scripts'] {
	const code_lines = added(sides, (metrics) => metrics.scripts.code_lines)
	const comment_lines = added(sides, (metrics) => metrics.scripts.comment_lines)

	return {
		files: added(sides, (metrics) => metrics.scripts.files),
		code_lines,
		comment_lines,
		comment_ratio: metrics_logic.comment_ratio(comment_lines, code_lines),
	}
}

function merged_totals(sides: Sides): Metrics {
	return {
		scripts: merged_scripts(sides),
		rules: {
			files: added(sides, (metrics) => metrics.rules.files),
			lines: added(sides, (metrics) => metrics.rules.lines),
		},
		guards: added(sides, (metrics) => metrics.guards),
		ai_cost: {
			resident_bytes: added(sides, (metrics) => metrics.ai_cost.resident_bytes),
			on_demand_bytes: added(sides, (metrics) => metrics.ai_cost.on_demand_bytes),
		},
	}
}

function merged_accepted(base: Baseline, ours: Baseline, theirs: Baseline): Baseline['accepted'] {
	return isDeepStrictEqual(ours.accepted, base.accepted) ? theirs.accepted : ours.accepted
}

function merged_baseline(base: Baseline, ours: Baseline, theirs: Baseline): Baseline {
	const totals = merged_totals({ base, ours, theirs })
	const accepted = merged_accepted(base, ours, theirs)

	return accepted === undefined ? totals : { ...totals, accepted }
}

// The merged file's text, or `undefined` when any of the three sides is not a readable baseline.
function merge(base_text: string, ours_text: string, theirs_text: string): string | undefined {
	const base = metrics_ratchet.parse_baseline(base_text)
	const ours = metrics_ratchet.parse_baseline(ours_text)
	const theirs = metrics_ratchet.parse_baseline(theirs_text)

	if (base === undefined || ours === undefined || theirs === undefined) return undefined

	return metrics_logic.baseline_text(merged_baseline(base, ours, theirs))
}

const metrics_baseline_merge = {
	merge,
}

export { metrics_baseline_merge }
