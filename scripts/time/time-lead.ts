import { time_overlap, type Interval } from './time-overlap'
import { time_phases, type PhaseName } from './time-phases'
import { time_segments } from './time-segments'
import type { Span } from './time-spans'

// What a window was spent behind: the phase that overlapped it longest and the busiest command inside
// it (joshuafolkken/kit#1881).
//
// **This is `time-cycles.ts`'s `weighted` and its lead, single-sourced.** The CI-cycle block already
// weighs each covering span by how much of a cycle it overlapped and names the heaviest; the
// delegated-wait block asks the same question of a delegation window. Two copies of that walk are two
// places one of them comes to weigh by the span's own length rather than by the overlap — the error
// `time-overlap.ts` exists to prevent — so it lives here once and both callers read it.

const NO_DURATION = 0
// A phase or a label nothing was found for. Model and human spans carry no label, so a window
// overlapped by thinking alone is named by its phase rather than by a blank row.
const { NO_LEAD, heaviest } = time_segments

// One span positioned on the clock, with the phase it was classified into. The phase comes from
// `time_phases.classify`, so which spans count as which phase is decided in one place rather than
// restated per caller.
interface Cover {
	interval: Interval
	phase: PhaseName
	label: string
}

// The phase a window ran behind and the command inside it, both `NO_LEAD` where nothing overlapped.
interface Lead {
	phase: string
	label: string
}

// How long each key overlapped the window. Keyed by whatever `key_of` reads, so the phase and the
// label are the same walk asked twice rather than two walks that could disagree about which spans
// overlapped at all.
//
// **Weighted by the overlap rather than by the span's own length**: a span is named here only for the
// part of it that ran while the window did.
function weighted(
	window: Interval,
	covers: ReadonlyArray<Cover>,
	key_of: (cover: Cover) => string,
): Map<string, number> {
	const totals = new Map<string, number>()

	for (const cover of covers) {
		const shared = time_overlap.shared_ms(window, cover.interval)
		const key = key_of(cover)

		if (key !== NO_LEAD && shared > NO_DURATION) {
			totals.set(key, (totals.get(key) ?? NO_DURATION) + shared)
		}
	}

	return totals
}

function lead(window: Interval, covers: ReadonlyArray<Cover>): Lead {
	return {
		phase: heaviest(
			weighted(window, covers, (cover) => cover.phase),
			NO_LEAD,
		),
		label: heaviest(
			weighted(window, covers, (cover) => cover.label),
			NO_LEAD,
		),
	}
}

// Covers built from spans, each classified into its phase so a caller with spans in hand need not
// restate the interval/phase/label triple. `should_exclude` drops the spans a caller counts as the
// wait itself rather than as something the window hid behind — the merge command for a CI cycle, the
// launch bracket for a delegation.
function covers_of(
	spans: ReadonlyArray<Span>,
	should_exclude: (cover: Cover) => boolean,
): Array<Cover> {
	const phases = time_phases.classify(spans)

	return spans
		.map((span, index) => ({
			interval: time_overlap.to_interval(span),
			phase: phases[index] ?? time_phases.OTHER_PHASE,
			label: span.label,
		}))
		.filter((cover) => !should_exclude(cover))
}

const time_lead = {
	NO_LEAD,
	weighted,
	lead,
	covers_of,
}

export type { Cover, Lead }
export { time_lead }
