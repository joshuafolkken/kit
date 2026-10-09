// `josh init` seeds `JOSH_SESSION_LANG` in `.env` from the OS locale, so a newly adopting user starts
// in their own language. A project already using kit keeps its language: the
// session language takes effect only through the `session:lang` hook, so a project whose
// `.claude/settings.json` already wires it is left alone, and an existing `.env` value — the `export`
// form included — is never touched. The unset default stays `ja`.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { session_language } from '#scripts/josh/session-language'
import type { FileAction } from './init-actions'
import { PROJECT_ROOT } from './init-paths'

const ENV_FILE = '.env'
const CLAUDE_SETTINGS_PATH = path.join('.claude', 'settings.json')
const SESSION_LANG_HOOK = 'session:lang'
// POSIX precedence: `LC_ALL` overrides `LC_MESSAGES`, which overrides `LANG`.
const LOCALE_KEYS = ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const
const JAPANESE_PREFIX = 'ja'
const NON_JAPANESE_LANG = 'en'
const KEY_LINE_PATTERN = new RegExp(
	String.raw`^\s*(?:export\s+)?${session_language.ENV_KEY}\s*=`,
	'mu',
)

type LocaleEnvironment = Readonly<Record<string, string | undefined>>

function lang_from_locale(environment: LocaleEnvironment): string {
	const locale = LOCALE_KEYS.map((key) => environment[key]?.trim()).find(Boolean) ?? ''

	return locale.toLowerCase().startsWith(JAPANESE_PREFIX) ? JAPANESE_PREFIX : NON_JAPANESE_LANG
}

// A value the user already exported is their explicit choice, so it wins over the locale.
function resolve_lang(environment: LocaleEnvironment): string {
	const exported = environment[session_language.ENV_KEY]?.trim()
	if (exported) return exported

	return lang_from_locale(environment)
}

function session_lang_line(lang: string): string {
	return `${session_language.ENV_KEY}=${lang}\n`
}

function merge_session_lang(existing: string, lang: string): string {
	if (KEY_LINE_PATTERN.test(existing)) return existing
	const separator = existing.length === 0 || existing.endsWith('\n') ? '' : '\n'

	return `${existing}${separator}${session_lang_line(lang)}`
}

function is_session_lang_hooked(project_root: string): boolean {
	const settings_path = path.join(project_root, CLAUDE_SETTINGS_PATH)

	return (
		existsSync(settings_path) && readFileSync(settings_path, 'utf8').includes(SESSION_LANG_HOOK)
	)
}

// Built before `init` writes the AI files, so the hook check reads the project as it was.
function build_session_lang_actions(
	environment: LocaleEnvironment = process.env,
	project_root: string = PROJECT_ROOT,
): ReadonlyArray<FileAction> {
	if (is_session_lang_hooked(project_root)) return []
	const lang = resolve_lang(environment)

	return [
		{
			dest: ENV_FILE,
			create: () => session_lang_line(lang),
			merge: (existing) => merge_session_lang(existing, lang),
		},
	]
}

const session_language_environment = {
	build_session_lang_actions,
	lang_from_locale,
	merge_session_lang,
}

export { session_language_environment }
