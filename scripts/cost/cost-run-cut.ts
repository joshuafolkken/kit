import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { implementation_cut } from '#scripts/rules/implementation-cut'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'

// Whether a lane session was ended by the implementation-phase cut (joshuafolkken/kit#3223).
//
// **No record of the cut outlives the resume.** `run:cut` keeps its record as a stamp the resumed
// process spends, and the `resume-impl` verdict is printed, never stored — so the one durable trace is
// the guard's own refusal in the transcript of the session it ended. That refusal is what is read here:
// the guard refuses every edit past the threshold until the cut is taken, so a session carrying it is a
// session the cut ended.
//
// **A refusal is read off a parsed errored result, never by searching the text.** A transcript that
// merely quotes the reason — a review reading `implementation-cut.ts`, this file's own test — must not
// count as a cut, which is the same reason `time-transcript-line.ts` reads the guard off the opening.

// The guard label is the one `implementation-cut.ts` builds its reason from, so the reader and the
// writer cannot drift apart.
const { IMPLEMENTATION_CUT_GUARD } = implementation_cut

function line_took_cut(line: string): boolean {
	const parsed = time_transcript_line.parse_line(line)

	return parsed?.blocks.some((block) => block.refusal_guard === IMPLEMENTATION_CUT_GUARD) ?? false
}

// An unreadable transcript reads as no cut: it is already reported as not measured through
// `is_readable`, and inventing a cut for it would skew the comparison the other way.
function took_cut_text(text: string): boolean {
	return text.split('\n').some((line) => line_took_cut(line))
}

function took_cut(file: SessionFile): boolean {
	return took_cut_text(cost_transcript.read_raw(file))
}

const cost_run_cut = { IMPLEMENTATION_CUT_GUARD, took_cut, took_cut_text }

export { cost_run_cut }
