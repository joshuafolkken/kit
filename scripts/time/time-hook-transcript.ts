import path from 'node:path'
import { cost_transcript } from '#scripts/cost/cost-transcript'

// Which transcript a Claude Code hook payload is actually about (joshuafolkken/kit#1424).
//
// **A hook fired for a forked agent's tool call is handed the *parent* session's transcript.** Both
// events this package wires carry the same session fields, and neither of them names the fork's own
// file: `transcript_path` is `<projects>/<slug>/<session-id>.jsonl` whatever agent issued the call,
// and the fork is identified by a separate `agent_id`. Its transcript sits one level down, at
// `<projects>/<slug>/<session-id>/subagents/agent-<agent-id>.jsonl`.
//
// **So every reader built on `transcript_path` alone has been reading the wrong run inside a fork**,
// and two of them are: the batching guard (joshuafolkken/kit#1390) and the live density line
// (joshuafolkken/kit#1329). Measured on 551 forked review agents in this checkout, the guard refused
// **zero** calls — while a replay of the same transcripts through the fork's own file refuses 1–4 per
// review round. The parent's timeline is frozen for as long as a fork runs, because the fork's lines
// go to the fork's file: its open sequence never advances, so it either never reaches the limit or
// reaches it once and can never qualify again. The density line has the matching symptom — inside a
// fork it reports the *parent's* calls per round trip, which is a number about a run the reader is
// not in.
//
// **The keys were already meant to be per-fork.** Both hooks key their throttle and refusal records
// on the transcript the payload names, each documenting that this is what gives "a delegated child …
// a run of its own". That claim only becomes true here.
//
// **A named agent's answer is its own path whether or not that file exists yet, and never the
// parent's.** The fork's first call has nothing written under it, and "no history" is the honest
// verdict there — both callers already turn an unreadable transcript into silence, which is the
// failure direction each of them states. Falling back to the parent instead would judge the fork on a
// timeline it never ran and, worse, spend the *parent's* refusal record: the parent is often mid-streak
// exactly when it delegates, so its next genuine third single-call turn would be admitted in silence.

// **The directory and the extension come from `cost-transcript.ts`, which walks this same layout to
// discover the units a session delegated** — a path rebuilt by hand here would be free to disagree
// with the one that discovery reads.
const { TRANSCRIPT_EXTENSION } = cost_transcript
// **The file-name prefix is stated here, because that module never spells it**: it lists `*.jsonl` and
// takes the id from whatever it finds. So this one constant can drift from Claude Code, and the
// direction it drifts in is the safe one — a renamed prefix makes the derived path absent, which both
// callers already read as "nothing to say" rather than as a verdict about some other file.
const AGENT_PREFIX = 'agent-'
// **Letters, digits, `_` and `-` only, because this value is joined into a path.** An id carrying a
// separator or a `..` segment would resolve outside the session's own directory, and a hook payload is
// input rather than something this package produced. A spelling the pattern rejects reads as "no fork
// named", which falls back to the payload's own path.
const AGENT_ID_PATTERN = /^[\w-]+$/u

// **`null` is accepted alongside `undefined` rather than rejected**, because a payload spelling the
// absent agent as `null` must read as "no fork" and not as a payload the caller's schema throws out —
// which would take both hooks off the main line entirely, in silence.
function is_agent_id(value: string | null | undefined): value is string {
	return typeof value === 'string' && AGENT_ID_PATTERN.test(value)
}

// Where the fork's transcript sits, given the session file the payload named. **Exported so a test —
// and any later caller — can name the file without spelling the layout again**, which is the same
// reason `cost-transcript.ts` exports `unit_directory`.
function fork_path(transcript_path: string, agent_id: string): string {
	const directory = path.dirname(transcript_path)
	const session_id = path.basename(transcript_path, TRANSCRIPT_EXTENSION)
	const file_name = `${AGENT_PREFIX}${agent_id}${TRANSCRIPT_EXTENSION}`

	return path.join(cost_transcript.unit_directory(directory, session_id), file_name)
}

// The transcript a hook should read and key its record on, given the two fields the payload carries.
//
// **A path that is not a transcript is answered with itself**, since nothing can be derived from it and
// guessing would name a file in some other layout entirely.
function transcript_of(transcript_path: string, agent_id: string | null | undefined): string {
	if (!is_agent_id(agent_id)) return transcript_path
	if (!transcript_path.endsWith(TRANSCRIPT_EXTENSION)) return transcript_path

	return fork_path(transcript_path, agent_id)
}

const time_hook_transcript = {
	fork_path,
	transcript_of,
}

export { time_hook_transcript }
