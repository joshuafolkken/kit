import { time_spans, type Span } from './time-spans'

// How a run's session ended, decided mechanically from its spans (joshuafolkken/kit#1912).
//
// A run measured across sessions could not say which of them merged and which stopped — the hand
// measurement of `fullrun #1876` had to read the transcript by eye to find that the *first* session
// stopped on a red gate and the second merged. This reads that off the spans instead:
//
// - **merged** — the session ran `pnpm josh followup` to success, and its stage block reached the
//   `merge` lap. That is the one unambiguous "this session finished the work" signal; a followup that
//   was blocked exits non-zero (a failed span) and its stages end at `interrupted` instead.
// - **stopped** — no merge, and at least one command failed. The last failed command is named, which
//   is what the hand measurement had to search the transcript for.
// - **not detected** — neither, which is a real answer (a lane child cut mid-work, a session that
//   ended cleanly without merging) and never reported as a merge or a stop it was not.

type SessionEnd = 'merged' | 'stopped' | 'not_detected'

interface EndState {
	state: SessionEnd
	// Named only for a `stopped` session: the josh command (or tool label) of its last failed span.
	last_failed_command?: string
}

const FOLLOWUP_COMMAND = 'josh followup'
const MERGE_STAGE = 'merge'
const NO_COMMAND = ''

function is_merge(span: Span): boolean {
	return (
		span.josh_command === FOLLOWUP_COMMAND &&
		span.outcome === time_spans.OK_OUTCOME &&
		span.followup_stages.some((stage) => stage.name === MERGE_STAGE)
	)
}

// A failed span's name: its josh command where it ran one, otherwise the raw tool label.
function command_of(span: Span): string {
	return span.josh_command === NO_COMMAND ? span.label : span.josh_command
}

function last_failed(spans: ReadonlyArray<Span>): Span | undefined {
	const failed = spans.filter((span) => span.outcome === time_spans.FAILED_OUTCOME)

	return failed.at(-1)
}

function classify(spans: ReadonlyArray<Span>): EndState {
	if (spans.some((span) => is_merge(span))) return { state: 'merged' }

	const failed = last_failed(spans)

	if (failed !== undefined) return { state: 'stopped', last_failed_command: command_of(failed) }

	return { state: 'not_detected' }
}

const time_session_end_state = { classify }

export type { EndState, SessionEnd }
export { time_session_end_state }
