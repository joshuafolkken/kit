import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { investigation_reads } from '#scripts/delegation/investigation-reads'
import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_investigation } from './time-investigation'
import { time_phases } from './time-phases'
import { time_report_fixture } from './time-report-fixture'
import { time_spans } from './time-spans'
import { time_transcript_fixture } from './time-transcript-fixture'

// joshuafolkken/kit#1764: what the main line's reading was, decomposed.
//
// The cases pin the two things the block rests on. The four rows are the **guard's own** answers —
// the edit set, the threshold, the delegation reset and the re-arm — replayed over a recorded run,
// so a figure printed here cannot come to describe a rule nobody ships; and an unread transcript
// says so rather than reporting four zeroes, which would read as a run that did no investigating.

const { BRANCH, edit_call_line, result_line, target_turn_lines } = time_transcript_fixture
const { line_of } = time_report_fixture
const { EDIT_TARGET_CLASS, UNDER_THRESHOLD_CLASS, REFUSED_CLASS, LET_THROUGH_CLASS } =
	investigation_reads

const THRESHOLD = delegation_policy.INVESTIGATION_FILE_THRESHOLD
const EDIT_MINUTE = 9
const LATE_TURN = 30
const EDIT_ID = 'edit-call'
const SUBJECT_FILE = 'scripts/one.ts'
const NONE = 0
const ONE = 1

// One `Read` per file, all in one turn — the shape `open_turn_lines` writes and the shape a run's
// own reading takes.
function reads_text(count: number, turn = 0, prefix = 'read'): string {
	const targets = Array.from(
		{ length: count },
		(_unused, index) => `scripts/${prefix}-${String(index)}.ts`,
	)

	return target_turn_lines(turn, targets).join('\n')
}

function totals_of(text: string): ReturnType<typeof time_investigation.build_investigation> {
	return time_investigation.build_investigation(time_spans.parse_timeline(text).spans)
}

function count_in(text: string, name: string): number {
	return time_investigation.count_for(totals_of(text), name)
}

describe('time_investigation.build_investigation — the four answers', () => {
	// The reading `SKILL.md` → §2b keeps in the main line on purpose: an `Edit` cannot be issued
	// against text nobody holds. It is decided from the run's whole edit set rather than from the
	// pending set, because a read made long before its edit is still a read of a file the run edited.
	it('reads a file the run goes on to edit as a main-line read', () => {
		const text = [
			...target_turn_lines(0, [SUBJECT_FILE]),
			edit_call_line(EDIT_MINUTE, BRANCH, SUBJECT_FILE, EDIT_ID),
			result_line(EDIT_MINUTE + 1, BRANCH, EDIT_ID),
		].join('\n')

		expect(count_in(text, EDIT_TARGET_CLASS)).toBe(ONE)
		expect(totals_of(text).read_count).toBe(ONE)
	})

	it('counts the reads below the threshold apart from the one that reaches it', () => {
		const totals = totals_of(reads_text(THRESHOLD))

		expect(time_investigation.count_for(totals, UNDER_THRESHOLD_CLASS)).toBe(THRESHOLD - ONE)
		expect(time_investigation.count_for(totals, REFUSED_CLASS)).toBe(ONE)
	})

	// The gap this Issue was filed to find: reads that reached the threshold and were let through
	// because the guard had already spoken and could not speak again. They are neither by design nor
	// refused, and nothing could see them — which is why 35.9% of a run's turns could not be
	// decomposed at all.
	it('names the reads a standing refusal let through, and refuses again after them', () => {
		const text = [reads_text(THRESHOLD), reads_text(THRESHOLD, LATE_TURN, 'late')].join('\n')
		const totals = totals_of(text)

		expect(time_investigation.count_for(totals, LET_THROUGH_CLASS)).toBe(THRESHOLD - ONE)
		expect(time_investigation.count_for(totals, REFUSED_CLASS)).toBe(2)
	})

	// The rows have to reconstruct the read count, or the block is a breakdown of nothing.
	it('accounts for every read it counted', () => {
		const totals = totals_of(reads_text(THRESHOLD))
		const counted = investigation_reads.READ_CLASSES.map((name) =>
			time_investigation.count_for(totals, name),
		)

		expect(counted.reduce((sum, count) => sum + count, NONE)).toBe(totals.read_count)
	})

	it('does not count a search that never carried the file', () => {
		expect(totals_of(reads_text(NONE)).read_count).toBe(NONE)
	})
})

describe('time_investigation.investigation_lines — the block', () => {
	it('prints one row per answer under its heading', () => {
		const lines = time_investigation.investigation_lines(totals_of(reads_text(THRESHOLD)))

		expect(lines).toContain(time_investigation.HEADING)
		expect(lines).toHaveLength(investigation_reads.READ_CLASSES.length + 2)
	})

	// Zero here would read as a run that opened nothing, which is the one answer an unread transcript
	// cannot support — the same word every block above it uses.
	it('withholds the rows for a run whose transcript was not read', () => {
		const text = time_investigation
			.investigation_lines(time_investigation.NO_INVESTIGATION)
			.join('\n')

		expect(line_of(text, REFUSED_CLASS)).toContain(time_format.NOT_MEASURED)
	})
})

// joshuafolkken/kit#1868: the same reads, split by the phase each fell in. The setup share is the
// reading done before implementation starts, which is what the Issue asks the block to surface.
describe('time_investigation.build_investigation — the phase each read fell in', () => {
	const SETUP_FILES = ['scripts/setup-a.ts', 'scripts/setup-b.ts']
	const IMPLEMENT_FILE = 'scripts/impl-c.ts'
	const SETUP_READS = 2
	const IMPLEMENT_READS = 1

	// Two reads of files the run goes on to edit, made before the first edit (setup), then a read of an
	// un-edited file after it (implement). The first edit is what closes setup.
	const text = [
		...target_turn_lines(0, SETUP_FILES),
		edit_call_line(EDIT_MINUTE, BRANCH, SETUP_FILES[0] ?? '', 'edit-a'),
		result_line(EDIT_MINUTE + ONE, BRANCH, 'edit-a'),
		edit_call_line(EDIT_MINUTE + 2, BRANCH, SETUP_FILES[1] ?? '', 'edit-b'),
		result_line(EDIT_MINUTE + 3, BRANCH, 'edit-b'),
		...target_turn_lines(LATE_TURN, [IMPLEMENT_FILE]),
	].join('\n')

	it('attributes the reads made before the first edit to setup', () => {
		const totals = totals_of(text)

		expect(totals.by_phase[time_phases.SETUP_PHASE]).toEqual({ [EDIT_TARGET_CLASS]: SETUP_READS })
		expect(time_investigation.setup_count_for(totals, EDIT_TARGET_CLASS)).toBe(SETUP_READS)
	})

	it('keeps the reads made after the first edit out of the setup count', () => {
		const totals = totals_of(text)

		expect(totals.by_phase[time_phases.IMPLEMENT_PHASE]).toEqual({
			[UNDER_THRESHOLD_CLASS]: IMPLEMENT_READS,
		})
		expect(time_investigation.setup_count_for(totals, UNDER_THRESHOLD_CLASS)).toBe(NONE)
	})
})
