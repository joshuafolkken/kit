import { time_format } from './time-format'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// How many of a run's round trips were avoidable, read from the run rather than assumed
// (joshuafolkken/kit#1344).
//
// Three runs in a row came in at 1.10–1.12 calls per round trip against a 1.50 floor, and neither the
// end-of-run warning (joshuafolkken/kit#1304) nor the live line (joshuafolkken/kit#1329) moved the
// number. The Issue's estimate of what batching would return — 33 round trips of 136, about 4.8
// minutes — was arithmetic on the floor: it assumed every call could be bundled to 1.50 and said
// nothing about which ones actually could. **A mechanism proposed on that figure would be sized by an
// assumption**, which is what this module replaces.
//
// **A sequence is consecutive single-call round trips whose calls do not touch one another's
// targets.** Each such sequence of `n` turns could have been one, so `n - 1` of its round trips were
// avoidable. Nothing here proposes a mechanism; it establishes the size of what one would be worth.
//
// ## What the figure cannot see, in both directions
//
// **It under-reports** wherever the target test finds an overlap that was not a dependency — two
// unrelated reads of the same file, or a read inside a directory an earlier call merely mentioned —
// and wherever a chained shell command was excluded for holding a mutation word it never used as one.
//
// **It over-reports** wherever a call named no target at all: a dependency that exists only in the
// earlier call's *output* is invisible here, because no result text is retained anywhere in this
// pipeline. `gh issue view 1344` followed by a read of what it printed is the shape that escapes.
//
// So it is an estimate with its error stated, not a floor and not a ceiling — and it is an estimate
// of what a run did rather than of what a target density implies.

const { unmeasured_row } = time_format
const HEADING = 'Bundling:'
const SEQUENCE_LABEL = 'bundleable sequences'
const RECOVERABLE_LABEL = 'recoverable round trips'
// **Not `model wait recoverable`.** The category table's own row is `model wait`, and every reader
// of this report filters its rows by a substring — a label holding that phrase would be counted as a
// fourth category share by anything looking for the three.
const SAVING_LABEL = 'recoverable wait'
// The breakdown's own row, withheld beside the three above rather than beneath them: an unread
// transcript has no per-tool answer either, and a table printed under a `not measured` heading would
// be the empty-means-nothing-to-recover reading this block refuses everywhere else.
const BY_TOOL_LABEL = 'recoverable by tool'
// The per-tool rows sit one level under that row. Two spaces rather than a separate column, because
// `format_columns` lays out one label column and a sub-table with its own would not line up with it.
const ROW_INDENT = '  '
// Two turns is the smallest thing that could have been one. A sequence of one is a turn that had
// nothing to go out beside, which is not a finding.
const MIN_SEQUENCE = 2
const ONE_CALL = 1
const NONE = 0
const PATH_SEPARATOR = '/'
// The first call of a sequence is the turn the rest could have gone out in, so it is the one call
// that costs nothing — the attribution starts after it.
const FIRST_CALL = 1
// The label a span carries when nothing could be read off the call. Left out of the breakdown rather
// than printed as a bucket, which is the answer `time-report.ts` already gives an empty label — and
// what it leaves out is exactly what `unattributed_round_trips` below then reports.
const NO_LABEL = ''

// One tool's share of what the run could have recovered (joshuafolkken/kit#1607). `sequence_count` is
// the number of sequences this tool contributed a recoverable trip to, not the number of calls it
// made — a tool appearing four times inside one sequence is one sequence to go and look at.
interface BundleToolRow {
	label: string
	sequence_count: number
	recoverable_round_trips: number
}

// What the walk established about a run. **`is_measured` is not `sequence_count > 0`**: a run that
// batched everything genuinely has no sequence, and a run whose transcript was never read has none
// either — printing `0` for both would report the first as though it were the second.
//
// **`by_tool` is what makes the count actionable** (joshuafolkken/kit#1607). `recoverable_round_trips`
// says how many turns could have been one and nothing about *whose* turns they were, so a diag that
// read only it could name a density and never a tool — and the tool was then found by reading the
// transcript by hand, once per run.
//
// **`unattributed_round_trips` is a reconciliation rather than a second bucket, and on a real
// transcript it is always `0`.** Only a bundleable call can enter a sequence and every one of those
// carries a label — `non_bash_call` takes the tool's own name, `bash_label` falls back to `Bash`, and
// the two unlabelled `ToolCall`s are both `not_bundleable()` — so the rows and the residue sum to
// `recoverable_round_trips` by construction and the residue has nothing to hold. **What it catches is
// the two halves coming apart**: this block is read by a person deciding what to batch, and a table
// that had quietly stopped covering its own total is the one failure they could not otherwise see.
// **Do not read a `0` here as "every call was labelled" evidence** — it is the expected state, and the
// documentation that quotes this row quotes it balanced for that reason.
interface BundleTotals {
	sequence_count: number
	longest_sequence: number
	recoverable_round_trips: number
	by_tool: ReadonlyArray<BundleToolRow>
	unattributed_round_trips: number
	is_measured: boolean
}

const NO_BUNDLES: BundleTotals = {
	sequence_count: 0,
	longest_sequence: 0,
	recoverable_round_trips: 0,
	by_tool: [],
	unattributed_round_trips: 0,
	is_measured: false,
}

// Whether `whole` contains `part` **as a run of whole path segments**. Three positions, because a
// path can hold another at its head, its tail or its middle, and a plain `includes` would match
// `scripts/time-x` inside `scripts/time-xyz`.
//
// **The tail position is what makes an absolute path comparable with a relative one.** A `Read` call
// names `/Users/…/kit/scripts/time/x.ts` while the `grep` before it named `scripts/time`, and nothing
// here knows the working directory the second was relative to — so the search-then-read pair, which is
// the whole reason the target test exists, would escape it on the two shapes it occurs in most.
function contains_segments(whole: string, part: string): boolean {
	if (whole.startsWith(`${part}${PATH_SEPARATOR}`)) return true

	return (
		whole.endsWith(`${PATH_SEPARATOR}${part}`) ||
		whole.includes(`${PATH_SEPARATOR}${part}${PATH_SEPARATOR}`)
	)
}

// Equal, or one inside the other. The containing form is what catches the search-then-read pair:
// `grep -rn foo scripts` names `scripts`, and the `cat scripts/time/x.ts` that follows it names a path
// beneath — which is exactly how the second call learned the first one's answer.
function is_related(left: string, right: string): boolean {
	if (left === right) return true

	return contains_segments(left, right) || contains_segments(right, left)
}

function shares_target(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
	return left.some((one) => right.some((other) => is_related(one, other)))
}

// What sharing a target is evidence *of*. Sharing one is the proxy for "the later call needed the
// earlier one's result", and for a read after a write it is a good one — an `Edit`'s `old_string`
// came from the `Read` before it.
//
// **Between two writes it is not** (joshuafolkken/kit#1509). A second edit to a file already held
// needs nothing from the first, so both belong in one turn — and treating the pair as dependent is
// what kept the guard silent for a whole run. `extend` below does not merely decline to count such a
// pair: it *flushes* the sequence and restarts it at the conflicting call, so a stretch of single-call
// turns all editing one file could never take `sequence.length` past 1, and the refusal at
// `time-batch-guard.ts` — which needs 2 — could never fire however long the stretch ran. Measured on
// `fullrun #1503`: 17 such stretches, 108 seconds, and zero refusals in two hours.
//
// **Read-after-read keeps the old reading deliberately.** Two reads of one file can genuinely depend
// — a `grep` that finds a line number and a `sed -n` that prints around it — so the proxy still earns
// its place there. Only the write-write pair has no such counter-case.
interface TargetFacts {
	targets: ReadonlyArray<string>
	is_writing: boolean
}

function is_dependent(earlier: TargetFacts, later: TargetFacts): boolean {
	if (earlier.is_writing && later.is_writing) return false

	return shares_target(earlier.targets, later.targets)
}

function conflicts(span: Span, sequence: ReadonlyArray<Span>): boolean {
	return sequence.some((earlier) => is_dependent(earlier, span))
}

// A call, as opposed to the tail of one. A continuation is the remainder of a call whose middle went
// to a delegated unit, and `time-round-trips.ts` already refuses to count it as a second call.
function is_call(span: Span): boolean {
	return span.category === time_spans.TOOL_CATEGORY && !span.is_continuation
}

// Whether the span between two round trips leaves them consecutive. Only a model span does: a person
// typing means the second turn was composed after an interruption, and a continuation means a
// delegated unit ran in between — neither pair could have gone out together.
function is_turn_boundary(span: Span): boolean {
	return span.category === time_spans.MODEL_CATEGORY
}

// The walk's three running pieces: the calls of the round trip currently open, the sequence being
// extended, and the sequences already closed.
//
// **`closed` keeps the calls rather than their lengths** (joshuafolkken/kit#1607). A length is all the
// three totals need, and it is also everything the per-tool breakdown cannot be rebuilt from — the
// labels are gone by the time anything asks. Retaining the spans is what lets one walk answer both,
// and a second walk over the same rule would be the clone `CLAUDE.md` prohibits.
interface Walk {
	pending: Array<Span>
	sequence: Array<Span>
	closed: Array<Array<Span>>
}

function new_walk(): Walk {
	return { pending: [], sequence: [], closed: [] }
}

function flush(walk: Walk): void {
	if (walk.sequence.length >= MIN_SEQUENCE) walk.closed.push(walk.sequence)

	walk.sequence = []
}

// A conflicting call does not end the run of single-call turns; it starts a new sequence at itself,
// because everything after it may still have been bundleable with it.
function extend(walk: Walk, span: Span): void {
	if (conflicts(span, walk.sequence)) flush(walk)

	walk.sequence.push(span)
}

// **A turn that issued several calls breaks the sequence rather than joining it.** It is a turn that
// already batched, and the question here is what the single-call turns cost — folding a batched turn
// in would count the improvement as part of the defect.
function close_trip(walk: Walk): void {
	const [only] = walk.pending

	if (walk.pending.length === ONE_CALL && only?.is_bundleable === true) extend(walk, only)
	else if (walk.pending.length > NONE) flush(walk)

	walk.pending = []
}

// Whether this span is still the turn whose calls are pending. **A turn's calls are separated by its
// own model spans**, because Claude Code writes one line per content block and the harness returns
// each result as it arrives (joshuafolkken/kit#1406) — so closing the trip on every model span read
// one batched turn as several single-call ones and offered it back as a sequence that could have been
// bundled, which it already was. An absent id matches nothing, leaving the adjacency reading intact
// for a transcript that wrote none.
// **A continuation is excluded whatever id it carries.** `time_overlap.trim` copies the head's fields
// onto the tail, so a delegated unit's bracketing call comes back carrying the very message this turn
// is issuing from — and read as the same turn it would skip the flush that says the unit ran in
// between, which is exactly what `is_turn_boundary` below refuses to let a sequence cross.
function is_same_turn(span: Span, pending: ReadonlyArray<Span>): boolean {
	const [first] = pending

	if (first === undefined || span.is_continuation) return false
	if (span.message_id === time_spans.NO_MESSAGE_ID) return false

	return span.message_id === first.message_id
}

function step(walk: Walk, span: Span): void {
	if (is_call(span)) {
		walk.pending.push(span)

		return
	}

	if (is_same_turn(span, walk.pending)) return

	close_trip(walk)
	if (!is_turn_boundary(span)) flush(walk)
}

function longest_of(sizes: ReadonlyArray<number>): number {
	return sizes.length === NONE ? NONE : Math.max(...sizes)
}

// One sequence of `n` turns could have been one turn, so it holds `n - 1` avoidable round trips.
function recoverable_of(sizes: ReadonlyArray<number>): number {
	return sizes.reduce((sum, size) => sum + size - ONE_CALL, NONE)
}

function sizes_of(closed: ReadonlyArray<ReadonlyArray<Span>>): Array<number> {
	return closed.map((sequence) => sequence.length)
}

interface ToolTally {
	sequence_count: number
	recoverable_round_trips: number
}

function tally_for(tallies: Map<string, ToolTally>, label: string): ToolTally {
	const found = tallies.get(label)

	if (found !== undefined) return found

	const created = { sequence_count: NONE, recoverable_round_trips: NONE }

	tallies.set(label, created)

	return created
}

// **Attribution is per call, not per sequence** (joshuafolkken/kit#1607). A sequence of `n` calls
// holds `n - 1` avoidable trips, and the call that made each of them its own turn is the one after
// the first — so each trip goes to *that* call's tool. Attributing a whole sequence to one tool would
// have named a tool only where every call in the sequence shared one, and a real run's sequences are
// mixed: `grep`, `sed`, `Read` in a row is the shape, and the reading that has to come out of it is
// still "batch the `grep` calls". The alternative leaves that sequence entirely unattributed, which is
// the reading this block exists to stop having to do by hand.
//
// **A label counts a sequence once however many trips it held there**, so the row says how many
// separate places in the run to go and look at rather than repeating the trip count.
function count_trip(tallies: Map<string, ToolTally>, counted: Set<string>, label: string): void {
	const tally = tally_for(tallies, label)

	tally.recoverable_round_trips += ONE_CALL
	if (!counted.has(label)) tally.sequence_count += ONE_CALL
	counted.add(label)
}

function tally_sequence(tallies: Map<string, ToolTally>, sequence: ReadonlyArray<Span>): void {
	const counted = new Set<string>()

	for (const span of sequence.slice(FIRST_CALL)) {
		if (span.label !== NO_LABEL) count_trip(tallies, counted, span.label)
	}
}

// Heaviest first, because the row a batching proposal is written from is the top one; ties settle on
// the label so two runs of the same shape print the same table.
function by_weight(left: BundleToolRow, right: BundleToolRow): number {
	if (left.recoverable_round_trips !== right.recoverable_round_trips) {
		return right.recoverable_round_trips - left.recoverable_round_trips
	}

	return left.label.localeCompare(right.label)
}

function tool_rows(closed: ReadonlyArray<ReadonlyArray<Span>>): Array<BundleToolRow> {
	const tallies = new Map<string, ToolTally>()

	for (const sequence of closed) tally_sequence(tallies, sequence)

	return [...tallies].map(([label, tally]) => ({ label, ...tally })).toSorted(by_weight)
}

function attributed_of(rows: ReadonlyArray<BundleToolRow>): number {
	return rows.reduce((sum, row) => sum + row.recoverable_round_trips, NONE)
}

// **Ordered before it is walked, for the reason `time-failures.ts` states.** A run's spans do not
// arrive in time order: a delegated unit's are appended after the parent's, and `time_corpus`
// concatenates one session after another. Walked in array order, two turns from different sessions
// would read as consecutive and be counted as a sequence nobody could have batched.
function build_bundles(spans: ReadonlyArray<Span>): BundleTotals {
	const walk = new_walk()

	// A loop rather than `reduce`: the walk carries three pieces and mutates them, which is the shape
	// `time-failures.ts` uses for the same reason.
	for (const span of time_round_trips.in_time_order(spans)) step(walk, span)

	close_trip(walk)
	flush(walk)

	const sizes = sizes_of(walk.closed)
	const by_tool = tool_rows(walk.closed)
	const recoverable_round_trips = recoverable_of(sizes)

	return {
		sequence_count: sizes.length,
		longest_sequence: longest_of(sizes),
		recoverable_round_trips,
		by_tool,
		unattributed_round_trips: recoverable_round_trips - attributed_of(by_tool),
		is_measured: time_spans.has_transcript_data(spans.length),
	}
}

// The sequence the walk is still inside when the spans run out — the trailing run of consecutive
// single-call bundleable turns (joshuafolkken/kit#1390).
//
// **Neither `close_trip` nor `flush` is called, and that is the whole difference from
// `build_bundles`.** The report closes the walk because it is pricing a run that has ended; a guard
// reading a transcript mid-flight wants the sequence nothing has ended yet, which is the one the next
// call would extend. Sharing the walk is what keeps the refusal and the end-of-run figure from ever
// disagreeing about what a sequence is — a second walk here would be the clone `CLAUDE.md` prohibits,
// in the one place a drift would refuse a call the report then says was fine.
//
// **Leaving `close_trip` out is load-bearing rather than tidy.** The turn being read is still open, and
// its earlier calls have already come back — so closing the trip here folds the in-flight turn into the
// sequence as though it were a closed single-call turn. Measured live: the first call of a two-call
// turn was admitted and the second refused, because the first had returned in between and lengthened
// the sequence by one. Only a turn boundary may close a trip, and the walk's own `step` is what
// supplies one.
function open_sequence(spans: ReadonlyArray<Span>): ReadonlyArray<Span> {
	const walk = new_walk()

	for (const span of time_round_trips.in_time_order(spans)) step(walk, span)

	return walk.sequence
}

function sequence_suffix(totals: BundleTotals): string {
	return `longest ${String(totals.longest_sequence)} turn(s)`
}

// What the report already knows about a round trip, taken as one record so the caller hands over the
// report itself rather than picking two fields out of it — and so `time-report.ts` never imports a
// type from here that it would then have to export back.
interface TripPrice {
	round_trip_count: number
	model_ms_per_round_trip: number
}

function recoverable_suffix(totals: BundleTotals, round_trip_count: number): string {
	const share = time_format.format_share(totals.recoverable_round_trips, round_trip_count)

	return `${share} of ${String(round_trip_count)} round trip(s)`
}

// **The model share is what a batching change actually returns**, for the reason `time-report.ts`
// gives beside the unit price: a tool's own execution is paid whichever turn it was issued from, so
// multiplying the avoidable trips by the whole price would promise back seconds no change removes.
function saving_line(totals: BundleTotals, model_ms_per_round_trip: number): string {
	const saved_ms = totals.recoverable_round_trips * model_ms_per_round_trip
	const rate = `at ${time_format.format_seconds(model_ms_per_round_trip)} model time per round trip`

	return time_format.format_row(SAVING_LABEL, saved_ms, rate)
}

// **The suffix is the reconciliation, printed whether or not it balances** — and on a real transcript
// it always balances, for the reason `BundleTotals` gives. It is printed rather than asserted because
// this table is read by a person deciding what to batch: a row reading `23 of 25 attributed` is the
// walk and the attribution having come apart, which is the one failure that table cannot show on its
// own. **It is not a count of unlabelled calls** — reading it as one is what the rows beneath it and
// the two documents quoting them were corrected away from.
//
// **Derived from the recorded residue rather than re-summed from the rows**, so a drift between the
// record and the table is what the row prints instead of being hidden by recomputing one from the
// other.
function by_tool_suffix(totals: BundleTotals): string {
	const attributed = totals.recoverable_round_trips - totals.unattributed_round_trips

	return `${String(attributed)} of ${String(totals.recoverable_round_trips)} attributed`
}

function tool_row(row: BundleToolRow): string {
	return time_format.format_columns(
		`${ROW_INDENT}${row.label}`,
		String(row.recoverable_round_trips),
		`in ${String(row.sequence_count)} sequence(s)`,
	)
}

// Capped like every other table this report prints, and for the reason `time-format.ts` gives beside
// the cap: `--json` carries every row, so what a long run loses here is a table nobody reads.
function by_tool_lines(totals: BundleTotals): Array<string> {
	const heading = time_format.format_columns(
		BY_TOOL_LABEL,
		String(totals.by_tool.length),
		by_tool_suffix(totals),
	)
	const rows = totals.by_tool.slice(NONE, time_format.MAX_ROWS).map((row) => tool_row(row))

	return [heading, ...rows, ...time_format.overflow_line(totals.by_tool.length)]
}

function measured_lines(totals: BundleTotals, price: TripPrice): Array<string> {
	return [
		time_format.format_columns(
			SEQUENCE_LABEL,
			String(totals.sequence_count),
			sequence_suffix(totals),
		),
		time_format.format_columns(
			RECOVERABLE_LABEL,
			String(totals.recoverable_round_trips),
			recoverable_suffix(totals, price.round_trip_count),
		),
		saving_line(totals, price.model_ms_per_round_trip),
		...by_tool_lines(totals),
	]
}

const LABELS = [SEQUENCE_LABEL, RECOVERABLE_LABEL, SAVING_LABEL, BY_TOOL_LABEL]

// **A transcript that was read but called no tool has nothing to divide by, and says so** — the same
// answer, in the same words, the round-trip block's own price row gives. Without this the block
// printed `at 0.0 s model time per round trip` beside a price row reading `no tool call to divide`,
// which is one report disagreeing with itself about what was measured.
function no_divisor_lines(): Array<string> {
	return LABELS.map((label) => time_format.format_columns(label, '', time_format.NO_CALLS))
}

// **A run whose transcript was not read says so rather than reporting nothing to recover.** Zero here
// would read as a run that batched everything, which is the one answer an unread transcript cannot
// support — the same shape, and the same word, the category shares and the round-trip block use.
//
// **The two withheld cases are different answers.** One says nothing was read; the other says what was
// read made no round trip, so there is no share and no price to quote — and the counts beside them
// would be a measured zero either way, which is what neither is.
function bundle_lines(totals: BundleTotals, price: TripPrice): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) return [...heading, ...LABELS.map((label) => unmeasured_row(label))]
	if (price.round_trip_count === NONE) return [...heading, ...no_divisor_lines()]

	return [...heading, ...measured_lines(totals, price)]
}

const time_bundles = {
	HEADING,
	SEQUENCE_LABEL,
	RECOVERABLE_LABEL,
	SAVING_LABEL,
	BY_TOOL_LABEL,
	MIN_SEQUENCE,
	NO_BUNDLES,
	build_bundles,
	bundle_lines,
	is_dependent,
	open_sequence,
	shares_target,
}

export type { BundleToolRow, BundleTotals, TargetFacts, TripPrice }
export { time_bundles }
