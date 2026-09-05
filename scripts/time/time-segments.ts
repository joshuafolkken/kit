import { time_format } from './time-format'
import { time_phases, type PhaseName } from './time-phases'
import { time_placed, type Placed } from './time-placed'
import type { Span } from './time-spans'

// The run read as a sequence of timed segments (joshuafolkken/kit#1311).
//
// The phase breakdown answers *how much* each stage cost and says nothing about *when* it happened:
// a run whose gate ran three times shows one `gate` row, and the reader cannot tell whether the
// three sat together or were spread across the hour. The hand-built report epic #1262 was filed from
// did say so — "preparation 39:32–41:24 / implementation 41:24–44:02 / gate ∥ review 44:02–46:34" —
// and reproducing it cost the same hand work every time.
//
// **A segment is a maximal consecutive stretch of spans in the same phase, and that boundary is Tier
// A** (joshuafolkken/kit#1311). Two other readings were weighed. Cutting on every *command* change
// makes a segment per call, which is the span list with a heading. Cutting on a fixed clock interval
// makes rows that move whenever a run gets faster, which is the one thing `time-markers.ts` refuses
// for a boundary. The phase is what the report already cuts by, so a segment boundary that is a phase
// change adds no second classification — `time_phases.classify` is read rather than restated, and the
// segments therefore agree with the phase table by construction rather than by assumption.
//
// **A short flicker is absorbed rather than printed.** Real runs alternate — a gate call, the turn
// that read it, another gate call — so a strict reading of the rule above yields dozens of rows a
// person cannot read, which is the failure mode that made the hand-built report worth having. A
// stretch under `MIN_SEGMENT_MS` therefore continues the segment it interrupted, and the segment is
// named by the phase that spent the most of it rather than by the one that opened it. Both halves are
// needed: without the first the table is noise, and without the second an absorbed flicker could
// outweigh the phase whose name the row carries.
//
// **What is absorbed is still counted.** Every span lands in exactly one segment and a segment's
// duration is the sum of its spans', so the segments reconstruct the same total the phase table does
// — the reconciliation the third acceptance criterion asks for, and the property that makes two runs
// comparable.

const HEADING = 'Segments (in run order):'
const NO_LEAD = ''
const LEAD_SEPARATOR = ' · '
const NO_DURATION = 0

// Under this, a phase change is a flicker rather than a stretch of the run. Set from the merged runs
// measured on joshuafolkken/kit#1311, where the gate is started in the background and comes back in
// seconds while the review beside it runs for minutes: at half a minute the four `josh gate` calls of
// issue #1309's run stop cutting the review into pieces, and every stage that took a person or a
// command any real time still opens a row of its own.
const MIN_SEGMENT_MS = 30_000

interface Segment {
	// The phase that spent the most of this segment — the label that leads the row.
	phase: PhaseName
	started_ms: number
	ended_ms: number
	// The sum of the member spans' durations, which is what reconciles with the phase table. It is not
	// `ended_ms - started_ms`: two sessions attributed to one issue can overlap, and the wall window
	// would then count time twice that no span spent.
	duration_ms: number
	// The command or tool that spent the most of the segment, or empty where the segment was all model
	// and human time. It is the detail the phase name cannot carry: `gate` says which stage, this says
	// which command inside it.
	lead_label: string
}

function started_ms(span: Span): number {
	return span.ended_ms - span.duration_ms
}

// What a segment accumulates while it is open: its members, and how long each phase has spent in it.
interface Group {
	members: Array<Placed>
	duration_ms: number
	by_phase: Map<PhaseName, number>
}

function add_to(group: Group, entry: Placed): void {
	const { phase } = entry
	const { duration_ms } = entry.span

	group.members.push(entry)
	group.duration_ms += duration_ms
	group.by_phase.set(phase, (group.by_phase.get(phase) ?? NO_DURATION) + duration_ms)
}

function new_group(entry: Placed): Group {
	const group: Group = { members: [], duration_ms: NO_DURATION, by_phase: new Map() }

	add_to(group, entry)

	return group
}

// The key holding the largest total, or the fallback for an empty map. `toSorted` is stable, so a tie
// keeps insertion order — a segment split evenly between two phases is named by the one that opened
// it rather than by whichever the iteration happened to reach last.
function heaviest<Key>(totals: ReadonlyMap<Key, number>, fallback: Key): Key {
	const entries: Array<[Key, number]> = [...totals]

	return entries.toSorted((left, right) => right[1] - left[1])[0]?.[0] ?? fallback
}

function lead_phase(group: Group): PhaseName {
	return heaviest(group.by_phase, time_phases.OTHER_PHASE)
}

// Whether this span continues the segment in hand. It does when it is the same phase, and it does
// while that segment is still shorter than a segment worth printing — the flicker rule, which is what
// keeps a run's table readable without letting the absorbed time escape the total.
function continues(group: Group | undefined, entry: Placed): group is Group {
	if (group === undefined) return false

	return lead_phase(group) === entry.phase || group.duration_ms < MIN_SEGMENT_MS
}

function grouped(entries: ReadonlyArray<Placed>): Array<Group> {
	const groups: Array<Group> = []

	for (const entry of entries) {
		const open = groups.at(-1)

		if (continues(open, entry)) add_to(open, entry)
		else groups.push(new_group(entry))
	}

	return groups
}

// **Two neighbors that ended up with the same name are one segment.** A stretch of rework
// interrupted by a gate call comes out of the walk above as two groups — the gate opens the second,
// and the rework after it takes the name back — so without this pass the table prints `rework` twice
// in a row, which reads as a defect rather than as the interruption it describes.
function join(groups: Array<Group>, group: Group): void {
	const open = groups.at(-1)

	if (open === undefined || lead_phase(open) !== lead_phase(group)) {
		groups.push(group)

		return
	}

	for (const entry of group.members) add_to(open, entry)
}

function merged(groups: ReadonlyArray<Group>): Array<Group> {
	const joined: Array<Group> = []

	for (const group of groups) join(joined, group)

	return joined
}

// The busiest command inside the segment. Model and human spans carry no label at all, so a segment
// made only of those is left without one rather than being named after a blank row — the same rule
// `time-report.ts` applies to its own tables.
function lead_label(members: ReadonlyArray<Placed>): string {
	const totals = new Map<string, number>()

	for (const { span } of members) {
		if (span.label !== NO_LEAD) {
			totals.set(span.label, (totals.get(span.label) ?? NO_DURATION) + span.duration_ms)
		}
	}

	return heaviest(totals, NO_LEAD)
}

function to_segment(group: Group): Segment {
	const starts = group.members.map(({ span }) => started_ms(span))
	const ends = group.members.map(({ span }) => span.ended_ms)

	return {
		phase: lead_phase(group),
		started_ms: Math.min(...starts),
		ended_ms: Math.max(...ends),
		duration_ms: group.duration_ms,
		lead_label: lead_label(group.members),
	}
}

function build_segments(spans: ReadonlyArray<Span>): Array<Segment> {
	return merged(grouped(time_placed.placed_spans(spans))).map((group) => to_segment(group))
}

function suffix_of(segment: Segment): string {
	if (segment.lead_label === NO_LEAD) return segment.phase

	return `${segment.phase}${LEAD_SEPARATOR}${segment.lead_label}`
}

function segment_row(segment: Segment): string {
	const window = time_format.format_window(segment.started_ms, segment.ended_ms)

	return time_format.format_row(window, segment.duration_ms, suffix_of(segment))
}

// Nothing at all where no span was read: a run whose transcript could not be attributed has no
// timeline, and an empty heading asserts that it had one and it was blank.
function segment_lines(segments: ReadonlyArray<Segment>): Array<string> {
	if (segments.length === 0) return []

	const shown = segments.slice(0, time_format.MAX_ROWS).map((segment) => segment_row(segment))

	return ['', HEADING, ...shown, ...time_format.overflow_line(segments.length)]
}

const time_segments = {
	HEADING,
	MIN_SEGMENT_MS,
	build_segments,
	segment_lines,
}

export type { Segment }
export { time_segments }
