import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { implementation_cut } from '#scripts/rules/implementation-cut'
import { tail_commands } from '#scripts/rules/tail-commands'
import { run_cut_report } from '#scripts/run/cut/run-cut-report'
import type { LaneMarks } from './cost-run-nodes'

// Whether a lane session was ended by the implementation-phase cut.
//
// **No record of the cut outlives the resume.** `run:cut` keeps its record as a stamp the resumed
// process spends, and the `resume-impl` verdict is printed, never stored — so the one durable trace is
// the session's own `pnpm josh run:cut --impl` call and the verdict it answered with.
//
// **The guard's refusal is not that trace.** The implementation-phase guard refuses an over-threshold
// edit, but on `busy` / `unready` / `failed` / `unknown` — or an edit reissued inside its window — the
// same session carries on implementing. Only a `run:cut --impl` call whose result is the `cut` verdict
// ended the session, so that pairing is what is read, off parsed blocks rather than by searching the
// text: a transcript that merely quotes the command or the token must not count as a cut.
//
// **The ship phase is read the same way.** A relaunch after either cut opens with the same prompt, so
// what tells the pre-gate resume apart is the session's own `run:cut --resume` call answered `resume`
// — an implementation resume answers `resume-impl`, a different whole line.

const { CUT_VERDICT, RESUME_VERDICT } = run_cut_report

// An unreadable transcript reads as no cut: it is already reported as not measured through
// `is_readable`, and inventing a cut for it would skew the comparison the other way.
function took_cut_text(text: string): boolean {
	return tail_commands.answered(text, implementation_cut.takes_the_impl_cut, CUT_VERDICT)
}

function is_ship_text(text: string): boolean {
	return tail_commands.answered(text, implementation_cut.resumes_a_cut, RESUME_VERDICT)
}

// Both marks off one read of the transcript.
function lane_marks(file: SessionFile): LaneMarks {
	const text = cost_transcript.read_raw(file)

	return { took_cut: took_cut_text(text), is_ship: is_ship_text(text) }
}

const cost_run_cut = { is_ship_text, lane_marks, took_cut_text }

export { cost_run_cut }
