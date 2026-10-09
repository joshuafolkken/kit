#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_environment_file } from './josh-environment-file'
import { session_language, type Resolution } from './session-language'

// `josh session:lang` — say, on stdout, which language this session writes in, so a
// `SessionStart` / `UserPromptSubmit` hook injects the resolved value into context every turn.
// Before this, `JOSH_SESSION_LANG` lived only in `.env` — a personal,
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

const { DEFAULT_SESSION_LANG, ENV_KEY, resolve_session_lang } = session_language

// The file load happens in `main`, on the command path only; the resolver reads the environment.
// The line carries the value alone: what the language covers is `CLAUDE.md` → "Output language",
// already in context every turn, so repeating it here only spent context on each prompt. The default
// prints nothing — that resident line already names `ja`.
function format_line(resolution: Resolution): string {
	if (resolution.is_default) return ''

	return `Session language (${ENV_KEY}): ${resolution.lang}`
}

function main(): void {
	josh_environment_file.load_environment_file()
	const line = format_line(resolve_session_lang())

	if (line !== '') console.info(line)
}

const session_language_cli = {
	DEFAULT_SESSION_LANG,
	ENV_KEY,
	format_line,
	resolve_session_lang,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { session_language_cli }
