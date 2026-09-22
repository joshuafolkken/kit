// Whether the Step 0 change list can be cut into file-disjoint units and dispatched in one fan-out
// turn, or must stay serial because two proposed units would edit the same file (joshuafolkken/kit#2345).
//
// **File-disjointness is the necessary condition, and it is mechanical.** Two subagents editing the
// same file in parallel race on that file — the later write lands on top of the earlier, or the gate
// has to reconcile a collision the parallelism was supposed to save. So the split is refused the
// moment any file appears in more than one unit, and the default is serial: fewer than two units is
// nothing to run in parallel. Nothing here is a judgement — the answer is read off the file sets.

type FanoutVerdict = 'parallel' | 'serial'

const PARALLEL_VERDICT: FanoutVerdict = 'parallel'
const SERIAL_VERDICT: FanoutVerdict = 'serial'

// One unit is nothing to parallelize; the fan-out only pays off from two independent units up.
const MIN_UNITS_TO_PARALLELIZE = 2

// A file carried by this many units or more is shared, so the units cannot run in parallel.
const SHARED_THRESHOLD = 2

interface FanoutUnit {
	// The files this one unit edits, already split from the argument and trimmed.
	files: ReadonlyArray<string>
}

interface FanoutResult {
	verdict: FanoutVerdict
	// The reason, for a person; the verdict alone is what a shell reads.
	reason: string
	// The files that appear in more than one unit — empty on a `parallel` verdict.
	overlaps: ReadonlyArray<string>
}

// The distinct files one unit edits. De-duplicated, so a file listed twice inside one unit is not
// counted as an overlap with anyone else.
function unit_files(unit: FanoutUnit): Array<string> {
	return [...new Set(unit.files)]
}

// How many units carry each file, across all units.
function file_counts(units: ReadonlyArray<FanoutUnit>): Map<string, number> {
	const counts = new Map<string, number>()
	const files = units.flatMap((unit) => unit_files(unit))

	for (const file of files) {
		counts.set(file, (counts.get(file) ?? 0) + 1)
	}

	return counts
}

// The files carried by two or more units, sorted.
function overlapping_files(units: ReadonlyArray<FanoutUnit>): Array<string> {
	return [...file_counts(units)]
		.filter(([, count]) => count >= SHARED_THRESHOLD)
		.map(([file]) => file)
		.toSorted((left, right) => left.localeCompare(right))
}

// The verdict for a set of proposed units. Serial below two units, serial on any shared file naming
// what collides, parallel only when every unit's file set is disjoint from every other's.
function fanout_result(units: ReadonlyArray<FanoutUnit>): FanoutResult {
	if (units.length < MIN_UNITS_TO_PARALLELIZE) {
		return {
			verdict: SERIAL_VERDICT,
			reason: 'fewer than two units — nothing to run in parallel',
			overlaps: [],
		}
	}

	const overlaps = overlapping_files(units)

	if (overlaps.length > 0) {
		const reason = `units share ${overlaps.join(', ')} — parallel edits would race, so run serial`

		return { verdict: SERIAL_VERDICT, reason, overlaps }
	}

	return {
		verdict: PARALLEL_VERDICT,
		reason: `${String(units.length)} file-disjoint units`,
		overlaps: [],
	}
}

const fanout = {
	PARALLEL_VERDICT,
	SERIAL_VERDICT,
	MIN_UNITS_TO_PARALLELIZE,
	overlapping_files,
	fanout_result,
}

export type { FanoutResult, FanoutUnit, FanoutVerdict }
export { fanout }
