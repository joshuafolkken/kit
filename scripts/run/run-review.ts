// The pure decisions `josh run:review` makes, kept apart from the side effects the same way
// `run-merge.ts` is kept apart from `run-merge-steps.ts` (joshuafolkken/kit#2179).
//
// `run:review` starts the gate in the background and prints the `/code-review` brief in one call, so a
// lane child launches both from a single command and the two overlap rather than running one after the
// other. Two facts have to be decided from what the stamps say, and both are decided here so a test can
// pin them without a gate ever running:
//
// - **whether the review verdict may be adopted** — only over a green gate. Before this command the
//   ordering guaranteed it: the child read the gate, saw green, and only then launched the review, so
//   there was no path to adopting a review over a red gate. Started together, that guarantee is no
//   longer a side effect of the order and has to be a decision (`adopt_verdict`).
// - **how far the gate and the review overlapped** — the measurement the parallel start exists to
//   produce, computed from the four timestamps `run-review-steps.ts` records.

const ADOPT = 'adopt'
const BLOCKED = 'blocked'

type AdoptVerdict = typeof ADOPT | typeof BLOCKED

// A red gate blocks the review verdict outright, whatever the review concluded — the same rule the
// serial order used to enforce implicitly (joshuafolkken/kit#1242's gate-beside-review is only safe
// while a red gate can still stop the commit). `--join` exits non-zero on `blocked`, so the guard is
// the command's exit code rather than a sentence a child has to read and obey.
function adopt_verdict(is_gate_green: boolean): AdoptVerdict {
	return is_gate_green ? ADOPT : BLOCKED
}

const GATE_GREEN = 'green'
const GATE_RUNNING = 'running'
const GATE_RED = 'red'

type GateState = typeof GATE_GREEN | typeof GATE_RUNNING | typeof GATE_RED

// The three states the join waits on, decided from two readings the steps take of the stamps a real
// `josh gate` writes: a green stamp covering this tree, and the in-flight marker's writer still alive.
// Green wins over running, because a gate that has already recorded green is done however the marker
// reads; a marker whose writer is gone with no green stamp is a gate that finished red or died, which
// is the safe direction — the join reports red and the verdict is blocked.
function gate_state(is_green: boolean, is_running: boolean): GateState {
	if (is_green) return GATE_GREEN
	if (is_running) return GATE_RUNNING

	return GATE_RED
}

function is_gate_settled(state: GateState): boolean {
	return state !== GATE_RUNNING
}

const MS_PER_SECOND = 1000
const SECONDS_DECIMALS = 1
const NO_OVERLAP = 0

interface TimingStart {
	gate_started_at: string
	review_started_at: string
}

interface ReviewTiming extends TimingStart {
	gate_ended_at: string
	review_ended_at: string
}

function format_seconds(seconds: number): string {
	return `${seconds.toFixed(SECONDS_DECIMALS)}s`
}

// Clamped at zero, because a span is a duration and cannot run backwards. The one way `to` precedes
// `from` is a green gate stamp left by an earlier run on an identical tree, whose `taken_at` predates
// this run's start — a display artifact that never touches the adopt/block decision, which keys off the
// gate state and not this timestamp.
function span_seconds(from: string, to: string): number {
	return Math.max(NO_OVERLAP, (Date.parse(to) - Date.parse(from)) / MS_PER_SECOND)
}

// The wall-clock the gate and the review were both running: from the later of the two starts to the
// earlier of the two ends. Clamped at zero so two windows that never met read as no overlap rather
// than as a negative span, which is the answer for a serial run and the one this command exists to
// move off zero.
function overlap_seconds(timing: ReviewTiming): number {
	const start = Math.max(Date.parse(timing.gate_started_at), Date.parse(timing.review_started_at))
	const end = Math.min(Date.parse(timing.gate_ended_at), Date.parse(timing.review_ended_at))

	return Math.max(NO_OVERLAP, (end - start) / MS_PER_SECOND)
}

// The three lines a `--join` prints so a reader — issue #2179 and `chain-rule.md`'s overlap check —
// can see the gate ran inside the review rather than in front of it.
function format_timing(timing: ReviewTiming): string {
	const gate = span_seconds(timing.gate_started_at, timing.gate_ended_at)
	const review = span_seconds(timing.review_started_at, timing.review_ended_at)

	return [
		`gate:    ${timing.gate_started_at} → ${timing.gate_ended_at} (${format_seconds(gate)})`,
		`review:  ${timing.review_started_at} → ${timing.review_ended_at} (${format_seconds(review)})`,
		`overlap: ${format_seconds(overlap_seconds(timing))}`,
	].join('\n')
}

const run_review = {
	ADOPT,
	BLOCKED,
	GATE_GREEN,
	GATE_RED,
	GATE_RUNNING,
	adopt_verdict,
	format_seconds,
	format_timing,
	gate_state,
	is_gate_settled,
	overlap_seconds,
	span_seconds,
}

export type { AdoptVerdict, GateState, ReviewTiming, TimingStart }
// The state constants are exported by name as well as on the namespace: read back off the namespace
// object their literal types widen to `string`, so a test passing `run_review.GATE_RED` to a
// `GateState` parameter would not type-check — the same reason `run-liveness.ts` exports its verdicts
// by name.
export { GATE_GREEN, GATE_RED, GATE_RUNNING, run_review }
