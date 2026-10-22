import { json_value } from '#scripts/lib/json-value'
import { claude_result_event, type ClaudeResultEvent } from './claude-result-event'

// The exit record of a dispatched lane child — the terminal `result` event a `claude -p` session
// writes as the last line of its transcript. `run:ending` classifies how a
// child ended from it, so this reads the *record*, not the liveness state `agent-event.ts` folds a
// transcript into: `subtype`, `num_turns` and `permission_denials` are dropped by that fold, and they
// are exactly what a park comment has to name.
//
// **The last result event wins.** A transcript can carry more than one `result` line — a resumed
// session appends its own — so the record read back is the final one, found by scanning to the end
// rather than stopping at the first. A line that is not a result event, or not JSON at all, is passed
// over; a transcript with no result event at all reads as `undefined`, which the classifier treats as
// an unreadable ending rather than guessing one.

function read_exit_record(transcript: string): ClaudeResultEvent | undefined {
	return transcript
		.split('\n')
		.map((line) => claude_result_event.decode(json_value.parse_or_undefined(line)))
		.findLast((record) => record !== undefined)
}

function event_type(line: string): unknown {
	const value = json_value.parse_or_undefined(line)

	return typeof value === 'object' && value !== null && 'type' in value ? value.type : undefined
}

// The Claude stream events a turn is made of — a Codex transcript's own (`turn.completed`, `error`)
// are none of these, so one never reads as killed.
const TURN_TYPES: ReadonlySet<unknown> = new Set(['system', 'assistant', 'user', 'stream_event'])

// Whether a Claude session was killed inside a turn: its last event is a turn's, not a `result`. A
// finished turn ends on a result; a background task can wake the session for another turn, and a
// process killed before that turn's result leaves other events last.
function is_mid_turn(transcript: string): boolean {
	const last = transcript
		.split('\n')
		.map((line) => event_type(line))
		.findLast((type) => type !== undefined)

	return TURN_TYPES.has(last)
}

// Whether the transcript's last line is its exit record. A log appended across launches keeps an
// earlier session's record, so a later session that died before finishing — inside a turn, or on a
// start-up error that is not JSON — leaves something else last and its own ending unread.
function ends_on_exit_record(transcript: string): boolean {
	const last = transcript.split('\n').findLast((line) => line.trim() !== '')

	return (
		last !== undefined &&
		claude_result_event.decode(json_value.parse_or_undefined(last)) !== undefined
	)
}

const agent_exit_record = { ends_on_exit_record, is_mid_turn, read_exit_record }

export { agent_exit_record }
