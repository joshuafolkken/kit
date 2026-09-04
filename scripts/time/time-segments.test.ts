import { describe, expect, it } from 'vitest'
import { time_markers } from './time-markers'
import { time_phase_fixture } from './time-phase-fixture'
import { time_segments, type Segment } from './time-segments'
import { time_spans, type Span } from './time-spans'

// The run read as timed segments (joshuafolkken/kit#1311).
//
// The acceptance criterion is a known span sequence producing the expected segmentation, so the run
// below is written as a timeline of minute positions — the same shape `time-phases.test.ts` reads,
// through the same fixture, because a segment boundary *is* a phase boundary and a second span
// builder beside this suite is where the two would come to disagree about what a run looks like.

const { MINUTE_MS, span, GATE_COMMAND, PR_COMMAND, MERGE_COMMAND } = time_phase_fixture
const PNPM_LABEL = 'Bash: pnpm'

function edit(start_minute: number, minutes: number, label: string): Span {
	return span(start_minute, minutes, { label, marker: time_markers.EDIT_MARKER })
}

function commanded(start_minute: number, minutes: number, josh_command: string): Span {
	return span(start_minute, minutes, { label: PNPM_LABEL, josh_command })
}

function reviewed(start_minute: number, minutes: number): Span {
	return span(start_minute, minutes, { label: 'Skill', marker: time_markers.REVIEW_MARKER })
}

// One whole `fullrun`, in the order it happened: the workflow opens, preparation runs, the edits
// start, the gate and the review follow, the pull request opens, the merge closes it, and a following
// conversation is attributed to the run after it.
const RUN: ReadonlyArray<Span> = [
	span(0, 2, { label: 'Bash: gh', marker: time_markers.WORKFLOW_MARKER }),
	span(2, 3, { label: 'Read' }),
	edit(5, 6, 'Edit'),
	edit(11, 4, 'Write'),
	commanded(15, 1, GATE_COMMAND),
	reviewed(16, 5),
	edit(21, 3, 'Edit'),
	commanded(24, 1, PR_COMMAND),
	span(25, 2, { label: PNPM_LABEL }),
	commanded(27, 1, MERGE_COMMAND),
	span(28, 2, { label: 'Bash: git' }),
]

function shaped(segments: ReadonlyArray<Segment>): Array<[string, number, string]> {
	return segments.map((segment) => [
		segment.phase,
		segment.duration_ms / MINUTE_MS,
		segment.lead_label,
	])
}

function total_ms(segments: ReadonlyArray<Segment>): number {
	return segments.reduce((sum, segment) => sum + segment.duration_ms, 0)
}

describe('time_segments.build_segments — a known run', () => {
	it('cuts the run into the segments its phases describe', () => {
		expect(shaped(time_segments.build_segments(RUN))).toEqual([
			['setup', 5, 'Read'],
			['implement', 10, 'Edit'],
			['gate', 1, PNPM_LABEL],
			['review', 5, 'Skill'],
			['rework', 3, 'Edit'],
			['pr', 1, PNPM_LABEL],
			['wrapup', 2, PNPM_LABEL],
			['merge', 1, PNPM_LABEL],
			['post-run', 2, 'Bash: git'],
		])
	})

	// The wall window a reader checks the row against, which is not what the duration is: the two
	// differ the moment two sessions attributed to one issue overlap.
	it('carries the wall window each segment occupied', () => {
		const [first] = time_segments.build_segments(RUN)

		expect(first?.started_ms).toBe(0)
		expect(first?.ended_ms).toBe(5 * MINUTE_MS)
	})

	// The third acceptance criterion: the segments are the same elapsed time seen another way, so the
	// existing reconciliation between the breakdown and the elapsed time survives.
	it('accounts for exactly the time the spans did', () => {
		const spans_ms = RUN.reduce((sum, entry) => sum + entry.duration_ms, 0)

		expect(total_ms(time_segments.build_segments(RUN))).toBe(spans_ms)
	})
})

// A phase that held the run for a few seconds between two long stretches of another one. Printing a
// row for it is what made the hand-built timeline unreadable, and dropping its time would break the
// reconciliation above — so it is absorbed, and the two stretches it split come back as one row.
const FLICKER: ReadonlyArray<Span> = [
	span(0, 2, { label: 'Bash: gh', marker: time_markers.WORKFLOW_MARKER }),
	span(2, 3, { label: 'Read' }),
	edit(5, 2, 'Edit'),
	reviewed(7, 0.2),
	edit(7.2, 2.8, 'Edit'),
]

describe('time_segments.build_segments — a short interruption', () => {
	it('absorbs it rather than opening a row for it', () => {
		expect(shaped(time_segments.build_segments(FLICKER))).toEqual([
			['setup', 5, 'Read'],
			['implement', 5, 'Edit'],
		])
	})

	it('keeps the absorbed time inside the segment that swallowed it', () => {
		expect(total_ms(time_segments.build_segments(FLICKER))).toBe(10 * MINUTE_MS)
	})
})

describe('time_segments.build_segments — nothing to segment', () => {
	it('answers with no segments at all when no span was read', () => {
		expect(time_segments.build_segments([])).toEqual([])
	})

	// Model and human spans carry no tool name, so a stretch made only of them has no busiest command
	// — and naming it after a blank row is what the report's own tables already refuse.
	it('leaves the lead label empty where nothing in the segment was a named call', () => {
		const thinking = [span(0, 3, { category: time_spans.MODEL_CATEGORY })]

		expect(time_segments.build_segments(thinking)[0]?.lead_label).toBe('')
	})
})

describe('time_segments.segment_lines', () => {
	it('prints nothing at all when there is no timeline', () => {
		expect(time_segments.segment_lines([])).toEqual([])
	})

	it('prints the window, the duration and the leading label', () => {
		const lines = time_segments.segment_lines(time_segments.build_segments(RUN))

		expect(lines[1]).toBe(time_segments.HEADING)
		expect(lines[2]).toContain('00:00:00 → 00:05:00')
		expect(lines[2]).toContain('5.0 min')
		expect(lines[2]).toContain('setup · Read')
	})

	// The same display cap every other table of the report carries, and the same note under it: a
	// table that quietly stops at fifteen reads as a run that had fifteen segments.
	it('caps the printed rows and says how many it withheld', () => {
		const many = Array.from({ length: 20 }, (_unused, index) => ({
			phase: 'other' as const,
			started_ms: index * MINUTE_MS,
			ended_ms: (index + 1) * MINUTE_MS,
			duration_ms: MINUTE_MS,
			lead_label: `row-${String(index)}`,
		}))
		const lines = time_segments.segment_lines(many)

		expect(lines).toHaveLength(18)
		expect(lines.at(-1)).toContain('and 5 more')
	})
})
