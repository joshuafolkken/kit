// The pure streak arithmetic behind `run-carry.ts` → `apply_change`, relocated here so the record's
// file stays under its line bound and the outage fold has a test of its own (joshuafolkken/kit#2317).
// It owns the two consecutive-streak counters — the failure streak and the API-outage streak — and the
// one timestamp the outage fold reads. Nothing here touches disk: it is arithmetic over the values a
// change carries and the counters already on the record.
//
// The input types are named narrowly rather than imported from `run-carry.ts`, so this module does not
// import back from the file that imports it. `RunCarry` and `CarryChange` are structurally compatible
// with them, so the caller passes them through unchanged.

const NO_INCREMENT = 0

// Two minutes. **A single network drop reaches every in-flight lane child at once**, and the parent
// books each returning child's outage within a burst of merge events seconds to tens of seconds apart;
// two minutes covers that burst with room to spare. **A genuinely dead API is different**: an outage
// child is re-dispatched and spends its ten connection retries before the next child returns, so two
// consecutive *real* outages land minutes apart — outside this window — and still accumulate toward the
// environment guard. Measured on 2026-09-22 (joshuafolkken/kit#2317): one network event booked four
// outages within seconds, tripping the limit of three in a single stroke though the API was alive.
const OUTAGE_FOLD_WINDOW_MS = 120_000

interface StreakCarry {
	failures: number
	outages: number
	last_outage_at?: string | undefined
}

interface StreakChange {
	merged?: number
	failures?: number
	outages?: number
}

interface StreakState {
	failures: number
	outages: number
	last_outage_at: string | undefined
}

interface OutageState {
	outages: number
	last_outage_at: string | undefined
}

function has_increment(value: number | undefined): boolean {
	return (value ?? NO_INCREMENT) > NO_INCREMENT
}

// **A merge resets the streak; every other change adds to it.** The consecutive-failure guard trips on
// children failing one after another, so a child that merged in between is what breaks the run — the
// reset lives with the increment rather than in a caller that could forget it (joshuafolkken/kit#2024).
function next_failures(carry: StreakCarry, change: StreakChange): number {
	if (has_increment(change.merged)) return NO_INCREMENT

	return carry.failures + (change.failures ?? NO_INCREMENT)
}

// Whether this outage lands inside the fold window of the last counted one, so it is the same network
// event rather than a fresh one. An absent or unparsable timestamp is read as "no recent outage", so
// the outage counts rather than folding into a window that cannot be measured.
function is_within_fold_window(last_outage_at: string | undefined, now: Date): boolean {
	if (last_outage_at === undefined) return false

	const last = Date.parse(last_outage_at)

	if (Number.isNaN(last)) return false

	return now.getTime() - last <= OUTAGE_FOLD_WINDOW_MS
}

// A folded outage leaves the streak and its timestamp where they stood — the window is **not** slid
// forward, so a run of genuinely continuous outages cannot fold forever: only outages inside the first
// one's window fold, and the next one outside it counts.
function folded_outage(carry: StreakCarry): OutageState {
	return { outages: carry.outages, last_outage_at: carry.last_outage_at }
}

function counted_outage(carry: StreakCarry, change: StreakChange, now: Date): OutageState {
	const outages = carry.outages + (change.outages ?? NO_INCREMENT)

	return { outages, last_outage_at: now.toISOString() }
}

// **An outage adds to the streak unless it folds; a merge or a genuine child failure resets it**
// (joshuafolkken/kit#2240, fold added by joshuafolkken/kit#2317). Anything that proves the API *was*
// reachable — a merge, or a child that failed on its own after reaching it — breaks the run and clears
// the fold timestamp. A change that touches none of the three leaves the streak untouched.
function next_outage(carry: StreakCarry, change: StreakChange, now: Date): OutageState {
	if (has_increment(change.outages)) {
		return is_within_fold_window(carry.last_outage_at, now)
			? folded_outage(carry)
			: counted_outage(carry, change, now)
	}

	const is_reachable = has_increment(change.merged) || has_increment(change.failures)

	return is_reachable ? { outages: NO_INCREMENT, last_outage_at: undefined } : folded_outage(carry)
}

function next_state(carry: StreakCarry, change: StreakChange, now: Date): StreakState {
	const outage = next_outage(carry, change, now)

	return {
		failures: next_failures(carry, change),
		outages: outage.outages,
		last_outage_at: outage.last_outage_at,
	}
}

const run_carry_streak = { OUTAGE_FOLD_WINDOW_MS, next_state }

export type { StreakCarry, StreakChange, StreakState }
export { run_carry_streak }
