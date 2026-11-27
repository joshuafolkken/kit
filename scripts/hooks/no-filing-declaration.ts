import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { session_handoff_line } from '#scripts/josh/session-handoff-line'
import { json_value } from '#scripts/lib/json-value'
import { unasked_filing } from '#scripts/rules/unasked-filing'
import { z } from 'zod'

// **A consultation session can declare no-filing work once** (joshuafolkken/kit#9076). Without it
// every prompt that dispatches the producer must carry the no-filing phrase, and a short fix-and-look loop
// pays a round trip each time the phrase is forgotten.
//
// **Only the person's own prompt declares it.** The record is written from the `UserPromptSubmit`
// payload's `prompt`, which the harness fills with what the person typed — an assistant turn, a
// subagent's hand-back, a tool result and a compaction summary never reach that hook. Quoted text
// does not count (`unasked_filing.own_words`), so discussing the phrase is not declaring it.
//
// **It lives as long as the session's transcript, minus a resume.** The record sits beside the
// transcript, in the session directory the harness keeps the subagents' launch records in, so a new
// session (`/clear` included) starts without it and a compaction, which keeps the transcript, keeps
// it. A `--resume` keeps the transcript too, so its `SessionStart` drops the record: the first prompt
// after a resume must not reach an edit before the person has seen the declaration again.
const DECLARE = 'このセッションは起票せずに'
const END = '起票せずにモードを終了'
const RECORD_FILE = 'no-filing-declaration.json'

const PROMPT_SCHEMA = z.object({
	hook_event_name: z.literal('UserPromptSubmit'),
	prompt: z.string(),
	transcript_path: z.string().min(1),
})
const RESUME_SCHEMA = z.object({
	hook_event_name: z.literal('SessionStart'),
	source: z.literal('resume'),
	transcript_path: z.string().min(1),
})
const RECORD_SCHEMA = z.object({ declaration: z.string().min(1) })

function record_path(transcript_path: string): string {
	return path.join(transcript_path.replace(/\.jsonl$/u, ''), RECORD_FILE)
}

function declaration(transcript_path: string): string | undefined {
	const file_path = record_path(transcript_path)
	if (!existsSync(file_path)) return undefined
	const parsed = RECORD_SCHEMA.safeParse(
		json_value.parse_or_undefined(readFileSync(file_path, 'utf8')),
	)

	return parsed.data?.declaration
}

function is_declared(transcript_path: string): boolean {
	return declaration(transcript_path) !== undefined
}

// The end is read before the declaration and before the prompt's own grant: the `END` phrase also
// carries the no-filing phrase.
function is_ending(prompt: string): boolean {
	return unasked_filing.own_words(prompt).includes(END)
}

// The declaring line, kept as the person wrote it so the closing note shows their own words.
function declaring_line(prompt: string): string | undefined {
	if (is_ending(prompt)) return undefined
	const words = unasked_filing.own_words(prompt)

	return words
		.split('\n')
		.find((line) => line.includes(DECLARE))
		?.trim()
}

function settle(prompt: string, transcript_path: string): string | undefined {
	const file_path = record_path(transcript_path)
	if (is_ending(prompt)) rmSync(file_path, { force: true })
	const declared = declaring_line(prompt)
	if (declared === undefined) return declaration(transcript_path)
	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, JSON.stringify({ declaration: declared }))

	return declared
}

// The declaration in force once this hook payload is applied; `undefined` when none is.
function update(raw_payload: string): string | undefined {
	const value = json_value.parse_or_undefined(raw_payload)
	const resumed = RESUME_SCHEMA.safeParse(value)
	if (resumed.success) rmSync(record_path(resumed.data.transcript_path), { force: true })
	const submitted = PROMPT_SCHEMA.safeParse(value)
	if (!submitted.success) return undefined

	return settle(submitted.data.prompt, submitted.data.transcript_path)
}

function line_for(declared: string): string {
	return `No-filing declared for this session (「${declared}」): a producer edit needs no 「起票せずに」 in each prompt; an explicit filing instruction still wins for its own reply; 「${END}」 ends it. End every reply's closing note, beside the line that tests, the gate and the review have not run, with: 起票せずに宣言中 — 「${declared}」`
}

// The per-prompt line, `''` without a declaration. A failure costs only this line, never the hook's
// other lines.
function prompt_line(raw_payload: string): string {
	try {
		const declared = update(raw_payload)

		return declared === undefined ? '' : line_for(declared)
	} catch {
		return ''
	}
}

// The `session-resume` hook (`SessionStart`, matcher `resume`): drops the record, prints nothing.
async function end_on_resume(
	read_payload: () => Promise<string> = session_handoff_line.read_stdin,
): Promise<void> {
	update(await read_payload())
}

const no_filing_declaration = {
	DECLARE,
	END,
	end_on_resume,
	is_declared,
	is_ending,
	prompt_line,
	update,
}

export { no_filing_declaration }
