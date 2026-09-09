import { describe, expect, it } from 'vitest'
import type { SessionSpans } from './time-duplicate'
import { time_markers, type PhaseMarker } from './time-markers'
import { time_sessions, type SessionSplit } from './time-sessions'
import type { Span } from './time-spans'
import { time_transcript_fixture as fixture } from './time-transcript-fixture'

const { MINUTE_MS } = fixture
const RUN_SESSION = 'ran-it'
const OTHER_SESSION = 'planned-something-else'
const THIRD_SESSION = 'measured-a-third-thing'
const ONE_MINUTE = 1
const TWO_MINUTES = 2
const ONE_SESSION = 1
const TWO_SESSIONS = 2
const NO_SPANS = 0
const ONE_SPAN = 1
const TWO_SPANS = 2

function span(label: string, minutes: number, marker: PhaseMarker = time_markers.NO_MARKER): Span {
	return { ...fixture.span(label, minutes, minutes), marker }
}

function keyed(spans: ReadonlyArray<Span>): Map<string, Span> {
	return new Map(spans.map((one, index) => [`${one.label}-${String(index)}`, one]))
}

function session(own: ReadonlyArray<Span>, delegated: ReadonlyArray<Span> = []): SessionSpans {
	return { own: keyed(own), delegated: keyed(delegated) }
}

// A session that opened the workflow on this issue, which is what says it is the one that ran it.
function run_session(minutes: number = ONE_MINUTE): SessionSpans {
	return session([span('Skill', minutes, time_markers.WORKFLOW_MARKER)])
}

// A session that only ever had the issue's branch checked out under it.
function bystander(minutes: number): SessionSpans {
	return session([span('Bash: gh', minutes)])
}

// The issue the run under test is reporting on. The fixtures above declare no issue at all, which is
// the shape of every transcript recorded before the `in-progress` capture existed — so they take the
// presence test and this number never matches one of them.
const ISSUE = 1630
const OTHER_ISSUE = 1481

function separate(
	entries: ReadonlyArray<[string, SessionSpans]>,
	issue_number: number = ISSUE,
): SessionSplit {
	return time_sessions.separate(new Map(entries), issue_number)
}

// A marker that names the issue it opened, which is what the `in-progress` call writes.
function naming(ended_minute: number, issue: number): Span {
	return {
		...fixture.span('Bash: gh', ended_minute, ONE_MINUTE),
		marker: time_markers.WORKFLOW_MARKER,
		issue,
	}
}

function work(ended_minute: number): Span {
	return fixture.span('Read', ended_minute, ONE_MINUTE)
}

describe('time_sessions.separate', () => {
	// Two sessions open in one work tree share its branch, so the branch-keyed attribution hands both
	// to the same issue — 45 minutes of `josh epic` counted into run #1412's every figure.
	it('leaves out a session that no workflow marker attributes to the run', () => {
		const split = separate([
			[RUN_SESSION, run_session()],
			[OTHER_SESSION, bystander(TWO_MINUTES)],
		])

		expect(split.kept.size).toBe(ONE_SESSION)
		expect(split.kept.has(RUN_SESSION)).toBe(true)
		expect(split.is_separated).toBe(true)
		expect(split.excluded).toStrictEqual([
			{ session_id: OTHER_SESSION, duration_ms: TWO_MINUTES * MINUTE_MS },
		])
	})

	// The marker is the run's, not the transcript's: a child implemented entirely inside a delegated
	// unit leaves nothing marked in the parent's own file.
	it('keeps a session whose marker sits in a delegated unit', () => {
		const delegating = session([], [span('Skill', ONE_MINUTE, time_markers.WORKFLOW_MARKER)])
		const split = separate([
			[RUN_SESSION, delegating],
			[OTHER_SESSION, bystander(TWO_MINUTES)],
		])

		expect(split.kept.has(RUN_SESSION)).toBe(true)
		expect(split.excluded).toHaveLength(ONE_SESSION)
	})
})

describe('time_sessions.separate — what the excluded list says', () => {
	it('names the excluded sessions longest first', () => {
		const split = separate([
			[RUN_SESSION, run_session()],
			[OTHER_SESSION, bystander(ONE_MINUTE)],
			[THIRD_SESSION, bystander(TWO_MINUTES)],
		])

		expect(split.excluded.map((one) => one.session_id)).toStrictEqual([
			THIRD_SESSION,
			OTHER_SESSION,
		])
	})

	// A session that delegated holds one `Agent` span across the whole time the unit runs, and the
	// unit's transcript records the same minutes as work. Summed raw, an excluded session reports at
	// close to twice its wall clock — beside kept runs whose minutes went through the subtraction.
	it('counts the minutes an excluded session shared with its own unit once', () => {
		const delegated = session([span('Agent', TWO_MINUTES)], [span('Read', TWO_MINUTES)])
		const split = separate([
			[RUN_SESSION, run_session()],
			[OTHER_SESSION, delegated],
		])

		expect(split.excluded[0]?.duration_ms).toBe(TWO_MINUTES * MINUTE_MS)
	})
})

// Dropping every session would report the run as unmeasured rather than as inflated, which is the one
// answer worse than the inflation.
describe('time_sessions.separate with no marker anywhere', () => {
	it('keeps every session and says it could not separate them', () => {
		const split = separate([
			[RUN_SESSION, bystander(ONE_MINUTE)],
			[OTHER_SESSION, bystander(TWO_MINUTES)],
		])

		expect(split.kept.size).toBe(TWO_SESSIONS)
		expect(split.excluded).toStrictEqual([])
		expect(split.is_separated).toBe(false)
		expect(split.attributed_count).toBe(TWO_SESSIONS)
	})

	// One session is the run's whether or not it left a marker, so there is nothing to separate and
	// nothing to report — `attributed_count` is what tells that apart from the case above.
	it('reports a lone unmarked session as having nothing to separate from', () => {
		const split = separate([[RUN_SESSION, bystander(ONE_MINUTE)]])

		expect(split.attributed_count).toBe(ONE_SESSION)
		expect(split.attributed_count).toBeLessThan(time_sessions.AMBIGUOUS_MINIMUM)
	})
})

// joshuafolkken/kit#1648. The presence test alone kept a session that had opened a different run, and
// kept a dispatching parent whole — so #1630 was recorded at 361 minutes against about 45, and three
// children of one parent recorded the identical start.
describe('time_sessions.separate when a marker names the issue', () => {
	const RUN_MINUTE = 10
	const SIBLING_MINUTE = 4
	const EARLY_MINUTE = 2
	const LATER_MINUTE = 20

	it('leaves out a session whose only marker names another run', () => {
		const split = separate([
			[RUN_SESSION, session([naming(RUN_MINUTE, ISSUE)])],
			[OTHER_SESSION, session([naming(EARLY_MINUTE, OTHER_ISSUE)])],
		])

		expect(split.kept.size).toBe(ONE_SESSION)
		expect(split.kept.has(RUN_SESSION)).toBe(true)
		expect(split.is_separated).toBe(true)
	})

	// The parent dispatched this child; its own spans are the batch's coordination, and counting them
	// gave every child of one parent that parent's `started_at`.
	it('drops the dispatching parent own spans when only a unit named the issue', () => {
		const parent = session([work(EARLY_MINUTE)], [naming(RUN_MINUTE, ISSUE)])
		const split = separate([[RUN_SESSION, parent]])

		expect(split.kept.get(RUN_SESSION)?.own.size).toBe(NO_SPANS)
		expect(split.kept.get(RUN_SESSION)?.delegated.size).toBe(ONE_SPAN)
	})

	// A parent's units are pooled under one key, so the sibling that ran first is in the same half. The
	// marker says where this run began, which is the only thing that tells the two apart.
	it('takes the unit half from the run declaration, leaving an earlier sibling out', () => {
		const parent = session([], [work(SIBLING_MINUTE), naming(RUN_MINUTE, ISSUE), work(RUN_MINUTE)])
		const split = separate([[RUN_SESSION, parent]])

		expect(split.kept.get(RUN_SESSION)?.delegated.size).toBe(TWO_SPANS)
	})

	// The floor alone left the child that ran *first* absorbing every later sibling, so the next
	// declaration closes the window as well.
	it('ends the unit half at the next declaration, leaving a later sibling out', () => {
		const later = LATER_MINUTE
		const parent = session(
			[],
			[naming(EARLY_MINUTE, ISSUE), naming(later, OTHER_ISSUE), work(later)],
		)
		const split = separate([[RUN_SESSION, parent]])

		expect(split.kept.get(RUN_SESSION)?.delegated.size).toBe(ONE_SPAN)
	})
})

describe('time_sessions.separate on what a named marker leaves behind', () => {
	const RUN_MINUTE = 10
	const EARLY_MINUTE = 2

	// A run that spanned two sessions where only the first wrote the label: the second carries the
	// number-less skill-load marker alone, and deciding the test once per corpus dropped it.
	it('keeps a session of the same run that declared no issue at all', () => {
		const split = separate([
			[RUN_SESSION, session([naming(RUN_MINUTE, ISSUE)])],
			[OTHER_SESSION, run_session()],
		])

		expect(split.kept.size).toBe(TWO_SESSIONS)
		expect(split.excluded).toStrictEqual([])
	})

	// The parent of a delegated run keeps its own spans out of the child, and they have to show up as
	// excluded — minutes in neither half are minutes the report cannot account for.
	it('reports the parent minutes the narrowing dropped as excluded', () => {
		const parent = session([work(EARLY_MINUTE)], [naming(RUN_MINUTE, ISSUE)])
		const split = separate([[RUN_SESSION, parent]])

		expect(split.excluded).toStrictEqual([
			{ session_id: RUN_SESSION, duration_ms: ONE_MINUTE * MINUTE_MS },
		])
	})

	// A session that opened the workflow but never wrote the label names nothing, so the presence test
	// is still what decides — the older rule kept behind the newer one, not replaced by it.
	it('falls back to the presence test when no marker names the issue', () => {
		const split = separate([
			[RUN_SESSION, run_session()],
			[OTHER_SESSION, bystander(TWO_MINUTES)],
		])

		expect(split.kept.has(RUN_SESSION)).toBe(true)
		expect(split.excluded).toHaveLength(ONE_SESSION)
	})
})

describe('time_sessions.separate with every session marked', () => {
	// A resumed transcript copies the earlier lines, marker included, so both halves of a run that
	// spanned sessions are the run's.
	it('keeps them all and excludes nothing', () => {
		const split = separate([
			[RUN_SESSION, run_session()],
			[OTHER_SESSION, run_session(TWO_MINUTES)],
		])

		expect(split.kept.size).toBe(TWO_SESSIONS)
		expect(split.excluded).toStrictEqual([])
		expect(split.is_separated).toBe(true)
	})
})
