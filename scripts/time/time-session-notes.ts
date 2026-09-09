import { time_report } from './time-report'
import { time_sessions, type SessionMinutes } from './time-sessions'

// What the report says about the sessions the separation kept, dropped and could not tell apart
// (joshuafolkken/kit#1428, joshuafolkken/kit#1673).
//
// **The notes moved out of `time-run.ts` because they grew a third sentence and that file had two
// lines of headroom left.** They are one subject — the separation, said out loud — and the predicate
// that recognizes them belongs beside the text it matches, or the two drift and a batch row prints an
// uncorrected figure with nothing saying so.
//
// **Two of the three sentences were wrong before this, and both for the same reason**: the split
// carried one list and one flag where it had two answers to give. The list held sessions dropped
// whole *and* the minutes trimmed off a session that was kept, and the sentence over it said "left
// out" of both — so a run whose only other session was the parent that dispatched it read as "1
// concurrent session(s) left out — S", naming the transcript the figures had just come from. And the
// flag said only whether anything was kept, so the sentence for "nothing was" claimed no session
// carried a marker, which stopped being the only way to reach that state once a marker had to *name*
// the issue (joshuafolkken/kit#1648): every session can carry one and every one of them name a
// different run.

// The facts the three sentences are written from. **Declared here rather than imported from
// `time-corpus.ts`** so the notes can be read — and tested — without a corpus: `IssueSpans` satisfies
// this structurally, and nothing else about a corpus is any of this module's business.
interface SeparationFacts {
	excluded: ReadonlyArray<SessionMinutes>
	narrowed: ReadonlyArray<SessionMinutes>
	is_separated: boolean
	has_other_run_markers: boolean
	attributed_count: number
}

const NO_SESSIONS = 0

// The three phrases the separation notes are recognized by, written once for the reason the overlap
// note's is: `--epic` prints a child's notes only where the GitHub half is missing, and a *completed*
// child is exactly where a corrected figure used to be printed with nothing saying so
// (joshuafolkken/kit#1428).
const EXCLUDED_MARK = 'no workflow marker attributes them to this run'
const NARROWED_MARK = 'these are minutes outside the window this run declared, in a session it kept'
const NOT_SEPARATED_MARK = 'the run could not be separated from them'

// **Whether a note is one of the three.** They are recognized together because a renderer that lets
// one through and not another would print a corrected figure or an inflated one — and no way to tell
// which.
function is_session_note(note: string): boolean {
	return (
		note.includes(EXCLUDED_MARK) ||
		note.includes(NARROWED_MARK) ||
		note.includes(NOT_SEPARATED_MARK)
	)
}

// **The session id and its minutes, never a count alone.** The id is what a reader opens the
// transcript by, and without the minutes the note says something was removed while hiding how much —
// which is the shape this whole separation exists to stop the report having.
function entry(one: SessionMinutes): string {
	return `${one.session_id} (${time_report.format_minutes(one.duration_ms)})`
}

function listed(sessions: ReadonlyArray<SessionMinutes>): string {
	return sessions.map((one) => entry(one)).join(', ')
}

function excluded_note(found: SeparationFacts): Array<string> {
	const { excluded } = found

	if (excluded.length === NO_SESSIONS) return []

	const count = String(excluded.length)

	return [`${count} concurrent session(s) left out — ${listed(excluded)} — ${EXCLUDED_MARK}`]
}

// **A narrowed session is kept, not left out.** Its minutes are gone from the figures exactly as an
// excluded session's are, which is why they are reported at all — but the sentence over them has to
// say which of the two happened, or the note names this run's own transcript as a stranger's.
function narrowed_note(found: SeparationFacts): Array<string> {
	const { narrowed } = found

	if (narrowed.length === NO_SESSIONS) return []

	const count = String(narrowed.length)

	return [`${count} kept session(s) narrowed — ${listed(narrowed)} dropped — ${NARROWED_MARK}`]
}

// Why nothing could be separated, which is two states rather than one. Naming the wrong one is not a
// smaller error than reporting the wrong minutes: a reader who is told no session opened a workflow
// goes looking for a missing marker that is sitting right there, naming somebody else's run.
function not_separated_reason(found: SeparationFacts): string {
	if (found.has_other_run_markers) return 'every workflow marker among them names a different run'

	return 'none carries a workflow marker'
}

// **`0.0 min` excluded and "could not be separated" are different answers, and only one of them is a
// measurement.** A corpus this command cannot cut, reported as an exclusion of nothing, would read as
// a run nobody shared — precisely the state whose figures are least trustworthy.
function not_separated_note(found: SeparationFacts, issue_number: number): Array<string> {
	if (found.is_separated || found.attributed_count < time_sessions.AMBIGUOUS_MINIMUM) return []

	const scope = `to issue #${String(issue_number)}`
	const held = `${NOT_SEPARATED_MARK}, and every figure below still holds all of them`
	const count = String(found.attributed_count)

	return [`${count} sessions are attributed ${scope} and ${not_separated_reason(found)} — ${held}`]
}

// All three, in the order a reader meets them: what was dropped whole, what was trimmed off what was
// kept, and — where neither happened — why nothing could be told apart at all.
function session_notes(found: SeparationFacts, issue_number: number): Array<string> {
	return [
		...excluded_note(found),
		...narrowed_note(found),
		...not_separated_note(found, issue_number),
	]
}

const time_session_notes = { is_session_note, session_notes }

export type { SeparationFacts }
export { time_session_notes }
