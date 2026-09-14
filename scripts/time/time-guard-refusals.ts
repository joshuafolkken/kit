import { time_call_identity } from '#scripts/time-runtime/time-call-identity'
import { time_format } from '#scripts/time-runtime/time-format'
import { time_round_trips } from '#scripts/time-runtime/time-round-trips'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'
import {
	time_region_costs,
	type Bucket,
	type LabeledRegion,
	type PricedRequest,
} from './time-region-costs'

// Which guard refused how often, what re-issuing cost, and how many of those refusals the run
// answered by re-issuing the very same call (joshuafolkken/kit#1913).
//
// **`Failure re-runs:` counted the wrong thing for this question, and `Investigation reads:` guessed
// it.** The failure block counts a call whose `is_error` came back true — a guard refusal is one, but
// so is a red gate, and it cannot say which guard spoke or how much re-issuing cost. The investigation
// block's `refused` class is a *replay* of what the guard would have done, not the refusals the
// transcript actually carried. So a run where two pre-gate-cut refusals were false positives — the
// cut that stopped the session — could not be ranked against the rest of the run's waste, which is
// the reading joshuafolkken/kit#1913 was filed to add.
//
// **A refusal is read off the span, never re-scanned here.** `time-transcript-line.ts` identifies the
// guard from the `⛔` opening of an errored result and carries the label onto the span as
// `refusal_guard`; this block groups by it. The one place a refusal is detected is that parse, so a
// walk here that re-matched the body would be the clone `CLAUDE.md` prohibits.
//
// **The cost is the composing model turn, priced through `time-region-costs.ts`.** The wasted wall
// clock of a refused call is the model wait that produced it plus the call itself, so the region opens
// at the preceding model span — the composing billed request sits on that instant, which is what lets
// the shared `tally` price it into the guard's bucket rather than a second copy of that arithmetic.

const HEADING = 'Guard refusals:'
const NONE = 0
const REFUSAL_NOTE = 'refusal(s)'
const SAME_ARGS_NOTE = 're-issued same args'
const COST_UNMEASURED = 'cost not measured'

// One guard's tally: how often it refused, the wall clock and dollars that re-issuing cost, and how
// many of its refusals the run answered with the identical call — the false-positive hint.
interface GuardRefusalRow {
	guard: string
	refusal_count: number
	reissue_ms: number
	same_args_reissue_count: number
	request_count: number
	cost_usd: number
}

// **`is_measured` is the transcript, `is_cost_measured` is the corpus, and they are two answers.** A
// batch scope reads spans but no cost corpus, so it can count refusals and not price them; a scope
// with no transcript at all can do neither. Folding the two would report an unpriced refusal as a free
// one, the distinction `time-region-costs.ts` draws for every cost block.
interface GuardRefusalFacts {
	by_guard: ReadonlyArray<GuardRefusalRow>
	refusal_count: number
	reissue_ms: number
	cost_usd: number
	is_measured: boolean
	is_cost_measured: boolean
}

// Spans and the priced requests to place against the refused regions. `requests: undefined` means the
// cost corpus was not read — the batch scopes never do — kept apart from an empty read of it.
interface GuardRefusalInput {
	spans: ReadonlyArray<Span>
	requests: ReadonlyArray<PricedRequest> | undefined
}

// One refused call, reduced to what the tally and the same-args test need: the region its cost is
// priced in, the wall clock re-issuing it cost, the identity a later call is compared against, and its
// position in the ordered walk so only *later* calls count as re-issues.
interface Refusal {
	guard: string
	region: LabeledRegion
	reissue_ms: number
	identity: string
	order: number
}

const NO_GUARD_REFUSALS: GuardRefusalFacts = {
	by_guard: [],
	refusal_count: NONE,
	reissue_ms: NONE,
	cost_usd: time_region_costs.NO_COST,
	is_measured: false,
	is_cost_measured: false,
}

function is_refused(span: Span): boolean {
	return span.refusal_guard !== '' && !span.is_continuation
}

// The refused call plus the model wait that composed it: the region opens at the preceding model
// span's start, so the request that produced the refused call is inside it and `tally` prices it.
function refusal_of(span: Span, model_start: number | undefined, order: number): Refusal {
	const start_ms = model_start ?? span.ended_ms - span.duration_ms

	return {
		guard: span.refusal_guard,
		region: { start_ms, end_ms: span.ended_ms, label: span.refusal_guard },
		reissue_ms: span.ended_ms - start_ms,
		identity: time_call_identity.identity_of(span),
		order,
	}
}

// The start of the model wait that composed the call at `index` — the nearest model span before it,
// and `undefined` where none precedes it. This is what the region reaches back to, so the composing
// billed request falls inside it.
function preceding_model_start(ordered: ReadonlyArray<Span>, index: number): number | undefined {
	const model = ordered
		.slice(0, index)
		.findLast((span) => span.category === time_spans.MODEL_CATEGORY)

	return model === undefined ? undefined : model.ended_ms - model.duration_ms
}

// Walked in time order so a refusal's region reaches back to the model wait that produced it, and so
// the same-args test can ask only about calls that came *after* it.
function collect_refusals(ordered: ReadonlyArray<Span>): Array<Refusal> {
	const refusals: Array<Refusal> = []

	for (const [order, span] of ordered.entries()) {
		if (is_refused(span)) {
			refusals.push(refusal_of(span, preceding_model_start(ordered, order), order))
		}
	}

	return refusals
}

// A refused call whose identity reappears later on a call that was not itself refused — the run
// re-issued the same thing, which is the signal a refusal was a false positive rather than a catch.
function reissued_same(refusal: Refusal, ordered: ReadonlyArray<Span>): boolean {
	return ordered.some(
		(span, index) =>
			index > refusal.order &&
			span.refusal_guard === '' &&
			time_call_identity.identity_of(span) === refusal.identity,
	)
}

function group_by_guard(refusals: ReadonlyArray<Refusal>): Map<string, Array<Refusal>> {
	const groups = new Map<string, Array<Refusal>>()

	for (const refusal of refusals) {
		const kept = groups.get(refusal.guard) ?? []

		kept.push(refusal)
		groups.set(refusal.guard, kept)
	}

	return groups
}

function reissue_ms_of(refusals: ReadonlyArray<Refusal>): number {
	let total = NONE

	for (const refusal of refusals) total += refusal.reissue_ms

	return total
}

function same_args_of(refusals: ReadonlyArray<Refusal>, ordered: ReadonlyArray<Span>): number {
	return refusals.filter((refusal) => reissued_same(refusal, ordered)).length
}

function row_of(
	guard: string,
	group: ReadonlyArray<Refusal>,
	ordered: ReadonlyArray<Span>,
	cost: Bucket,
): GuardRefusalRow {
	return {
		guard,
		refusal_count: group.length,
		reissue_ms: reissue_ms_of(group),
		same_args_reissue_count: same_args_of(group, ordered),
		request_count: cost.request_count,
		cost_usd: cost.cost_usd,
	}
}

// The cost corpus is optional: when it was not read every guard's bucket is empty, so the rows carry
// their counts and times and report the cost as unmeasured rather than as zero.
function cost_by_guard(
	refusals: ReadonlyArray<Refusal>,
	requests: ReadonlyArray<PricedRequest> | undefined,
): Map<string, Bucket> {
	if (requests === undefined) return new Map()

	return time_region_costs.tally(
		refusals.map((refusal) => refusal.region),
		requests,
	).by_label
}

// Largest bill first, and where nothing was priced the most-refused guard leads — so a reader ranks
// by dollars when they exist and by refusals when they do not.
function by_cost_then_count(left: GuardRefusalRow, right: GuardRefusalRow): number {
	return right.cost_usd - left.cost_usd || right.refusal_count - left.refusal_count
}

function total_cost(rows: ReadonlyArray<GuardRefusalRow>): number {
	let total = time_region_costs.NO_COST

	for (const row of rows) total += row.cost_usd

	return total
}

function build(input: GuardRefusalInput): GuardRefusalFacts {
	const { spans, requests } = input
	const ordered = time_round_trips.in_time_order(spans)
	const refusals = collect_refusals(ordered)
	const cost = cost_by_guard(refusals, requests)
	const by_guard = [...group_by_guard(refusals)]
		.map(([guard, group]) =>
			row_of(guard, group, ordered, cost.get(guard) ?? time_region_costs.EMPTY_BUCKET),
		)
		.toSorted(by_cost_then_count)

	return {
		by_guard,
		refusal_count: refusals.length,
		reissue_ms: reissue_ms_of(refusals),
		cost_usd: total_cost(by_guard),
		is_measured: time_spans.has_transcript_data(spans.length),
		is_cost_measured: requests !== undefined,
	}
}

function cost_note(row: GuardRefusalRow, is_cost_measured: boolean): string {
	if (!is_cost_measured) return COST_UNMEASURED

	return time_format.usd(row.cost_usd, time_region_costs.TOTAL_DECIMALS)
}

function guard_row_line(row: GuardRefusalRow, is_cost_measured: boolean): string {
	const suffix = [
		`${String(row.refusal_count)} ${REFUSAL_NOTE}`,
		cost_note(row, is_cost_measured),
		`${String(row.same_args_reissue_count)} ${SAME_ARGS_NOTE}`,
	].join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_row(row.guard, row.reissue_ms, suffix)
}

// **Printed only where a guard actually refused.** A run that walked through none — the ordinary case —
// carries no block, on the same reasoning `time-bundles.ts` prints nothing it had nothing to say
// about: a line that appears every time is one nobody reads. An unread transcript carries none either,
// which the absence and `is_measured: false` on `--json` both report.
function guard_refusal_lines(facts: GuardRefusalFacts | undefined): Array<string> {
	if (facts === undefined || facts.by_guard.length === NONE) return []

	return ['', HEADING, ...facts.by_guard.map((row) => guard_row_line(row, facts.is_cost_measured))]
}

const time_guard_refusals = {
	HEADING,
	NO_GUARD_REFUSALS,
	build,
	guard_refusal_lines,
}

export type { GuardRefusalFacts, GuardRefusalInput, GuardRefusalRow }
export { time_guard_refusals }
