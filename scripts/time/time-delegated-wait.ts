import { time_format } from './time-format'
import { time_lead, type Cover } from './time-lead'
import { time_overlap, type Interval } from './time-overlap'
import type { Span } from './time-spans'

// The idle the main line spent waiting on a delegated unit, broken out of model wait
// (joshuafolkken/kit#1881).
//
// **`resolve_delegated` folds this into model wait, and that is the reading it hides.** A parent that
// delegates holds one `Agent`/`Task` span across the whole time the unit runs; `time-overlap.ts`
// replaces that span's covered middle with the unit's own model/tool/human spans, so the wait is
// re-labelled as the unit's model time and disappears into the `categories` model share. One figure
// cannot then say a run sat idle waiting for a unit it could have parallelized.
//
// **It is captured beside `resolve_delegated`, not after it.** Once the substitution runs the origin
// is gone — a unit span is indistinguishable from a parent one, and a fully covered launch leaves no
// trace at all — so the delegation windows are read from the raw parent and delegated spans at the
// same call site, before the fold erases them (`time-corpus.ts`, `time-family.ts`).
//
// **Naked is "the main line ran nothing beside it, and only one unit was in flight".** That is the
// serial wait a second lane would remove. Its counterpart is named the way the CI-cycle block names a
// cycle's: `behind <phase>` for concurrent main-line work, and `parallel` for the wall clock two or
// more units ran at once — a fan-out, which was never a serial wait and so is not naked.

const NO_DURATION = 0
// A depth of two open delegations is the least that counts as a parallel launch; one is the serial
// case this block is measuring.
const MIN_PARALLEL_DEPTH = 2
const HEADING = 'Delegated waits (in run order):'
const WAIT_LABEL = 'Delegated waits'
const NO_WAIT = 'no delegated unit ran on this run'
const BEHIND_PREFIX = 'behind '
const PARALLEL_PREFIX = 'parallel '
const { NO_LEAD } = time_lead

// One delegation window, and what the main line was doing while it waited.
interface DelegatedWait {
	started_ms: number
	ended_ms: number
	duration_ms: number
	// The part the main line spent with nothing else running and only one unit in flight — the serial
	// wait a second lane would remove. Zero is a measurement, not a withheld answer: the window was
	// fully overlapped by main-line work or by a parallel launch.
	naked_ms: number
	// What the rest of the window ran behind: the main-line phase that overlapped it longest, and the
	// busiest command inside it. Both `NO_LEAD` where the main line did nothing beside the wait.
	lead_phase: string
	lead_label: string
	// The wall clock two or more units ran at once. Excluded from `naked_ms` because a fan-out is not a
	// serial wait — it is the shape this reading exists to distinguish from one.
	parallel_ms: number
}

// The waits, in the three states a read of them has, mirroring `CycleTotals`.
interface DelegatedWaitTotals {
	waits: Array<DelegatedWait>
	// Whether the delegated transcripts were read. `false` prints `not measured` rather than a zero: a
	// unit whose transcript could not be read has an unknown window, not an empty one — which is the
	// distinction the acceptance criterion asks for.
	is_measured: boolean
	// Whether the run delegated at all. `false` withholds the whole block, the way a session scope
	// withholds the CI cycles — a run with no subagents has nothing to say here.
	has_delegation: boolean
}

const NO_WAITS: DelegatedWaitTotals = { waits: [], is_measured: false, has_delegation: false }

// One end of a delegated span, for the depth sweep below.
interface DepthEvent {
	at: number
	delta: number
}

function to_intervals(spans: ReadonlyArray<Span>): Array<Interval> {
	return spans.map((span) => time_overlap.to_interval(span))
}

function depth_events(intervals: ReadonlyArray<Interval>): Array<DepthEvent> {
	const events = intervals.flatMap((one) => [
		{ at: one.started_ms, delta: 1 },
		{ at: one.ended_ms, delta: -1 },
	])

	// An end is processed before a start at the same instant, so `[0,5]` and `[5,10]` touch without
	// counting as an overlap.
	return events.toSorted((left, right) => left.at - right.at || left.delta - right.delta)
}

// The regions two or more of `intervals` cover at once, merged into a disjoint set. A fan-out is the
// only shape that produces one, so this is empty for the sequential delegation `epicrun` and `queue`
// run — the identity the whole block keeps for a run that never parallelized.
function parallel_intervals(intervals: ReadonlyArray<Interval>): Array<Interval> {
	const parts: Array<Interval> = []
	let depth = 0
	let previous = 0

	for (const event of depth_events(intervals)) {
		if (depth >= MIN_PARALLEL_DEPTH && event.at > previous) {
			parts.push({ started_ms: previous, ended_ms: event.at })
		}

		previous = event.at
		depth += event.delta
	}

	return time_overlap.union_intervals(parts)
}

function has_length(window: Interval): boolean {
	return window.ended_ms > window.started_ms
}

// The main line's own spans, minus the launch brackets. A parent `Agent`/`Task` span that encloses a
// delegation window *is* the wait, so it is dropped the way the merge command is for a CI cycle;
// everything else the main line did beside the wait stays, to be named as what a window ran behind.
function covers_of(parent: ReadonlyArray<Span>, windows: ReadonlyArray<Interval>): Array<Cover> {
	return time_lead.covers_of(parent, (cover) =>
		windows.some((window) => time_overlap.encloses(cover.interval, window)),
	)
}

function shared_total(window: Interval, intervals: ReadonlyArray<Interval>): number {
	return intervals.reduce((sum, one) => sum + time_overlap.shared_ms(window, one), NO_DURATION)
}

function to_wait(
	window: Interval,
	covers: ReadonlyArray<Cover>,
	parallel: ReadonlyArray<Interval>,
): DelegatedWait {
	const cover_intervals = covers.map((cover) => cover.interval)
	const lead = time_lead.lead(window, covers)

	return {
		started_ms: window.started_ms,
		ended_ms: window.ended_ms,
		duration_ms: window.ended_ms - window.started_ms,
		naked_ms: time_overlap.uncovered_ms(window, [...cover_intervals, ...parallel]),
		lead_phase: lead.phase,
		lead_label: lead.label,
		parallel_ms: shared_total(window, parallel),
	}
}

// The delegation windows of one session, each split into serial wait, concurrent main-line work, and
// parallel launch. Empty when the session delegated nothing — the identity `build_cycles` has for a
// run with no pull request, and the reason a run that never delegated reports exactly as it did.
function waits_of(
	parent: ReadonlyArray<Span>,
	delegated: ReadonlyArray<Span>,
): Array<DelegatedWait> {
	const intervals = to_intervals(delegated)
	const windows = time_overlap.union_intervals(intervals).filter((one) => has_length(one))

	if (windows.length === 0) return []

	const parallel = parallel_intervals(intervals)
	const covers = covers_of(parent, windows)

	return windows.map((window) => to_wait(window, covers, parallel))
}

function build_totals(
	waits: ReadonlyArray<DelegatedWait>,
	is_measured: boolean,
	has_delegation: boolean,
): DelegatedWaitTotals {
	return { waits: [...waits], is_measured, has_delegation }
}

// Named only where something really overlapped, the way the CI-cycle note is.
function behind_note(wait: DelegatedWait): Array<string> {
	if (wait.lead_phase === NO_LEAD) return []

	const label = wait.lead_label === NO_LEAD ? [] : [wait.lead_label]

	return [[`${BEHIND_PREFIX}${wait.lead_phase}`, ...label].join(time_format.SUFFIX_SEPARATOR)]
}

function parallel_note(wait: DelegatedWait): Array<string> {
	if (wait.parallel_ms <= NO_DURATION) return []

	return [`${PARALLEL_PREFIX}${time_format.format_seconds(wait.parallel_ms)}`]
}

function wait_suffix(wait: DelegatedWait): string {
	const naked = `${time_format.NAKED_PREFIX}${time_format.format_seconds(wait.naked_ms)}`

	return [naked, ...behind_note(wait), ...parallel_note(wait)].join(time_format.SUFFIX_SEPARATOR)
}

function wait_row(wait: DelegatedWait): string {
	return time_format.format_row(
		time_format.format_window(wait.started_ms, wait.ended_ms),
		wait.duration_ms,
		wait_suffix(wait),
	)
}

function wait_lines(totals: DelegatedWaitTotals): Array<string> {
	if (!totals.has_delegation) return []
	if (!totals.is_measured) return ['', HEADING, time_format.unmeasured_row(WAIT_LABEL)]
	if (totals.waits.length === 0) return ['', HEADING, `  ${NO_WAIT}`]

	return ['', HEADING, ...totals.waits.map((wait) => wait_row(wait))]
}

const time_delegated_wait = {
	HEADING,
	WAIT_LABEL,
	NO_WAIT,
	NO_WAITS,
	waits_of,
	build_totals,
	wait_lines,
}

export type { DelegatedWait, DelegatedWaitTotals }
export { time_delegated_wait }
