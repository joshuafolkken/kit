import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FileAction } from './init-actions'
import { session_language_environment } from './session-language-environment'

const EN_US = 'en_US.UTF-8'
const JA_JP = 'ja_JP.UTF-8'
const EN_LOCALE = { LANG: EN_US }
const JA_LOCALE = { LANG: JA_JP }
const JA_LINE = 'JOSH_SESSION_LANG=ja\n'
const EN_LINE = 'JOSH_SESSION_LANG=en\n'

describe('session_language_environment.lang_from_locale', () => {
	it('resolves an English locale to en', () => {
		expect(session_language_environment.lang_from_locale(EN_LOCALE)).toBe('en')
	})

	it('resolves a Japanese locale to ja', () => {
		expect(session_language_environment.lang_from_locale(JA_LOCALE)).toBe('ja')
	})

	it('lets LC_ALL override LC_MESSAGES and LANG', () => {
		const environment = { LC_ALL: JA_JP, LC_MESSAGES: 'C', LANG: EN_US }

		expect(session_language_environment.lang_from_locale(environment)).toBe('ja')
	})

	it('skips an empty LC_ALL and reads LC_MESSAGES', () => {
		const environment = { LC_ALL: '', LC_MESSAGES: JA_JP, LANG: EN_US }

		expect(session_language_environment.lang_from_locale(environment)).toBe('ja')
	})

	it('resolves a missing locale to en', () => {
		expect(session_language_environment.lang_from_locale({})).toBe('en')
	})
})

const fixture = { root: '' }

beforeEach(() => {
	fixture.root = mkdtempSync(path.join(tmpdir(), 'session-lang-'))
})

afterEach(() => {
	rmSync(fixture.root, { recursive: true, force: true })
})

function only_action(environment: Record<string, string>): FileAction {
	const actions = session_language_environment.build_session_lang_actions(environment, fixture.root)
	const [action] = actions
	if (action === undefined || actions.length !== 1) throw new Error('expected one .env action')

	return action
}

function write_claude_settings(content: string): void {
	mkdirSync(path.join(fixture.root, '.claude'))
	writeFileSync(path.join(fixture.root, '.claude', 'settings.json'), content)
}

describe('session_language_environment.build_session_lang_actions', () => {
	it('writes JOSH_SESSION_LANG=en into a new .env under an English locale', () => {
		const action = only_action(EN_LOCALE)

		expect(action.dest).toBe('.env')
		expect(action.create()).toBe(EN_LINE)
	})

	it('writes JOSH_SESSION_LANG=ja into a new .env under a Japanese locale', () => {
		expect(only_action(JA_LOCALE).create()).toBe(JA_LINE)
	})

	it('appends the line to an existing .env that lacks it', () => {
		expect(only_action(EN_LOCALE).merge?.('PORT_SEED=1')).toBe(`PORT_SEED=1\n${EN_LINE}`)
	})

	it('prefers a JOSH_SESSION_LANG already exported in the shell over the locale', () => {
		expect(only_action({ ...EN_LOCALE, JOSH_SESSION_LANG: 'ja' }).create()).toBe(JA_LINE)
	})
})

describe('session_language_environment for a project already using kit', () => {
	it('writes nothing when the session language hook is already wired', () => {
		write_claude_settings('{"hooks":{"command":"pnpm josh session:lang"}}')

		expect(
			session_language_environment.build_session_lang_actions(EN_LOCALE, fixture.root),
		).toEqual([])
	})

	it('still writes when the Claude settings do not wire the hook', () => {
		write_claude_settings('{"permissions":{}}')

		expect(only_action(EN_LOCALE).create()).toBe(EN_LINE)
	})
})

describe('session_language_environment.merge_session_lang', () => {
	it('never overwrites an existing setting', () => {
		const existing = `PORT_SEED=1\n${JA_LINE}`

		expect(session_language_environment.merge_session_lang(existing, 'en')).toBe(existing)
	})

	it('never overwrites an exported setting', () => {
		const existing = `export ${JA_LINE}`

		expect(session_language_environment.merge_session_lang(existing, 'en')).toBe(existing)
	})

	it('appends to an empty .env without a leading blank line', () => {
		expect(session_language_environment.merge_session_lang('', 'ja')).toBe(JA_LINE)
	})
})
