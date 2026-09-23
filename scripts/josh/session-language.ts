// The session language, resolved from the process environment alone — the one resolver both
// `josh session:lang` and the Stop hook read. It lives apart from `session-language-cli.ts` because
// that file is its own hook bundle entry: an entry imported by another entry is moved into a shared
// esbuild chunk, so its `import.meta.url` stops matching `argv[1]` and `dist/hooks/session-lang.js`
// prints nothing (`build-hooks.ts` → "`splitting: true` is load-bearing").
//
// Unset and empty resolve to `ja`, because a worktree without a `.env`, a cloud session and a
// consumer repository are exactly where the drift recurs (joshuafolkken/kit#1903).

const ENV_KEY = 'JOSH_SESSION_LANG'
const DEFAULT_SESSION_LANG = 'ja'

interface Resolution {
	lang: string
	is_default: boolean
}

// Reads the process environment alone, so a unit test sets `process.env[ENV_KEY]` and never touches a
// real `.env`. Loading the file is the caller's job.
function resolve_session_lang(): Resolution {
	const value = process.env[ENV_KEY]?.trim()
	if (value) return { lang: value, is_default: false }

	return { lang: DEFAULT_SESSION_LANG, is_default: true }
}

const session_language = { DEFAULT_SESSION_LANG, ENV_KEY, resolve_session_lang }

export type { Resolution }
export { session_language }
