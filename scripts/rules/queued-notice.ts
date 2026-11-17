import { json_value } from '#scripts/lib/json-value'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { z } from 'zod'

// The completion notices the harness has queued for this session and not yet delivered
// (joshuafolkken/kit#7749).
//
// **A queued notice resumes the session at once.** The harness writes a `queue-operation` line when a
// background task's notice enters the queue, and that line already carries the `<task-notification>`,
// so `lane_background` reads the task as finished from that instant. A turn that ends in the second
// between the enqueue and the delivery looks idle to the Stop hook, which released the hold and
// stripped `in-progress` from a lane that went on to ship (#7703).
//
// **The queue is read in order, first in first out.** An `enqueue` adds its item, a `dequeue` takes the
// oldest, a `remove` takes the one it names, and the notice's own delivery line takes it as well. An
// item that carries no notice — a queued prompt — holds its place as `NO_NOTICE`, so a `dequeue` of it
// does not take a notice queued behind it.
//
// `TranscriptLine.finished_background` is left as it is: the measurement side reads the enqueue as the
// task's end, which it is.

const NO_NOTICE = ''
const ENQUEUE = 'enqueue'
const DEQUEUE = 'dequeue'

const queue_line_schema = z.object({ type: z.literal('queue-operation'), operation: z.string() })

function queue_operation(line: string): string | undefined {
	return json_value.parse_with(line, queue_line_schema)?.operation
}

function notice_id(line: string): string {
	return time_transcript_line.parse_line(line)?.finished_background ?? NO_NOTICE
}

function delete_first(queued: Array<string>, id: string): void {
	const index = queued.indexOf(id)

	if (index !== -1) queued.splice(index, 1)
}

function apply_line(queued: Array<string>, line: string): void {
	const operation = queue_operation(line)
	const id = notice_id(line)

	switch (operation) {
		case ENQUEUE: {
			queued.push(id)
			break
		}

		case DEQUEUE: {
			queued.shift()
			break
		}

		default: {
			if (operation !== undefined || id !== NO_NOTICE) delete_first(queued, id)
		}
	}
}

// The ids of the task notices queued on the transcript tail and not yet delivered.
function queued_notice_ids(tail: string): ReadonlyArray<string> {
	const queued: Array<string> = []

	for (const line of tail.split('\n')) apply_line(queued, line)

	return queued.filter((id) => id !== NO_NOTICE)
}

const queued_notice = { queued_notice_ids }

export { queued_notice }
