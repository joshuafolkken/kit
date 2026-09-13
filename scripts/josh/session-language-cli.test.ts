import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { session_language_cli } from './session-language-cli'

const { ENV_KEY, DEFAULT_SESSION_LANG, SCOPE_NOTE, resolve_session_lang, format_line } =
	session_language_cli

const DEFAULT_RESULT = { lang: DEFAULT_SESSION_LANG, is_default: true }

function set_environment(value: string | undefined): void {
	if (value === undefined) Reflect.deleteProperty(process.env, ENV_KEY)
	else process.env[ENV_KEY] = value
}

describe('resolve_session_lang', () => {
	let original: string | undefined

	beforeEach(() => {
		original = process.env[ENV_KEY]
	})

	afterEach(() => {
		set_environment(original)
	})

	// A set value is returned verbatim; because node's `.env` loader defers to the process
	// environment, a value present here is also the one that wins over any file value.
	it('returns the configured value, which wins over any .env file value', () => {
		set_environment('en')

		expect(resolve_session_lang()).toStrictEqual({ lang: 'en', is_default: false })
	})

	// Unset (no `.env` value), empty and whitespace-only all resolve to the ja default.
	it.each([undefined, '', ' '.repeat(3)])('falls back to ja when the variable is %o', (value) => {
		set_environment(value)

		expect(resolve_session_lang()).toStrictEqual(DEFAULT_RESULT)
	})
})

describe('format_line', () => {
	it('states the language and scope note without a default marker when set', () => {
		const line = format_line({ lang: 'en', is_default: false })

		expect(line).toContain(`${ENV_KEY}): en —`)
		expect(line).toContain(SCOPE_NOTE)
		expect(line).not.toContain('default')
	})

	it('marks the ja default and names the English opt-in when unset', () => {
		const line = format_line({ lang: DEFAULT_SESSION_LANG, is_default: true })

		expect(line).toContain(
			`${ENV_KEY}): ${DEFAULT_SESSION_LANG} (default; set ${ENV_KEY}=en for English)`,
		)
		expect(line).toContain(SCOPE_NOTE)
	})
})
