#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from './josh-environment-file'

// `josh session:lang` — say, on stdout, which language this session writes in, so a
// `SessionStart` / `UserPromptSubmit` hook injects the resolved value into context every turn
// (joshuafolkken/kit#1903). Before this, `JOSH_SESSION_LANG` lived only in `.env` — a personal,
// non-committed file the harness never loads into the process environment — so the value was
// invisible unless the agent read the file itself, and a one-word prompt like `diag` had nothing to
// infer a language from and drifted to the surrounding English.
//
// **The `.env` read reuses the one loader** (`josh_environment_file.load_environment_file`) rather
// than a second parser, and keeps node's precedence: a value already in the process environment wins
// over the file's. Unset, empty and no-`.env` all resolve to `ja`, because a worktree without a
// `.env`, a cloud session and a consumer repository are exactly where the drift recurs.
//
// The line itself is a script-fixed string, so it stays English by the same rule that pins the
// Telegram header labels and the `--notify-message` default (`CLAUDE.md` → "Output language").

const ENV_KEY = 'JOSH_SESSION_LANG'
const DEFAULT_SESSION_LANG = 'ja'
const ENGLISH_OPT_IN_LANG = 'en'
const SCOPE_NOTE =
	'write session dialogue, AskUserQuestion labels/descriptions and artifact prose (Issue bodies, comments, Telegram) in this language. English stays only for Issue/PR titles, code comments/test titles/commit messages, and script-fixed strings.'

interface Resolution {
	lang: string
	is_default: boolean
}

// Reads the process environment alone, so a unit test sets `process.env[ENV_KEY]` and never touches a
// real `.env`. The file load happens in `main`, on the command path only.
function resolve_session_lang(): Resolution {
	const value = process.env[ENV_KEY]?.trim()
	if (value) return { lang: value, is_default: false }

	return { lang: DEFAULT_SESSION_LANG, is_default: true }
}

function format_line(resolution: Resolution): string {
	const suffix = resolution.is_default
		? ` (default; set ${ENV_KEY}=${ENGLISH_OPT_IN_LANG} for English)`
		: ''

	return `Session language (${ENV_KEY}): ${resolution.lang}${suffix} — ${SCOPE_NOTE}`
}

function main(): void {
	josh_environment_file.load_environment_file()
	console.info(format_line(resolve_session_lang()))
}

const session_language_cli = {
	DEFAULT_SESSION_LANG,
	ENV_KEY,
	format_line,
	main,
	resolve_session_lang,
	SCOPE_NOTE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export type { Resolution }
export { session_language_cli }
