import { gate_plan } from './gate-plan'
import type { GateStepResult } from './gate-report'

// Whether the tree a green gate read back is still the tree its checks ran on.
// The metrics step moves `.josh/metrics-baseline.json` down when a total shrank, which changes the
// tree mid-gate, and the plain comparison then withheld the green record of a gate whose every check
// passed — `run:review --join` read that as RED.
//
// **Only the gate's own write is let through, and only when the step says it made it.** A difference
// confined to the baseline file, beside a metrics step that printed `SHRUNK_NOTE`, is that rewrite: the
// checks that ran on the old file stay green on the new one, which records lower totals the ratchet
// re-reads as unchanged. Any other moved path — an editor save, the formatter — still withholds the
// record, as does a baseline that moved without the step having said so.
//
// The path and the note live here rather than beside the ratchet because `scripts/metrics` is kit-only
// and never packed, while the gate ships: `metrics-command.ts` imports them from this module.

const BASELINE_PATH = '.josh/metrics-baseline.json'
const SHRUNK_NOTE = `a total shrank, so ${BASELINE_PATH} now records the current totals`

function moved_paths(before: Record<string, string>, after: Record<string, string>): Set<string> {
	const paths = new Set([...Object.keys(before), ...Object.keys(after)])

	return new Set([...paths].filter((file) => before[file] !== after[file]))
}

function is_baseline_rewritten(results: ReadonlyArray<GateStepResult>): boolean {
	return results.some(
		(result) => result.label === gate_plan.METRICS_LABEL && result.output.includes(SHRUNK_NOTE),
	)
}

function is_unmoved(
	before: Record<string, string>,
	after: Record<string, string>,
	results: ReadonlyArray<GateStepResult>,
): boolean {
	const moved = moved_paths(before, after)

	if (moved.size === 0) return true
	if (moved.size > 1 || !moved.has(BASELINE_PATH)) return false

	return is_baseline_rewritten(results)
}

const gate_own_write = { BASELINE_PATH, SHRUNK_NOTE, is_unmoved }

export { gate_own_write }
