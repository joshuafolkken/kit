import type { ChildProcess } from 'node:child_process'
import { writeSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

const EVENT_SCHEMA = z.looseObject({ type: z.string(), timestamp: z.string().optional() })

// Codex's stream has no event times. Save arrival at the recording boundary, never at board read.
function stamped_line(line: string, timestamp: string): string {
	const event = EVENT_SCHEMA.safeParse(json_value.parse_or_undefined(line)).data
	if (event === undefined) return line

	return JSON.stringify({ ...event, timestamp: event.timestamp ?? timestamp })
}

function record(
	child: ChildProcess,
	log: number | undefined,
	on_error: (note: string) => void,
): void {
	if (child.stdout === null) return
	const lines = createInterface({ input: child.stdout })

	lines.on('line', (line) => {
		if (log === undefined) return

		try {
			writeSync(log, `${stamped_line(line, new Date().toISOString())}\n`)
		} catch (error) {
			on_error(`the session log could not be written: ${String(error)}`)
		}
	})
}

const attached_log = { record, stamped_line }

export { attached_log }
