import { describe, expect, it } from 'vitest'
import { claude_token_output } from './claude-token-output'

const TOKEN = 'sk-ant-oat01-exampleTokenValue_1-2'
const BEFORE = 'Long-lived authentication token created successfully!'
const AFTER = 'Store this token securely. You will not be able to see it again.'

describe('claude_token_output.capture', () => {
	it('takes the token out of the line it is printed on', () => {
		const captured = claude_token_output.capture(`${BEFORE}\n\nYour token: ${TOKEN}\n\n${AFTER}\n`)

		expect(captured.token).toBe(TOKEN)
		expect(captured.shown).toBe(`${BEFORE}\n\nYour token: [REDACTED]\n\n${AFTER}\n`)
	})

	it('joins a token a narrow terminal wrapped, and keeps the prose after it', () => {
		const wrapped = `  ${TOKEN.slice(0, 20)}\n  ${TOKEN.slice(20)}\n${AFTER}`
		const captured = claude_token_output.capture(wrapped)

		expect(captured.token).toBe(TOKEN)
		expect(captured.shown).toBe(`  [REDACTED]\n${AFTER}`)
	})

	it('replaces every copy of a token drawn again, and keeps the first as the token', () => {
		const wrapped = `${TOKEN.slice(0, 20)}\n${TOKEN.slice(20)}`
		const captured = claude_token_output.capture(
			`${TOKEN}\n${TOKEN} ${TOKEN}\n${wrapped}\n${AFTER}`,
		)

		expect(captured.token).toBe(TOKEN)
		expect(captured.shown).toBe(`[REDACTED]\n[REDACTED] [REDACTED]\n[REDACTED]\n${AFTER}`)
	})

	it('reads through the terminal styling around the token', () => {
		const captured = claude_token_output.capture(`\u{1B}[1m${TOKEN}\u{1B}[22m\r\n`)

		expect(captured.token).toBe(TOKEN)
		expect(captured.shown).not.toContain(TOKEN)
	})

	it('answers no token when none was printed', () => {
		expect(claude_token_output.capture(`${BEFORE}\n`)).toStrictEqual({
			token: undefined,
			shown: `${BEFORE}\n`,
		})
	})
})

describe('claude_token_output.live_length', () => {
	it('lets through everything when no token has begun', () => {
		expect(claude_token_output.live_length(`${BEFORE}\nPaste code here > `)).toBe(
			`${BEFORE}\nPaste code here > `.length,
		)
	})

	it('stops where the token begins', () => {
		expect(claude_token_output.live_length(`${BEFORE}\n${TOKEN}\n${AFTER}`)).toBe(
			`${BEFORE}\n`.length,
		)
	})

	it('holds back a tail that could be the start of a token', () => {
		expect(claude_token_output.live_length(`${BEFORE}\nsk-an`)).toBe(`${BEFORE}\n`.length)
	})
})

describe('claude_token_output.capture — no token', () => {
	it('shows the output unchanged', () => {
		expect(claude_token_output.capture(`${BEFORE}\n`)).toStrictEqual({
			token: undefined,
			shown: `${BEFORE}\n`,
		})
	})
})
