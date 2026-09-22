import {
	time_transcript_line,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'

// Verifying an agent's behavior against the transcripts every run already writes, with no live
// Claude session and no model call (joshuafolkken/kit#2365).
//
// **The mechanism that measured behavior used to be the completion gate's own, and it was removed
// for being slow rather than for being wrong.** joshuafolkken/kit#1922 took `josh eval`'s five
// scenarios out of the gate because each starts a real Claude session, so the step never ran without
// `JOSH_EVAL` and paid a prompt-and-report cost every run for nothing. What it left behind is a gate
// that proves the *machinery* works — 8,000-odd unit tests — and nothing at all that proves the
// agent *behaves*. This is the half worth keeping, separated from the half worth removing: an
// assertion read off a recorded transcript is deterministic, re-runnable and never calls a model.
//
// **The reading is single-sourced, not re-implemented.** One transcript line is parsed by
// `time-transcript-line.ts` — the reader the span walk and the guards already use — and the files are
// located and read by `cost-transcript.ts`. This module is only the assertions and the walk over the
// parsed turns; it owns no second copy of "where a transcript lives" or "how a line is shaped".

// Where in a transcript an assertion broke: which run, and which point in it. The failure names the
// next place a reader looks rather than reporting that a rule broke somewhere in a session.
interface Violation {
	// The rule that broke, by name — so a reader tells one broken assertion from another without
	// re-deriving it from the detail.
	assertion: string
	// The run the transcript belongs to. `''` until the caller that read the file stamps it, because
	// the scan knows the turn and the detail but not which session file it was handed.
	session_id: string
	// The 1-based line position of the offending turn in the transcript, so "which point" is a place
	// a reader can open rather than a description.
	position: number
	// What broke, in the assertion's own words — for the git-index rule, the command that mutated the
	// index directly.
	detail: string
}

// A violation before the session it was found in is attached. The scan produces these; the reader
// that opened the file supplies the `session_id`.
type Finding = Omit<Violation, 'session_id'>

// One behavior rule: a name, a human description, and a pure scan over the parsed turns of one
// transcript. The scan returns every point it broke, so a single transcript can report more than one
// violation and each names its own position.
interface Assertion {
	name: string
	describe: string
	scan: (lines: ReadonlyArray<TranscriptLine>) => ReadonlyArray<Finding>
}

// The parsed turns of one transcript, in file order. A line that fails to parse is dropped rather
// than dated — it has no turn to point at — exactly as `time-spans.ts` drops it.
function parse_transcript(text: string): ReadonlyArray<TranscriptLine> {
	return text
		.split('\n')
		.map((line) => time_transcript_line.parse_line(line))
		.filter((line): line is TranscriptLine => line !== undefined)
}

// Every assertion's findings over one set of parsed turns, each stamped with the session it was read
// from. The single walk the CLI and the tests share, so a synthetic transcript and a real one are
// checked the same way.
function check_lines(
	lines: ReadonlyArray<TranscriptLine>,
	session_id: string,
	assertions: ReadonlyArray<Assertion>,
): ReadonlyArray<Violation> {
	return assertions.flatMap((assertion) =>
		assertion.scan(lines).map((finding) => ({ ...finding, session_id })),
	)
}

// One transcript's raw text checked against every assertion — parsed once, then walked. The entry
// point a caller uses when it holds the text rather than the parsed lines.
function check_transcript(
	text: string,
	session_id: string,
	assertions: ReadonlyArray<Assertion>,
): ReadonlyArray<Violation> {
	return check_lines(parse_transcript(text), session_id, assertions)
}

const behavior_assertion = { parse_transcript, check_lines, check_transcript }

export type { Assertion, Finding, Violation }
export { behavior_assertion }
