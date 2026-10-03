import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { step_zero_notice } from './step-zero-notice'

const ROOT = '/repo'
const RUNTIME_FILE = '/repo/scripts/hooks/example.ts'
const DOC_FILE = '/repo/docs/guide.md'
// Below `prompt-hook-brevity.test.ts`'s per-turn ceiling: the notice is still injected text.
const NOTICE_CEILING_BYTES = 256

const created: Array<string> = []

afterEach(() => {
	for (const transcript of created.splice(0)) {
		rmSync(step_zero_notice.stamp_path(transcript), { force: true })
		rmSync(path.dirname(transcript), { recursive: true, force: true })
	}
})

// A fresh transcript per case, so the once-per-session stamp never dedupes one case against another.
function fresh_transcript(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'step-zero-'))
	const transcript = path.join(directory, 'transcript.jsonl')

	created.push(transcript)

	return transcript
}

function payload(tool_name: string, tool_input: unknown, transcript_path: string): string {
	return JSON.stringify({ tool_name, tool_input, transcript_path })
}

function edit_of(file_path: string, transcript: string, tool_name = 'Edit'): string {
	return payload(tool_name, { file_path }, transcript)
}

describe('step_zero_notice — when it speaks', () => {
	it.each(['Edit', 'Write'])('reminds on the first %s of a runtime file', (tool_name) => {
		const notice = step_zero_notice.notice(
			edit_of(RUNTIME_FILE, fresh_transcript(), tool_name),
			ROOT,
		)

		expect(notice).toBe(step_zero_notice.NOTICE)
	})

	it('speaks once per session, not on every edit', () => {
		const transcript = fresh_transcript()

		expect(step_zero_notice.notice(edit_of(RUNTIME_FILE, transcript), ROOT)).toBeDefined()
		expect(step_zero_notice.notice(edit_of(RUNTIME_FILE, transcript), ROOT)).toBeUndefined()
	})

	it('stays silent on a prompt that writes nothing (a read or a shell call)', () => {
		const transcript = fresh_transcript()

		expect(
			step_zero_notice.notice(payload('Read', { file_path: RUNTIME_FILE }, transcript), ROOT),
		).toBeUndefined()
		expect(
			step_zero_notice.notice(payload('Bash', { command: 'ls' }, transcript), ROOT),
		).toBeUndefined()
	})

	it.each([DOC_FILE, '/repo/prompts/review.txt', '/elsewhere/memory/note.ts'])(
		'stays silent, without spending its stamp, on a non-runtime path %s',
		(file_path) => {
			const transcript = fresh_transcript()

			expect(step_zero_notice.notice(edit_of(file_path, transcript), ROOT)).toBeUndefined()
			expect(step_zero_notice.notice(edit_of(RUNTIME_FILE, transcript), ROOT)).toBeDefined()
		},
	)

	it('stays silent on a payload it cannot read', () => {
		expect(step_zero_notice.notice('{}', ROOT)).toBeUndefined()
	})
})

describe('step_zero_notice — a translated Codex patch', () => {
	it('reminds when the runtime file is not the first one the patch lists', () => {
		const tool_input = { file_path: DOC_FILE, file_paths: [DOC_FILE, RUNTIME_FILE] }
		const raw_payload = payload('Edit', tool_input, fresh_transcript())

		expect(step_zero_notice.notice(raw_payload, ROOT)).toBe(step_zero_notice.NOTICE)
	})
})

describe('step_zero_notice — what it says', () => {
	it.each([
		'before writing any implementation code',
		'Now / Change / Check',
		'every change with its test',
		'Code Change Rules Step 0 in CLAUDE.md',
	])('states %j', (directive) => {
		expect(step_zero_notice.NOTICE.toLowerCase()).toContain(directive.toLowerCase())
	})

	it('stays under the injected-text ceiling', () => {
		expect(Buffer.byteLength(step_zero_notice.NOTICE, 'utf8')).toBeLessThan(NOTICE_CEILING_BYTES)
	})
})
