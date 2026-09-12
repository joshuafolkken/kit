import { time_transcript_line } from '#scripts/time/time-transcript-line'
import { rule_value, type RuleReading } from './rule-value'

// The transcript shapes `rule_value.measure` reads, built once for every suite that scores a rule
// (joshuafolkken/kit#1867).
//
// **It exists because a row's own suite needs them as much as the measurement's does.**
// `rule-value.test.ts` owns how the reading is taken; a rule's own suite owns what that reading says
// about that rule, and both can only ask by handing in a transcript. A second copy of these four
// lines is the clone `CLAUDE.md` prohibits, in the one place where two copies would drift into
// disagreeing about what a transcript looks like — and the disagreement would be silent, because each
// suite would go on passing against its own idea of the shape.

const TIMESTAMP = '2026-09-09T00:00:00.000Z'

function tool_use_block(command: string, index: number): Record<string, unknown> {
	return { type: 'tool_use', id: `toolu_${String(index)}`, name: 'Bash', input: { command } }
}

function assistant_line(
	blocks: ReadonlyArray<unknown>,
	timestamp: string,
	message_id: string,
): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp,
		message: { id: message_id, content: blocks },
	})
}

// One transcript line carrying one tool call, in the shape `time_transcript_line.parse_line` reads.
// **It carries no message id, so it is a turn of its own** — the id is what joins lines into one
// turn, and a fixture sharing one across every call would make every session read as one batched
// turn (joshuafolkken/kit#1792).
function call_line(command: string, timestamp: string = TIMESTAMP): string {
	return assistant_line([tool_use_block(command, 0)], timestamp, time_transcript_line.NO_MESSAGE_ID)
}

// An errored result, which is the shape a delivered refusal is written back in.
function result_line(content: string, timestamp: string = TIMESTAMP): string {
	return JSON.stringify({
		type: 'user',
		timestamp,
		message: { content: [{ type: 'tool_result', content, is_error: true }] },
	})
}

// One run's worth of lone calls, in the order given.
function session(...commands: ReadonlyArray<string>): string {
	return commands.map((command) => call_line(command)).join('\n')
}

// One row's reading out of a measurement. **The throw is the point**: a renamed or dropped row would
// otherwise reach an assertion as `undefined` and read as a row that simply scored nothing.
function reading_for(id: string, runs: ReadonlyArray<ReadonlyArray<string>>): RuleReading {
	const found = rule_value.measure(runs).find((reading) => reading.id === id)

	if (found === undefined) throw new Error(`no reading for ${id}`)

	return found
}

const rule_value_fixture = {
	TIMESTAMP,
	reading_for,
	assistant_line,
	call_line,
	result_line,
	session,
	tool_use_block,
}

export { rule_value_fixture }
