import { text } from 'node:stream/consumers'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { stamp_file } from './stamp-file'

// **The main model, recorded when the session starts** (joshuafolkken/kit#5761). Claude Code's
// prompt payload names no model, and a transcript names one only from its first assistant entry, so
// the `session-lang` handoff line could not tell Fable from Opus on the first prompt. The SessionStart
// payload does carry `model`: the session-start hook records it per transcript path, and the main
// model reader answers it last — after the payload and the transcript, which follow a `/model` switch.
//
// **Written by the process the session start already runs** (`audit-provision --session-start`), as
// `session-owner-pin.ts` is, so the record adds no spawn to the launch. A payload without both fields
// leaves no record, and a failed write costs only the record: a missing one keeps the rule silent.

const RECORD_PREFIX = 'josh-session-model-'
const RECORD_SUFFIX = '.txt'

// Both fields or no record: a missing, `null` or empty one fails the parse.
const payload_schema = z.object({
	transcript_path: z.string().min(1),
	model: z.string().min(1),
})

function record_path(transcript_path: string): string {
	return stamp_file.stamp_path(RECORD_PREFIX, transcript_path, RECORD_SUFFIX)
}

// Never throws: this runs at session start beside the scanner provisioning.
function record(raw_payload: string): string | undefined {
	const payload = json_value.parse_with(raw_payload, payload_schema)
	if (payload === undefined) return undefined

	try {
		stamp_file.write_text_stamp(record_path(payload.transcript_path), payload.model)
	} catch {
		return undefined
	}

	return payload.model
}

// The model recorded for this transcript, or `undefined` when it has no readable record.
function recorded(transcript_path: string | null | undefined): string | undefined {
	if (transcript_path === undefined || transcript_path === null) return undefined
	const model = stamp_file.read_stamp_text(record_path(transcript_path))?.trim()

	return model === '' ? undefined : model
}

// A terminal run (`josh session:lang`, `josh audit:provision --session-start`) has no payload to wait for.
async function read_stdin(): Promise<string> {
	return process.stdin.isTTY ? '' : await text(process.stdin)
}

async function record_from_stdin(): Promise<string | undefined> {
	return record(await read_stdin())
}

const session_model_record = { read_stdin, record, record_from_stdin, record_path, recorded }

export { session_model_record }
