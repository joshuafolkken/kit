import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { no_filing_declaration } from './no-filing-declaration'

const create_directory = temporary_directory('suite')

const { DECLARE, END, is_declared, prompt_line, update } = no_filing_declaration
const DECLARING = `${DECLARE}、Detroit のテーマを直す`
const VARIANT = 'このセッションでは起票せずに'
const PLAIN = 'ボタンの色を少し濃くして'

function session(): string {
	return path.join(create_directory('no-filing-session-'), 'session.jsonl')
}

function submitted(
	transcript_path: string,
	prompt: string,
	hook_event_name = 'UserPromptSubmit',
): string {
	return JSON.stringify({ hook_event_name, prompt, transcript_path })
}

function started(transcript_path: string, source: string): string {
	return JSON.stringify({ hook_event_name: 'SessionStart', source, transcript_path })
}

function declared(): string {
	const transcript_path = session()

	update(submitted(transcript_path, DECLARING))

	return transcript_path
}

// joshuafolkken/kit#9076: the person declares no-filing work once for the session.
describe('no-filing declaration — who declares it', () => {
	it('records the declaring line from the person’s prompt as they wrote it', () => {
		const transcript_path = session()

		expect(update(submitted(transcript_path, `前置き\n${DECLARING}`))).toBe(DECLARING)
		expect(is_declared(transcript_path)).toBe(true)
	})

	it('keeps the quotes and code spans of the declaring line', () => {
		const transcript_path = session()
		const line = `${DECLARE}「Detroit」テーマの \`--color\` を直す`

		expect(update(submitted(transcript_path, line))).toBe(line)
	})

	it.each([
		['a quoted phrase', `「${DECLARE}」とはどういう意味？`],
		['a code span', `\`${DECLARE}\` の仕組みを説明して`],
		['a quoted particle variant', `「${VARIANT}」でも通る？`],
		['an unrelated sentence on this session', 'このセッションではテーマの色を調べて'],
		['a prompt without it', PLAIN],
	])('does not declare from %s', (_name, prompt) => {
		const transcript_path = session()

		expect(update(submitted(transcript_path, prompt))).toBeUndefined()
		expect(is_declared(transcript_path)).toBe(false)
	})

	it.each(['PreToolUse', 'PostToolUse', 'SubagentStop', 'Stop', 'PreCompact'])(
		'does not declare from a %s payload carrying the phrase',
		(event) => {
			const transcript_path = session()

			update(submitted(transcript_path, DECLARING, event))

			expect(is_declared(transcript_path)).toBe(false)
		},
	)
})

// 2026-11-28: the person wrote the phrase with one particle different and nothing was recorded.
describe('no-filing declaration — the phrase', () => {
	it.each([
		['the canonical phrase', `${DECLARE}実装して`],
		['the particle variant', `${VARIANT}実装して`],
	])('declares from %s', (_name, prompt) => {
		const transcript_path = session()

		expect(update(submitted(transcript_path, prompt))).toBe(prompt)
		expect(is_declared(transcript_path)).toBe(true)
	})
})

describe('no-filing declaration — its life', () => {
	it('stays in force through later prompts without the phrase', () => {
		const transcript_path = declared()

		expect(update(submitted(transcript_path, PLAIN))).toBe(DECLARING)
	})

	it('ends on the end phrase, which itself declares nothing', () => {
		const transcript_path = declared()

		expect(update(submitted(transcript_path, `${END}。${DECLARE}`))).toBeUndefined()
		expect(is_declared(transcript_path)).toBe(false)
	})

	it('is not carried into another session', () => {
		declared()

		expect(is_declared(session())).toBe(false)
	})

	it('ends on a resume and survives a compaction', () => {
		const resumed = declared()
		const compacted = declared()

		update(started(resumed, 'resume'))
		update(started(compacted, 'compact'))

		expect(is_declared(resumed)).toBe(false)
		expect(is_declared(compacted)).toBe(true)
	})

	it('ends through the session-resume hook reading its payload', async () => {
		const transcript_path = declared()

		await no_filing_declaration.end_on_resume(async () => started(transcript_path, 'resume'))

		expect(is_declared(transcript_path)).toBe(false)
	})
})

describe('no-filing declaration — the closing note', () => {
	it('prints the declaration verbatim with the closing-note instruction on every prompt', () => {
		const transcript_path = declared()
		const line = prompt_line(submitted(transcript_path, PLAIN))

		expect(line).toContain(`起票せずに宣言中 — 「${DECLARING}」`)
		expect(line).toContain('closing note')
	})

	it.each([
		['no declaration', JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: PLAIN })],
		['an unparsed payload', '{'],
	])('prints nothing with %s', (_name, payload) => {
		expect(prompt_line(payload)).toBe('')
	})
})
