import { claude_result_event, type ClaudeResultEvent } from './claude-result-event'

// The exit record of a dispatched lane child — the terminal `result` event a `claude -p` session
// writes as the last line of its transcript (joshuafolkken/kit#2139). `run:ending` classifies how a
// child ended from it, so this reads the *record*, not the liveness state `agent-event.ts` folds a
// transcript into: `subtype`, `num_turns` and `permission_denials` are dropped by that fold, and they
// are exactly what a park comment has to name.
//
// **The last result event wins.** A transcript can carry more than one `result` line — a resumed
// session appends its own — so the record read back is the final one, found by scanning to the end
// rather than stopping at the first. A line that is not a result event, or not JSON at all, is passed
// over; a transcript with no result event at all reads as `undefined`, which the classifier treats as
// an unreadable ending rather than guessing one.

function parse_line(line: string): unknown {
	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}

function read_exit_record(transcript: string): ClaudeResultEvent | undefined {
	return transcript
		.split('\n')
		.map((line) => claude_result_event.decode(parse_line(line)))
		.findLast((record) => record !== undefined)
}

const agent_exit_record = { read_exit_record }

export { agent_exit_record }
