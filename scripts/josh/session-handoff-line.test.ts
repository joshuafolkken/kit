import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { session_handoff_line } from './session-handoff-line'
import { session_model_record } from './session-model-record'
import { stamp_file } from './stamp-file'

const { LINE_PREFIX, handoff_line } = session_handoff_line

const FABLE = 'claude-fable-5-1'
const OPUS = 'claude-opus-5-5'
const ASTRA = 'gpt-6.1-astra'
const SOL = 'gpt-6.1-sol'

const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'session-handoff-line-'))

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

const FULLRUN = 'fullrun #1'

function transcript_on(model: string): string {
	const file = path.join(WORK_DIRECTORY, `${randomUUID()}.jsonl`)

	writeFileSync(file, `${JSON.stringify({ type: 'assistant', message: { model, content: [] } })}\n`)

	return file
}

function claude_payload(model: string, prompt: string): string {
	return JSON.stringify({ prompt, transcript_path: transcript_on(model) })
}

function codex_payload(model: string, prompt: string): string {
	return JSON.stringify({ prompt, transcript_path: transcript_on('<synthetic>'), model })
}

describe('handoff_line', () => {
	it('points a workflow keyword on Fable at run:handoff', () => {
		const line = handoff_line(claude_payload(FABLE, FULLRUN))

		expect(line).toContain(LINE_PREFIX)
		expect(line).toContain('pnpm josh run:handoff fullrun')
	})

	it('names backlogrun too, without the brief josh backlogrun refuses', () => {
		const line = handoff_line(claude_payload(FABLE, 'backlogrun #2'))

		expect(line).toContain('run:handoff backlogrun')
		expect(line).not.toContain('--brief-file')
	})

	it('says nothing on Opus', () => {
		expect(handoff_line(claude_payload(OPUS, FULLRUN))).toBe('')
	})

	it('says nothing on Fable without a workflow keyword', () => {
		expect(handoff_line(claude_payload(FABLE, 'what does #1 change?'))).toBe('')
	})

	it('reads the model off a Codex payload: Astra gets the line', () => {
		expect(handoff_line(codex_payload(ASTRA, FULLRUN))).toContain(LINE_PREFIX)
	})

	it('reads the model off a Codex payload: Sol 6.1 gets none', () => {
		expect(handoff_line(codex_payload(SOL, FULLRUN))).toBe('')
	})
})

describe('handoff_line on an unusual payload', () => {
	it('reads an uppercase or punctuated keyword', () => {
		expect(handoff_line(claude_payload(FABLE, '`Fullrun`, #1'))).toContain('run:handoff fullrun')
	})

	it('reads a null model and transcript as absent', () => {
		expect(handoff_line('{"prompt":"fullrun #1","transcript_path":null,"model":null}')).toBe('')
	})

	it('says nothing for an empty or malformed payload', () => {
		expect(handoff_line('')).toBe('')
		expect(handoff_line('{"prompt":')).toBe('')
	})

	it('reads no payload from a terminal', async () => {
		const is_tty = process.stdin.isTTY

		process.stdin.isTTY = true
		// The TTY test runs before the first await, so the flag is put back before the read settles.
		const read = session_handoff_line.read_stdin()

		process.stdin.isTTY = is_tty
		await expect(read).resolves.toBe('')
	})

	it.each([
		[FABLE, true],
		[OPUS, false],
	])('reads the model recorded at session start (%s) on an empty transcript', (model, fires) => {
		const transcript = path.join(WORK_DIRECTORY, `${randomUUID()}.jsonl`)

		writeFileSync(transcript, '')
		session_model_record.record(JSON.stringify({ transcript_path: transcript, model }))
		const line = handoff_line(JSON.stringify({ prompt: FULLRUN, transcript_path: transcript }))

		stamp_file.remove_stamp(session_model_record.record_path(transcript))
		expect(line.includes(LINE_PREFIX)).toBe(fires)
	})

	it('falls back to the payload model when the transcript cannot be read', () => {
		const missing = path.join(WORK_DIRECTORY, 'missing.jsonl')
		const payload = JSON.stringify({ prompt: FULLRUN, transcript_path: missing, model: FABLE })

		expect(handoff_line(payload)).toContain(LINE_PREFIX)
	})
})
