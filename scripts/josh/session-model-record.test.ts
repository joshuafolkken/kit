import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { session_model_record } from './session-model-record'
import { stamp_file } from './stamp-file'

// joshuafolkken/kit#5761: the main model the SessionStart payload names, recorded per transcript.

const { record, recorded, record_path } = session_model_record

const FABLE = 'claude-fable-5-1'

const written: Array<string> = []

afterEach(() => {
	vi.restoreAllMocks()
	for (const transcript of written.splice(0)) stamp_file.remove_stamp(record_path(transcript))
})

function new_transcript(): string {
	const transcript = path.join(tmpdir(), `${randomUUID()}.jsonl`)

	written.push(transcript)

	return transcript
}

function payload_on(transcript: string): string {
	return JSON.stringify({ transcript_path: transcript, model: FABLE })
}

describe('session_model_record — the record', () => {
	it('reads back the model recorded for a transcript', () => {
		const transcript = new_transcript()

		expect(record(payload_on(transcript))).toBe(FABLE)
		expect(recorded(transcript)).toBe(FABLE)
	})

	it('keeps one transcript record apart from another', () => {
		record(payload_on(new_transcript()))

		expect(recorded(new_transcript())).toBeUndefined()
	})

	it('answers undefined for an absent transcript path', () => {
		expect(recorded(undefined)).toBeUndefined()
	})

	it('never throws when the record cannot be written', () => {
		vi.spyOn(stamp_file, 'write_text_stamp').mockImplementation(() => {
			throw new Error('EACCES')
		})
		const payload = payload_on(new_transcript())

		expect(record(payload)).toBeUndefined()
	})
})

describe('session_model_record — a payload that records nothing', () => {
	it.each([
		['no model', '{"transcript_path":"x.jsonl"}'],
		['a null model', '{"transcript_path":"x.jsonl","model":null}'],
		['an empty model', '{"transcript_path":"x.jsonl","model":""}'],
		['no transcript', `{"model":"${FABLE}"}`],
		['a malformed body', '{"model":'],
		['an empty body', ''],
	])('records nothing for %s', (_name, payload) => {
		expect(record(payload)).toBeUndefined()
	})

	it('reads no payload from a terminal', async () => {
		const is_tty = process.stdin.isTTY

		process.stdin.isTTY = true
		// The TTY test runs before the first await, so the flag is put back before the read settles.
		const read = session_model_record.record_from_stdin()

		process.stdin.isTTY = is_tty
		await expect(read).resolves.toBeUndefined()
	})
})
