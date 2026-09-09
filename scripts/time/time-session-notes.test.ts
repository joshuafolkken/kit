import { describe, expect, it } from 'vitest'
import { time_session_notes, type SeparationFacts } from './time-session-notes'

// What the separation notes say, read as a reader meets them (joshuafolkken/kit#1673). Two of the
// three sentences described a separation the command had stopped performing: minutes trimmed off a
// session the run *kept* were announced as a concurrent session left out, and "none carries a
// workflow marker" was printed over a corpus where every session carried one.
const ISSUE = 1673
const ONE_MINUTE_MS = 60_000
const TWO_MINUTES_MS = 120_000
const ONE_SESSION = 1
const TWO_SESSIONS = 2
const NO_NOTES = 0
const NOTE_SEPARATOR = '\n'
const NO_MARKER_REASON = 'none carries a workflow marker'
// A session dropped whole, and the minutes trimmed off one that was kept — the pair whose sentences
// have to differ.
const LEFT_OUT = [{ session_id: 'other', duration_ms: TWO_MINUTES_MS }]
const NARROWED = [{ session_id: 'parent', duration_ms: ONE_MINUTE_MS }]
const NOT_SEPARATED = { is_separated: false, attributed_count: TWO_SESSIONS }

function facts(over: Partial<SeparationFacts> = {}): SeparationFacts {
	return {
		excluded: [],
		narrowed: [],
		is_separated: true,
		has_other_run_markers: false,
		attributed_count: ONE_SESSION,
		...over,
	}
}

function notes_of(over: Partial<SeparationFacts> = {}): string {
	return time_session_notes.session_notes(facts(over), ISSUE).join(NOTE_SEPARATOR)
}

describe('time_session_notes.session_notes', () => {
	it('says nothing where one session held the whole run', () => {
		expect(time_session_notes.session_notes(facts(), ISSUE)).toHaveLength(NO_NOTES)
	})

	it('names a session left out whole with its minutes', () => {
		const notes = notes_of({
			excluded: LEFT_OUT,
		})

		expect(notes).toContain('1 concurrent session(s) left out')
		expect(notes).toContain('other (2.0 min)')
	})

	// A narrowed session is in `kept`. Announcing it as one left out named the run's own transcript as
	// a stranger's — with a single dispatching parent, the note read "1 concurrent session(s) left out
	// — S" over figures that had just come out of S.
	it('reports narrowed minutes as narrowing rather than as a session left out', () => {
		const notes = notes_of({
			narrowed: NARROWED,
		})

		expect(notes).toContain('1 kept session(s) narrowed')
		expect(notes).toContain('parent (1.0 min) dropped')
		expect(notes).not.toContain('left out')
	})

	it('keeps the two apart when a run both left one session out and narrowed another', () => {
		const notes = time_session_notes.session_notes(
			facts({
				excluded: LEFT_OUT,
				narrowed: NARROWED,
			}),
			ISSUE,
		)

		expect(notes).toHaveLength(TWO_SESSIONS)
		expect(notes[0]).toContain('concurrent session(s) left out')
		expect(notes[1]).toContain('kept session(s) narrowed')
	})
})

describe('time_session_notes.session_notes on a run it could not separate', () => {
	it('says no session carries a marker when none does', () => {
		const notes = notes_of(NOT_SEPARATED)

		expect(notes).toContain('2 sessions are attributed to issue #1673')
		expect(notes).toContain(NO_MARKER_REASON)
		expect(notes).toContain('the run could not be separated from them')
	})

	// Requiring a marker to *name* the issue made a second way to reach this state, and the sentence
	// written for the first one states a reason that is false of it: the markers are right there.
	it('says the markers name a different run rather than that there are none', () => {
		const notes = notes_of({ ...NOT_SEPARATED, has_other_run_markers: true })

		expect(notes).toContain('every workflow marker among them names a different run')
		expect(notes).not.toContain(NO_MARKER_REASON)
	})

	// One session is the run's whether or not it left a marker, so there is nothing to separate and
	// nothing to say about it.
	it('says nothing where a single session was attributed', () => {
		expect(notes_of({ is_separated: false })).toBe('')
	})
})

describe('time_session_notes.is_session_note', () => {
	it('recognizes all three sentences, so a batch row prints none of them uncorrected', () => {
		const dropped = time_session_notes.session_notes(
			facts({
				excluded: LEFT_OUT,
				narrowed: NARROWED,
			}),
			ISSUE,
		)
		const every = [...dropped, ...time_session_notes.session_notes(facts(NOT_SEPARATED), ISSUE)]

		expect(every.every((note) => time_session_notes.is_session_note(note))).toBe(true)
	})

	it('does not claim a note it did not write', () => {
		expect(time_session_notes.is_session_note('2 transcript(s)')).toBe(false)
	})
})
