import type { CiFacts } from './time-ci'
import { time_format } from './time-format'
import { time_overlap, type Interval } from './time-overlap'
import { time_phases, type PhaseName } from './time-phases'
import { time_segments } from './time-segments'
import { time_spans, type Span } from './time-spans'

// Whether each CI cycle was hidden behind other work or ran naked (joshuafolkken/kit#1465).
//
// **The `ci` phase folds every cycle into one number, and two cycles of the same length can cost
// opposite amounts.** Measured on run #1441: cycle one ran 00:37:09 → 00:38:58 entirely behind the
// second review round and took **0 seconds** off the wall clock, while cycle two ran 00:44:43 →
// 00:46:26 with nothing else running and took **103**. One figure cannot say that, so the round-2
// disposition row read the serial stretch at 55% of what it was.
//
// **Naked is "covered by nothing but the merge command", not "covered by nothing".** That is the
// correction this module makes to `serial_ci_ms`, which is the part of a cycle the merge spans cover
// *and nothing else does*. A cycle the merge command was not yet sitting on — `followup` had not been
// issued, or was between attempts — is covered by no span at all, so it falls out of `serial_ci_ms`
// into the `ci` category share and disappears from the phase reading. It still went on the wall
// clock, which is the one question this block answers, so it is counted here.
//
// **Every span but the merge command's hides a cycle, human wait included, and that is deliberate.**
// The question is not whether the run was doing something useful but whether the cycle *added* to the
// elapsed time, and a cycle that ran while the session sat waiting for a person added nothing — the
// wall clock was already being spent. Counting idle time as naked would report those seconds as
// recoverable by cutting CI, which they are not.
//
// **The cycles are merged into a disjoint set before they are counted.** Two commits whose check windows overlap would
// otherwise have the shared minutes priced once per cycle, which is the arithmetic error
// `time-overlap.ts` exists to prevent. Their naked seconds then sum to a figure that double counts
// nothing, and `MAX_COMMITS` bounds the row count below the table cap without one being applied.

const NO_DURATION = 0
const HEADING = 'CI cycles (in run order):'
const CYCLE_LABEL = 'CI cycles'
const NO_CYCLE = 'no CI cycle ran on this pull request'
const BEHIND_PREFIX = 'behind '
// A phase or a label nothing was found for. Model and human spans carry no label at all, so a cycle
// hidden behind thinking alone is named by its phase rather than by a blank row — the rule
// `time-segments.ts` states, read from there rather than copied.
const { NO_LEAD, heaviest } = time_segments

// One CI cycle, and what it actually cost.
interface CiCycle {
	started_ms: number
	ended_ms: number
	duration_ms: number
	// The part of the cycle nothing but the merge command overlapped — what the run really waited.
	// Zero is a measurement here rather than a withheld answer: it says the cycle ran wholly behind
	// something else.
	naked_ms: number
	// What the hidden part ran behind: the phase that overlapped the cycle longest, and the busiest
	// command inside it. Both `NO_LEAD` where nothing overlapped, which is the naked case.
	lead_phase: string
	lead_label: string
}

// The cycles, in the three states a read of them has.
interface CycleTotals {
	cycles: Array<CiCycle>
	// Whether the check-runs behind the cycles were read **and** there was a transcript to weigh them
	// against. `false` is "could not measure", printed as `not measured` rather than as a pull request
	// that ran no checks.
	//
	// **Both halves have to be present, and the transcript one is the trap.** Naked seconds are the
	// part of a cycle nothing covers, so a scope whose transcript was not found has *no* covering span
	// and every cycle comes back naked in full — the largest possible answer, stated with the same
	// confidence as a measured one. Measured against `--last 20` from a linked work tree, where the
	// transcripts sit under the main checkout's project directory, all twenty runs read that way.
	is_measured: boolean
	// Whether there is a pull request at all. A session scope has none, so the whole block is withheld
	// rather than printed empty — an absent section asserts nothing, and an empty one asserts a
	// measurement nobody made.
	has_pull: boolean
}

const NO_CYCLES: CycleTotals = { cycles: [], is_measured: false, has_pull: false }
const UNREAD_CYCLES: CycleTotals = { cycles: [], is_measured: false, has_pull: true }

// One span positioned on the clock, with the phase it was classified into. The phase comes from
// `time_phases.classify`, so which spans count as the merge command is decided in one place rather
// than restated here — two rules for that is where the naked seconds and the `ci` phase come to
// disagree about the same cycle.
interface Cover {
	interval: Interval
	phase: PhaseName
	label: string
}

// Every span except the merge command's: `followup` waiting on the checks is not something a cycle
// hid behind, it *is* the wait. Everything else counts, human wait included — see the header.
function covers_of(spans: ReadonlyArray<Span>): Array<Cover> {
	const phases = time_phases.classify(spans)

	return spans
		.map((span, index) => ({
			interval: time_overlap.to_interval(span),
			phase: phases[index] ?? time_phases.OTHER_PHASE,
			label: span.label,
		}))
		.filter((cover) => cover.phase !== time_phases.MERGE_PHASE)
}

// How long each key overlapped the cycle. Keyed by whatever `key_of` reads, so the phase and the
// label are the same walk asked twice rather than two walks that could come to disagree about which
// spans overlapped at all.
//
// **Weighted by the overlap rather than by the span's own length**, which is what separates this from
// the segment table's lead: a span is named here only for the part of it that ran while the cycle
// did.
function weighted(
	cycle: Interval,
	covers: ReadonlyArray<Cover>,
	key_of: (cover: Cover) => string,
): Map<string, number> {
	const totals = new Map<string, number>()

	for (const cover of covers) {
		const shared = time_overlap.shared_ms(cycle, cover.interval)
		const key = key_of(cover)

		if (key !== NO_LEAD && shared > NO_DURATION) {
			totals.set(key, (totals.get(key) ?? NO_DURATION) + shared)
		}
	}

	return totals
}

function to_cycle(window: Interval, covers: ReadonlyArray<Cover>): CiCycle {
	const rest = covers.map((cover) => cover.interval)

	return {
		started_ms: window.started_ms,
		ended_ms: window.ended_ms,
		duration_ms: window.ended_ms - window.started_ms,
		naked_ms: time_overlap.uncovered_ms(window, rest),
		lead_phase: heaviest(
			weighted(window, covers, (cover) => cover.phase),
			NO_LEAD,
		),
		lead_label: heaviest(
			weighted(window, covers, (cover) => cover.label),
			NO_LEAD,
		),
	}
}

// The cycles of one report. Never throws: a scope with no pull request and a pull request whose
// check-runs could not be read each come back as their own withheld answer.
function build_cycles(spans: ReadonlyArray<Span>, ci: CiFacts): CycleTotals {
	if (!ci.has_ci_data) return NO_CYCLES
	if (!ci.has_windows || !time_spans.has_transcript_data(spans.length)) return UNREAD_CYCLES

	const covers = covers_of(spans)

	return {
		cycles: time_overlap.union_intervals(ci.windows).map((window) => to_cycle(window, covers)),
		is_measured: true,
		has_pull: true,
	}
}

// Named only where something really overlapped. A cycle whose naked seconds are its whole length was
// hidden behind nothing, and a `behind` clause there would name the phase of a span that merely sat
// nearby.
function behind_note(cycle: CiCycle): Array<string> {
	if (cycle.naked_ms >= cycle.duration_ms || cycle.lead_phase === NO_LEAD) return []

	const lead = cycle.lead_label === NO_LEAD ? [] : [cycle.lead_label]

	return [[`${BEHIND_PREFIX}${cycle.lead_phase}`, ...lead].join(time_format.SUFFIX_SEPARATOR)]
}

function cycle_suffix(cycle: CiCycle): string {
	const naked = `${time_format.NAKED_PREFIX}${time_format.format_seconds(cycle.naked_ms)}`

	return [naked, ...behind_note(cycle)].join(time_format.SUFFIX_SEPARATOR)
}

function cycle_row(cycle: CiCycle): string {
	return time_format.format_row(
		time_format.format_window(cycle.started_ms, cycle.ended_ms),
		cycle.duration_ms,
		cycle_suffix(cycle),
	)
}

function cycle_lines(totals: CycleTotals): Array<string> {
	if (!totals.has_pull) return []
	if (!totals.is_measured) return ['', HEADING, time_format.unmeasured_row(CYCLE_LABEL)]
	if (totals.cycles.length === 0) return ['', HEADING, `  ${NO_CYCLE}`]

	return ['', HEADING, ...totals.cycles.map((cycle) => cycle_row(cycle))]
}

const time_cycles = {
	HEADING,
	CYCLE_LABEL,
	NO_CYCLE,
	NO_CYCLES,
	build_cycles,
	cycle_lines,
}

export type { CiCycle, CycleTotals }
export { time_cycles }
