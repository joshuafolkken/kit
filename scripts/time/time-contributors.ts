import { time_distribution, type LabeledDistribution } from './time-distribution'
import { time_format } from './time-format'
import { time_parent_turns, type ParentTurnTotals } from './time-parent-turns'

// What a *set* of runs spent its turns on, rather than what one run did (joshuafolkken/kit#1763).
//
// `time-parent-turns.ts` splits one report's turns into eight contributors, and every scope prints
// that block — but nothing aggregated it, so a trend across runs could only be had by parsing
// `--json` by hand. The 2026-09-11 reading did exactly that over nineteen runs, and the table it
// produced is not comparable with the next hand count: the two took different denominators and
// neither said which. That is the defect joshuafolkken/kit#1729 named for depth shares, in the one
// block whose figures the cost question actually turns on.
//
// **One module for both scopes, because the acceptance condition is that they agree.** `--last`
// samples each run's `parent_turns`; `--period` samples the same breakdown written into
// `.time-history.jsonl`. The aggregation and the row layout live here once, so the two readings
// cannot come to answer the same question in different words — the clone `CLAUDE.md` prohibits, in
// the one place where a drift would make two scopes of one command disagree.
//
// **The rows are counts, and they are taken through `time-distribution.ts` all the same.** Its
// fields are named `_ms` because every earlier caller passed milliseconds; the summary itself is
// arithmetic over numbers, and a second percentile helper beside this one caller is exactly what
// that module's own comment refuses. What differs is only the rendering: a turn count goes through
// `format_columns`, never `format_row`, which would print it as minutes.
//
// **A run nobody read is excluded from the denominator, never counted as a zero.** `is_measured` is
// already the distinction one run's block withholds its own rows on — a transcript that was never
// read and a run that made no turn of that kind are different answers — so the filter here is that
// same flag rather than a second test.

const HEADING = 'Turns by contributor (median, then min – max):'

// Only the runs whose transcript was actually read. Taken before any row is built, so every row of
// one report shares one denominator — the property a hand count cannot promise.
function measured_totals(
	totals: ReadonlyArray<ParentTurnTotals>,
): Array<Readonly<ParentTurnTotals>> {
	return totals.filter((entry) => entry.is_measured)
}

// A measured run that issued no turn of this kind contributes a real zero, which is why the filter
// above is on the run and not on the count: the contributor's absence from that run is a reading.
function samples_of(
	totals: ReadonlyArray<Readonly<ParentTurnTotals>>,
	name: string,
): Array<number> {
	return totals.map((entry) => time_parent_turns.count_for(entry, name))
}

// In the precedence order the eight are defined in, exactly as one run's block prints them and for
// the reason the phase table keeps run order: a reader comparing this against `--issue` should find
// the same rows in the same places.
function contributor_rows(totals: ReadonlyArray<ParentTurnTotals>): Array<LabeledDistribution> {
	const measured = measured_totals(totals)

	return time_parent_turns.CONTRIBUTOR_NAMES.map((name) =>
		time_distribution.labeled(name, samples_of(measured, name)),
	)
}

// **The median in the numeric column and the range beside it**, the shape every other aggregated
// table in this command already takes — the suffix itself is `time-format.ts`'s, so the two cannot
// come to punctuate a spread differently.
function contributor_row(row: LabeledDistribution): string {
	const { label, distribution } = row

	if (!time_distribution.is_measured(distribution)) return time_format.unmeasured_row(label)

	// `String` rather than a minutes formatter: these are turn counts, and the only fractional value
	// they take is the half an even-sized sample's median lands on.
	const spread = time_format.format_spread(
		String(distribution.min_ms),
		String(distribution.max_ms),
		distribution.sample_count,
	)

	return time_format.format_columns(label, String(distribution.median_ms), spread)
}

// Uncapped, for the reason the category and phase tables are: the row count is bounded by the eight
// names rather than by the length of a run, so a display cap could only ever drop a contributor.
function contributor_lines(rows: ReadonlyArray<LabeledDistribution>): Array<string> {
	return ['', HEADING, ...rows.map((row) => contributor_row(row))]
}

const time_contributors = {
	HEADING,
	contributor_rows,
	contributor_lines,
}

export { time_contributors }
