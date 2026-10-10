import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { implementation_cut } from '#scripts/rules/implementation-cut'
import { run_cut_report } from '#scripts/run/cut/run-cut-report'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_transcript_line, type Block } from '#scripts/time-runtime/time-transcript-line'

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

const { CUT_VERDICT } = run_cut_report

function blocks_of(text: string): Array<Block> {
	return time_transcript_line.parse_text(text).flatMap((line) => line.blocks)
}

function is_impl_cut_call(block: Block): boolean {
	return implementation_cut.takes_the_impl_cut(time_shell.bash_command(block.input))
}

function is_cut_answer(block: Block, call_ids: ReadonlySet<string>): boolean {
	return call_ids.has(block.result_id) && block.token_lines.includes(CUT_VERDICT)
}

// An unreadable transcript reads as no cut: it is already reported as not measured through
// `is_readable`, and inventing a cut for it would skew the comparison the other way.
function took_cut_text(text: string): boolean {
	const blocks = blocks_of(text)
	const call_ids = new Set(
		blocks.filter((block) => is_impl_cut_call(block)).map((block) => block.id),
	)

	return blocks.some((block) => is_cut_answer(block, call_ids))
}

function took_cut(file: SessionFile): boolean {
	return took_cut_text(cost_transcript.read_raw(file))
}

const cost_run_cut = { took_cut, took_cut_text }

export { cost_run_cut }
