import { investigation_reads, type ClassifiedRead } from '#scripts/delegation/investigation-reads'
import { time_format } from './time-format'
import { time_phases } from './time-phases'
import { time_spans, type Span } from './time-spans'

// What the main line's reading *was*, rather than how much of it there was
// (joshuafolkken/kit#1764).
//
// `Turns by contributor:` measured `investigation` at **624 turns, 35.9%** over nineteen runs — the
// second-largest contributor after implementation — and nothing could decompose it. Two questions sit
// inside that figure and neither had an answer: how much of it is the reading `SKILL.md` → §2b leaves
// in the main line on purpose (a file the run is about to edit — an `Edit` cannot be issued against
// text nobody holds), and how much of it is reading that should have gone to a delegated unit. So the
// largest mechanism this repository ships against its largest cost could not be said to be working or
// not working, which is the shape joshuafolkken/kit#1262 declared highest priority.
//
// **It says nothing about waste, and the rows are ordered to make that hard to misread.** The two
// rows above the line are reading that belongs where it is; only the last is a defect, and it is a
// defect in the guard rather than in the run that walked through it.
//
// **The classification is `investigation-reads.ts`'s, not a second reading of the same rule.** That
// module is the guard: the subject test, the threshold, the delegation reset and the re-arm all live
// there, and `classified_reads` replays them over a recorded run. A walk here that merely resembled the
// guard would answer about a rule nobody ships — the clone `CLAUDE.md` prohibits, in the one place a
// drift would have a measurement and a mechanism disagree about the same threshold.
//
// **The unit is a read, not a turn.** The contributor block counts turns because a turn is what is
// billed; this block counts the calls inside them, because one turn can read three files and the
// question here is what each of those files was. The two are read together and neither is derived
// from the other.

const { format_columns, format_share, unmeasured_row, SUFFIX_SEPARATOR } = time_format

const HEADING = 'Investigation reads:'
const READS_NOTE = 'of the reads this run made'
const SETUP_NOTE = 'in setup'

const NONE = 0
const ONE = 1

// What was established. **`is_measured` is not `read_count > 0`**: a run whose transcript was never
// read and a run that read nothing both total zero, and printing four zeroes for the second would
// report an unread transcript as a run that did no investigating — the same distinction
// `time-parent-turns.ts` draws for its own counts.
interface InvestigationTotals {
	read_count: number
	// A plain record rather than a `Map`, because `josh time --json` is what the `diag` skill reads and
	// `JSON.stringify` renders a `Map` as `{}`. A class that claimed no read is absent rather than
	// zero; the renderer defaults it.
	by_class: Readonly<Record<string, number>>
	// The same tally split by the phase each read fell in (joshuafolkken/kit#1868), so the setup-phase
	// share of each class — the reading done before implementation starts — is answerable from the tool
	// rather than by hand. Nested plain records for the same `JSON.stringify` reason as `by_class`; a
	// phase or class that saw no read is absent.
	by_phase: Readonly<Record<string, Readonly<Record<string, number>>>>
	is_measured: boolean
}

const NO_INVESTIGATION: InvestigationTotals = {
	read_count: NONE,
	by_class: {},
	by_phase: {},
	is_measured: false,
}

// `bucket[name] += 1`, defaulting the absent first entry of a class to zero.
function bump(bucket: Record<string, number>, name: string): void {
	bucket[name] = (bucket[name] ?? NONE) + ONE
}

function tally(classes: ReadonlyArray<string>): Record<string, number> {
	const counts: Record<string, number> = {}

	for (const found of classes) bump(counts, found)

	return counts
}

// **Each read's phase, crossed with its class** (joshuafolkken/kit#1868). A read carries the index of
// its span in the array handed to `build_investigation`, and `time_phases.classify` of that same array
// gives the phase at each index — so the two pair by index, the way `time-placed.ts` reads a gap's
// phase. A phase that saw no read is absent, so the setup-phase share is read straight off the result.
function tally_by_phase(
	reads: ReadonlyArray<ClassifiedRead>,
	phases: ReadonlyArray<string>,
): Record<string, Record<string, number>> {
	const counts: Record<string, Record<string, number>> = {}

	for (const read of reads) {
		const phase = phases[read.index] ?? time_phases.OTHER_PHASE
		const bucket = counts[phase] ?? {}

		bump(bucket, read.found)
		counts[phase] = bucket
	}

	return counts
}

function build_investigation(spans: ReadonlyArray<Span>): InvestigationTotals {
	const reads = investigation_reads.classified_reads(spans)
	const phases = time_phases.classify(spans)

	return {
		read_count: reads.length,
		by_class: tally(reads.map((read) => read.found)),
		by_phase: tally_by_phase(reads, phases),
		is_measured: time_spans.has_transcript_data(spans.length),
	}
}

// A safe read of a dynamic key: an absent or explicitly-undefined entry defaults to zero. Every
// dynamic key on these records is looked up through here, so the lookup lives in exactly one place.
function count_in(bucket: Readonly<Record<string, number>> | undefined, name: string): number {
	if (bucket === undefined || !Object.hasOwn(bucket, name)) return NONE

	return bucket[name] ?? NONE
}

function count_for(totals: InvestigationTotals, name: string): number {
	return count_in(totals.by_class, name)
}

// How many of a class's reads fell in `setup` — the phase joshuafolkken/kit#1868 is about.
function setup_count_for(totals: InvestigationTotals, name: string): number {
	return count_in(totals.by_phase[time_phases.SETUP_PHASE], name)
}

function class_row(totals: InvestigationTotals, name: string): string {
	const count = count_for(totals, name)
	const share = format_share(count, totals.read_count)
	const setup = [String(setup_count_for(totals, name)), SETUP_NOTE].join(' ')

	return format_columns(name, String(count), [share, READS_NOTE, setup].join(SUFFIX_SEPARATOR))
}

// **A run whose transcript was not read says so rather than reporting four zeroes**, the same word
// every block above it uses for the same state.
function investigation_lines(totals: InvestigationTotals): Array<string> {
	const heading = ['', HEADING]
	const { READ_CLASSES } = investigation_reads

	if (!totals.is_measured) return [...heading, ...READ_CLASSES.map((name) => unmeasured_row(name))]

	return [...heading, ...READ_CLASSES.map((name) => class_row(totals, name))]
}

const time_investigation = {
	HEADING,
	NO_INVESTIGATION,
	build_investigation,
	count_for,
	investigation_lines,
	setup_count_for,
}

export type { InvestigationTotals }
export { time_investigation }
