// The transcript lines a parsing suite is written from, as strings (joshuafolkken/kit#1662).
//
// `time-spans.test.ts` built these inline until the background cases joined it and the file passed
// its length limit. A second copy beside the new suite is the clone `CLAUDE.md` prohibits, in the one
// place a drift would let two suites disagree about what a transcript line looks like — so the
// builders moved here and both import them, the seam `time-phase-fixture.ts` was cut along when the
// region suites joined the phase one.
//
// **It is not `time-transcript-fixture.ts`, which writes lines to a file** for the suites that walk a
// directory. These are strings handed straight to `parse_timeline`, which is a different question and
// a different shape. **Nor is it `time-spans-turns.test.ts`'s**: those builders write a `message.id`
// that these deliberately do not, and every case in that suite turns on the field — the reason
// recorded there when it was cut out.

const ASSISTANT_LINE = 'assistant'
const USER_LINE = 'user'
// The two line kinds the harness writes an end-of-task notice on outside the conversation
// (joshuafolkken/kit#1696). Neither yields a timeline event — `to_event` keeps only assistant and user
// lines — which is exactly why a fixture writing them as user lines would measure a timeline the real
// carriers never produce.
const QUEUE_LINE = 'queue-operation'
const ATTACHMENT_LINE = 'attachment'
const MINUTE_MS = 60_000
// A fixed clock, so a failure reads the same a year from now as it does today.
const FIXTURE_YEAR = 2026
const FIXTURE_MONTH = 0
const FIXTURE_DAY = 1
const FIXTURE_HOUR = 0

function at(minute: number): string {
	return new Date(
		Date.UTC(FIXTURE_YEAR, FIXTURE_MONTH, FIXTURE_DAY, FIXTURE_HOUR, minute),
	).toISOString()
}

function assistant_text(minute: number): string {
	return JSON.stringify({
		type: ASSISTANT_LINE,
		timestamp: at(minute),
		message: { content: [{ type: 'text', text: 'hello' }] },
	})
}

function tool_use(minute: number, name: string, id: string, input: unknown = {}): string {
	return JSON.stringify({
		type: ASSISTANT_LINE,
		timestamp: at(minute),
		message: { content: [{ type: 'tool_use', name, id, input }] },
	})
}

// One `tool_result` block, with the body a case cares about and `is_error` written only where one was
// given (joshuafolkken/kit#1309): the tools that report no outcome write the field nowhere rather
// than writing `false`, and that third state is what a span reads as `unknown`.
function result_block(id: string, content: string, is_error?: boolean): Record<string, unknown> {
	const block = { type: 'tool_result', tool_use_id: id, content }

	return is_error === undefined ? block : { ...block, is_error }
}

function result_line(minute: number, block: Record<string, unknown>): string {
	return JSON.stringify({
		type: USER_LINE,
		timestamp: at(minute),
		message: { content: [block] },
	})
}

function tool_result(minute: number, id: string, is_error?: boolean): string {
	return result_line(minute, result_block(id, 'done', is_error))
}

// The same result with a body of its own, for the one reading that is about what the harness wrote
// back rather than about whether the call failed (joshuafolkken/kit#1662).
function tool_result_body(minute: number, id: string, content: string): string {
	return result_line(minute, result_block(id, content))
}

// The notice the harness writes when a task it took into the background ends
// (joshuafolkken/kit#1696). Only the two tags the reading needs are written: the harness adds an
// output-file line and a summary, and a fixture that restated them would fix its wording in a test
// that is not about it.
function notice_text(background_id: string): string {
	return `<task-notification>\n<task-id>${background_id}</task-id>\n<status>completed</status>\n</task-notification>`
}

// The notice as it enters the conversation: a user line whose whole content is the notice — a bare
// string rather than a block, so a suite about a background window cannot express its subject with
// `tool_result` alone.
function task_notification(minute: number, background_id: string): string {
	return JSON.stringify({
		type: USER_LINE,
		timestamp: at(minute),
		message: { content: notice_text(background_id) },
	})
}

// The same notice as the harness first writes it, on a line of its own kind that carries no `message`
// at all. **This is the carrier most sessions actually hold**, and a run measured only against the
// conversational one above came back unmeasured whenever a session held this one instead.
function queued_notification(minute: number, background_id: string): string {
	return JSON.stringify({
		type: QUEUE_LINE,
		operation: 'enqueue',
		timestamp: at(minute),
		content: notice_text(background_id),
	})
}

// The third carrier: the notice as it is handed to the run, inside an attachment rather than a
// message. Written last of the three, which is why the earliest instant is what a launch is paired to.
function attached_notification(minute: number, background_id: string): string {
	return JSON.stringify({
		type: ATTACHMENT_LINE,
		timestamp: at(minute),
		attachment: { type: 'queued_command', prompt: notice_text(background_id) },
	})
}

function prompt(minute: number): string {
	return JSON.stringify({
		type: USER_LINE,
		timestamp: at(minute),
		message: { content: 'do the thing' },
	})
}

const time_line_fixture = {
	ASSISTANT_LINE,
	MINUTE_MS,
	at,
	assistant_text,
	prompt,
	attached_notification,
	queued_notification,
	task_notification,
	tool_result,
	tool_result_body,
	tool_use,
}

export { time_line_fixture }
