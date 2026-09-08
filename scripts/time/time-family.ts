import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { time_overlap, type Interval } from './time-overlap'
import { time_spans, type Span } from './time-spans'

// A run is a family of transcripts, not one node (joshuafolkken/kit#1439).
//
// **Every scope reads one node of the transcript tree, and a delegated run is wider than that.** The
// issue scope walks the whole project directory but keeps only what `cost_attribute` attributes to
// the issue's branch, and a delegated unit records the branch it was forked on — routinely `main`
// even when the session that delegated it was on the run's branch — so exactly the transcript the
// work is in is the one dropped. The session scope reads a single file, so it holds either the
// parent or one unit and never both. Neither is a corpus of the run.
//
// **So the corpus grows in both directions along the parent↔unit relation.** From whatever was read
// directly:
//
// - **Down** — a unit whose whole window sits inside the parent's attributed minutes ran while the
//   parent was executing this run, whatever branch its own lines declare. Dropping it is symptom 1:
//   the review agent's 101 seconds went missing from run #1428's issue-scoped report while the
//   session scope read them.
// - **Up** — the session that delegated a unit the run is reading. The handoff in front of a unit
//   and the teardown behind it are the parent's own spans, and no scope holds them: the issue scope
//   attributes them to nothing and the session scope reads one file. That is symptom 2 — 3.7 minutes
//   of run #1441, 8% of its real cost, in no output at all.
//
// **The parent's minutes are bounded by the units either side, not by its whole transcript.** A
// parent that ran four children spent a handoff in front of each of them; the minutes in front of a
// *sibling* unit are that sibling's run's handoff, not this one's. So the window taken for a unit
// runs from the end of the last sibling before it to the start of the first sibling after it, and an
// only child takes the parent's whole transcript because there is no sibling to bound it.
//
// **A transcript that could not be read is reported, never measured at zero.** `read_optional` is
// what makes the two answers different, and the count travels back with the spans so the note above
// the report can name it.
//
// **A transcript that was read and holds no parseable span is the same answer**
// (joshuafolkken/kit#1599). It has no window either, so it bounds the parent's minutes exactly as
// badly as an unreadable one does — the difference is only in why, and the run is short by the same
// minutes whichever it was. What decides the answer is therefore whether a window came back, never
// whether the file opened.

const NO_SPANS = 0
const BEFORE_EVERYTHING = 0
const AFTER_EVERYTHING = Number.MAX_SAFE_INTEGER

// One session's transcripts: the session's own, and the units it delegated. `own` is absent for a
// session whose file was pruned while its `subagents/` survived — the state `latest_own_index`
// already names — and the family is then its units alone.
interface Family {
	own: SessionFile | undefined
	units: Array<SessionFile>
}

// One relative's contribution: which transcript, and the spans of it that belong to the run.
interface Relative {
	file: SessionFile
	spans: ReadonlyArray<Span>
}

// What the family added, and whose minutes went unmeasured. The second is a list rather than a count
// so the note can be built from the same values a test asserts on.
//
// **Two causes, one list** (joshuafolkken/kit#1599): a transcript that could not be read at all, and
// one that was read and yielded no span. They are kept together because the consequence is identical
// — the run is short by whatever that transcript held — and a reader told the figures are missing
// minutes needs no second sentence to say which of the two it was.
interface Relatives {
	added: Array<Relative>
	unread: Array<string>
}

type SpanReader = (file: SessionFile) => ReadonlyArray<Span> | undefined

function empty_family(): Family {
	return { own: undefined, units: [] }
}

function placed(family: Family, file: SessionFile): Family {
	if (file.is_delegated) return { own: family.own, units: [...family.units, file] }

	return { own: file, units: family.units }
}

// The listing regrouped by the session each transcript belongs with. Built once and shared by every
// issue asked about, because the grouping is the same question whichever issue is asking.
function group(files: ReadonlyArray<SessionFile>): Map<string, Family> {
	const families = new Map<string, Family>()

	for (const file of files) {
		const owner = cost_transcript.owning_session_id(file)

		families.set(owner, placed(families.get(owner) ?? empty_family(), file))
	}

	return families
}

function parse(file: SessionFile): ReadonlyArray<Span> | undefined {
	const text = cost_transcript.read_optional(file)

	if (text === undefined) return undefined

	return time_spans.parse_timeline(text).spans
}

// One transcript parsed at most once however many issues the walk asks about — the same economy
// `time-corpus.ts` makes for its own pass, and the reason the second pass costs the family rather
// than the corpus. `undefined` is cached too: a file that could not be read is not retried per issue.
function memo_reader(): SpanReader {
	const seen = new Map<string, ReadonlyArray<Span> | undefined>()

	return function read(file: SessionFile): ReadonlyArray<Span> | undefined {
		if (!seen.has(file.path)) seen.set(file.path, parse(file))

		return seen.get(file.path)
	}
}

// The wall clock a set of spans occupies. `undefined` for an empty set, which is what a transcript
// with nothing parseable yields and is not the same answer as an interval of no length.
function lowest_start(intervals: ReadonlyArray<Interval>): number {
	let found = AFTER_EVERYTHING

	for (const one of intervals) found = Math.min(found, one.started_ms)

	return found
}

function highest_end(intervals: ReadonlyArray<Interval>): number {
	let found = BEFORE_EVERYTHING

	for (const one of intervals) found = Math.max(found, one.ended_ms)

	return found
}

function window_of(spans: ReadonlyArray<Span>): Interval | undefined {
	if (spans.length === NO_SPANS) return undefined

	const parts = spans.map((span) => time_overlap.to_interval(span))

	return { started_ms: lowest_start(parts), ended_ms: highest_end(parts) }
}

// **Strict on both ends, and not `shared_ms(one, other) > 0`** (joshuafolkken/kit#1465). The two
// agree on every interval of some length and disagree on one of none: a span of zero duration shares
// no milliseconds with anything, so the length reading would answer `false` for an instant sitting
// inside a sibling's window — and that instant would then be attributed to this unit instead of
// being subtracted from it. The question here is whether the two touch, not how long for.
function overlaps(one: Interval, others: ReadonlyArray<Interval>): boolean {
	return others.some((other) => one.started_ms < other.ended_ms && other.started_ms < one.ended_ms)
}

// Whether one of the parent's attributed stretches encloses the whole of `inner`. **Asked as
// enclosure rather than as `uncovered_ms(inner, covered) === 0`**, which answers `0` for an interval
// of no length whatever `covered` holds — including nothing at all: a unit whose spans all close on
// the same instant would then be claimed by any family the run touched, however far outside the run
// it ran. `covered` is already a disjoint union, so enclosure by one of its intervals is exactly what
// "fully covered" means.
function is_covered(inner: Interval, covered: ReadonlyArray<Interval>): boolean {
	return covered.some((one) => time_overlap.encloses(one, inner))
}

function covering(spans: ReadonlyArray<Span>): Array<Interval> {
	return time_overlap.union_intervals(spans.map((span) => time_overlap.to_interval(span)))
}

function no_relatives(): Relatives {
	return { added: [], unread: [] }
}

function joined(left: Relatives, right: Relatives): Relatives {
	return { added: [...left.added, ...right.added], unread: [...left.unread, ...right.unread] }
}

// One unit weighed against the parent's attributed minutes. Absent spans are the unread answer, and
// a window the parent's minutes do not cover is a unit of some other run.
function claimed_unit(
	unit: SessionFile,
	covered: ReadonlyArray<Interval>,
	read: SpanReader,
): Relatives {
	const spans = read(unit)

	if (spans === undefined) return { added: [], unread: [unit.session_id] }

	const window = window_of(spans)

	if (window === undefined || !is_covered(window, covered)) return no_relatives()

	return { added: [{ file: unit, spans }], unread: [] }
}

// **Down.** The units of a session the run already reads, minus the ones it read directly.
function downward(
	units: ReadonlyArray<SessionFile>,
	contributed: ReadonlySet<string>,
	covered: ReadonlyArray<Interval>,
	read: SpanReader,
): Relatives {
	let found = no_relatives()

	for (const unit of units) {
		if (!contributed.has(unit.session_id)) found = joined(found, claimed_unit(unit, covered, read))
	}

	return found
}

// The gap around the units this run holds: from the end of the last sibling in front of them to the
// start of the first sibling behind them. With no sibling either side the bound is the parent's
// whole transcript, which is the right answer for a session that delegated once.
function adjacency_window(
	inside: ReadonlyArray<Interval>,
	outside: ReadonlyArray<Interval>,
): Interval {
	const first = lowest_start(inside)
	const last = highest_end(inside)

	return {
		started_ms: highest_end(outside.filter((one) => one.ended_ms <= first)),
		ended_ms: lowest_start(outside.filter((one) => one.started_ms >= last)),
	}
}

// **The parent's own idle time bounds the handoff and the teardown too.** A session that delegated
// once has no sibling to bound it, and its transcript reaches back to whatever it was doing before
// the run and on to whatever came after — measured on run #1441, where the sibling bound alone let
// 170 minutes of the parent sitting at a prompt into a 49-minute run. A human span is exactly that
// boundary: the person typing, or the session waiting for them. So the handoff begins after the last
// human span in front of the unit and the teardown ends at the first one behind it.
function idle_intervals(spans: ReadonlyArray<Span>): Array<Interval> {
	return spans
		.filter((span) => span.category === time_spans.HUMAN_CATEGORY)
		.map((span) => time_overlap.to_interval(span))
}

// **A sibling that ran *beside* the unit bounds nothing, so it is subtracted instead.** The window
// above only moves for a sibling wholly in front of or behind the unit; siblings launched together
// overlap it, and the parent's `Task` span for one of those would otherwise be taken whole into this
// run — where nothing subtracts it, because the sibling's own transcript is not in the corpus.
function inside_window(
	spans: ReadonlyArray<Span>,
	window: Interval,
	outside: ReadonlyArray<Interval>,
): Array<Span> {
	return spans.filter((span) => {
		const one = time_overlap.to_interval(span)

		return time_overlap.encloses(window, one) && !overlaps(one, outside)
	})
}

// The units of one family split by whether this run holds them, each as the wall clock it occupies,
// and the ones no window could be taken for.
// **An unreadable unit is not an empty one, and `?? []` is exactly the fold this change exists to
// remove.** A sibling read as empty leaves `outside`, so `adjacency_window` is no longer bounded by
// it and `inside_window` no longer subtracts it — the parent's minutes bracketing that sibling are
// then charged to this run, measured rather than reported. It travels back as an id instead.
//
// **The window is what decides membership, not the read** (joshuafolkken/kit#1599). Splitting on
// `spans === undefined` left a third state between the two: a sibling whose transcript opened and
// parsed to no span had no window either, so it fell out of `inside` and `outside` alike while being
// counted as read — invisible to `adjacency_window` and to `inside_window` in exactly the way an
// unreadable one had been, and with nothing saying so.
interface UnitWindows {
	inside: Array<Interval>
	outside: Array<Interval>
	unmeasured: Array<string>
}

function measured_window(spans: ReadonlyArray<Span> | undefined): Interval | undefined {
	return spans === undefined ? undefined : window_of(spans)
}

function unit_windows(
	units: ReadonlyArray<SessionFile>,
	is_held: (unit: SessionFile) => boolean,
	read: SpanReader,
): UnitWindows {
	const opened = units.map((unit) => ({ unit, window: measured_window(read(unit)) }))
	const found = opened.flatMap((one) =>
		one.window === undefined ? [] : [{ unit: one.unit, window: one.window }],
	)

	return {
		inside: found.filter((one) => is_held(one.unit)).map((one) => one.window),
		outside: found.filter((one) => !is_held(one.unit)).map((one) => one.window),
		unmeasured: opened.filter((one) => one.window === undefined).map((one) => one.unit.session_id),
	}
}

// The parent's own contribution, once the run is known to hold one of its units: the handoff and the
// teardown around them, bounded by the siblings either side and by the parent's own idle time.
function parent_relatives(parent: SessionFile, held: UnitWindows, read: SpanReader): Relatives {
	const spans = read(parent)

	if (spans === undefined) return { added: [], unread: [parent.session_id] }

	// Two bounds on the same minutes, taken together: whichever is tighter at each end. They answer
	// different questions — one about the parent's other children, one about the parent's own
	// idleness — and a run can need either.
	const window = time_overlap.narrowest(
		adjacency_window(held.inside, held.outside),
		adjacency_window(held.inside, idle_intervals(spans)),
	)

	return {
		added: [{ file: parent, spans: inside_window(spans, window, held.outside) }],
		unread: [],
	}
}

// **Up.** The session that delegated a unit this run holds, bounded to the handoff and the teardown
// around it. Nothing is taken when the run already reads the parent directly: its attributed spans
// are in the corpus, and adding them a second time under a different rule would be two answers.
function upward(family: Family, contributed: ReadonlySet<string>, read: SpanReader): Relatives {
	const parent = family.own

	if (parent === undefined || contributed.has(parent.session_id)) return no_relatives()

	const held = unit_windows(family.units, (unit) => contributed.has(unit.session_id), read)

	if (held.inside.length === NO_SPANS) return no_relatives()

	// **A sibling with no window bounds nothing, so nothing is taken on the strength of it.** Its
	// window is unknown, so neither the adjacency bound nor the concurrent-sibling subtraction can be
	// trusted; the parent's minutes go unmeasured and the note names the transcript that was missing.
	// **Whether the transcript failed to open or opened onto no span makes no difference here**
	// (joshuafolkken/kit#1599): the bound is missing either way.
	if (held.unmeasured.length > NO_SPANS) return { added: [], unread: held.unmeasured }

	return parent_relatives(parent, held, read)
}

// What one issue's collector holds already, so the two directions can be decided without it: which
// transcripts contributed, and the run's own spans from each session's own transcript.
interface FamilyInput {
	families: ReadonlyMap<string, Family>
	contributed: ReadonlySet<string>
	attributed: ReadonlyMap<string, ReadonlyArray<Span>>
	read: SpanReader
}

function touches(family: Family, contributed: ReadonlySet<string>): boolean {
	const is_own_read = family.own !== undefined && contributed.has(family.own.session_id)

	return is_own_read || family.units.some((unit) => contributed.has(unit.session_id))
}

function relatives_of(owner: string, family: Family, input: FamilyInput): Relatives {
	const covered = covering(input.attributed.get(owner) ?? [])
	const down = downward(family.units, input.contributed, covered, input.read)

	return joined(down, upward(family, input.contributed, input.read))
}

// Every family the run touches, expanded in both directions. A run that never delegated and was
// never delegated to touches one family with no units, where both directions are empty — which is
// the whole of the "a run that never delegated reports exactly as it did" guarantee.
function collect(input: FamilyInput): Relatives {
	let found = no_relatives()

	for (const [owner, family] of input.families) {
		if (!touches(family, input.contributed)) continue

		found = joined(found, relatives_of(owner, family, input))
	}

	return found
}

// The union a session scope reports, already resolved against the parent-unit overlap.
interface SessionSpans {
	spans: Array<Span>
	unread: Array<string>
}

// **Every read in the session scope goes through here, so no failure is folded into an empty
// transcript.** `read_optional` exists to keep the two apart, and a `?? []` at any one call site puts
// them back together — the state the note above the report is there to name.
function read_noting(
	file: SessionFile,
	read: SpanReader,
	unread: Array<string>,
): ReadonlyArray<Span> {
	const spans = read(file)

	if (spans === undefined) unread.push(file.session_id)

	return spans ?? []
}

function session_own(
	family: Family,
	file: SessionFile,
	read: SpanReader,
	unread: Array<string>,
): ReadonlyArray<Span> {
	if (!file.is_delegated) return read_noting(file, read, unread)

	const parent = upward(family, new Set([file.session_id]), read)

	unread.push(...parent.unread)

	return parent.added.flatMap((one) => one.spans)
}

// The units a session scope pairs with the transcript named. Naming the session takes all of them —
// the scope *is* that session — and naming one unit takes that unit alone, so the parent's minutes
// beside its siblings stay theirs.
function session_units(
	family: Family,
	file: SessionFile,
	read: SpanReader,
	unread: Array<string>,
): Array<Span> {
	const wanted = file.is_delegated
		? family.units.filter((unit) => unit.session_id === file.session_id)
		: family.units

	return wanted.flatMap((unit) => [...read_noting(unit, read, unread)])
}

// **The family of one named transcript, which is what `--session` reports.** Both directions apply
// exactly as they do for an issue: naming the parent adds its units, naming a unit adds the parent's
// handoff and teardown. Without this the two scopes read different corpora of the same run and
// disagree about it — which is the equality joshuafolkken/kit#1439 is measured by.
function for_session(files: ReadonlyArray<SessionFile>, file: SessionFile): SessionSpans {
	const read = memo_reader()
	const family = group(files).get(cost_transcript.owning_session_id(file)) ?? empty_family()
	const unread: Array<string> = []
	const units = session_units(family, file, read, unread)

	return {
		spans: time_overlap.resolve_delegated(session_own(family, file, read, unread), units),
		unread: [...new Set(unread)],
	}
}

const time_family = {
	group,
	memo_reader,
	window_of,
	adjacency_window,
	collect,
	for_session,
}

export type { Family, Relatives, SessionSpans, SpanReader }
export { time_family }
