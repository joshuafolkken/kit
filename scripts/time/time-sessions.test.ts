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

function separate(entries: ReadonlyArray<[string, SessionSpans]>): SessionSplit {
	return time_sessions.separate(new Map(entries))
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
