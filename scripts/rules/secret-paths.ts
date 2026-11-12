import os from 'node:os'
import path from 'node:path'

// The paths whose bytes are a credential: a read lands the secret in the transcript, and a write
// could set a guard switch.
//
// - `.env`, its `.env.*` variants and wrangler's `.dev.vars` — by name anywhere, since every checkout
//   carries its own. The two tracked placeholders are not secrets.
// - The tool credentials: gh's `hosts.yml`, Codex's `auth.json` (under `~/.codex`, `$CODEX_HOME` and
//   the `reviewer-home` an OpenAI reviewer launch left behind before joshuafolkken/kit#7196, whose
//   link still reaches the real one) — by the path's end, wherever the config directory sits.
// - The home directory's `.netrc`, `.curlrc`, `.npmrc`, `.ssh/` and `.config/gh/` — only there, so a
//   repository's own `.npmrc` stays readable. A shell word is not expanded, so `~/`, `$HOME/`,
//   `${HOME}/` and the absolute home path all name the home directory.

const TOKEN_QUOTES = /["']/gu
const BRACED_VARIABLE = /\$\{(\w+)\}/gu
const BACKSLASH = /\\/gu
const SECRET_FILES: ReadonlySet<string> = new Set(['.env', '.dev.vars'])
const ENVIRONMENT_VARIANT_PREFIX = '.env.'
// The two variants `.gitignore` un-ignores: they are tracked and hold placeholders, not secrets. The
// `Read(!…)` carve-outs in `.claude/settings.json` name the same two.
const TRACKED_VARIANTS: ReadonlySet<string> = new Set(['.env.example', '.env.test'])
const SECRET_SUFFIXES: ReadonlyArray<string> = [
	'gh/hosts.yml',
	'.codex/auth.json',
	'reviewer-home/auth.json',
	'$CODEX_HOME/auth.json',
]
const HOME_PREFIXES: ReadonlyArray<string> = ['~/', '$HOME/']
const HOME_SECRET_FILES: ReadonlySet<string> = new Set(['.netrc', '.curlrc', '.npmrc'])
const HOME_SECRET_DIRECTORIES: ReadonlyArray<string> = ['.ssh', '.config/gh']

function is_environment_file(token: string): boolean {
	const name = path.basename(token)

	if (TRACKED_VARIANTS.has(name)) return false

	return SECRET_FILES.has(name) || name.startsWith(ENVIRONMENT_VARIANT_PREFIX)
}

function is_under(relative: string, directory: string): boolean {
	return relative === directory || relative.startsWith(`${directory}/`)
}

function ends_with_path(token: string, suffix: string): boolean {
	return token === suffix || token.endsWith(`/${suffix}`)
}

function home_relative(token: string): string | undefined {
	const prefix = [...HOME_PREFIXES, `${os.homedir()}/`].find((home) => token.startsWith(home))

	return prefix === undefined ? undefined : token.slice(prefix.length)
}

function is_home_secret(token: string): boolean {
	const relative = home_relative(token)

	if (relative === undefined) return false

	return (
		HOME_SECRET_FILES.has(relative) ||
		HOME_SECRET_DIRECTORIES.some((directory) => is_under(relative, directory))
	)
}

function is_secret_token(token: string): boolean {
	return (
		is_environment_file(token) ||
		SECRET_SUFFIXES.some((suffix) => ends_with_path(token, suffix)) ||
		is_home_secret(token)
	)
}

// A path names the same file through `./`, `//` and `x/../`, so each token is matched normalized. A
// backslash is a shell escape (`~/.\netrc`) or a Windows separator (`~\.netrc`), so both readings
// are matched.
function spellings_of(word: string): ReadonlyArray<string> {
	const token = word.replaceAll(TOKEN_QUOTES, '').replaceAll(BRACED_VARIABLE, '$$$1')

	return [token.replaceAll(BACKSLASH, ''), token.replaceAll(BACKSLASH, '/')].map((spelling) =>
		path.posix.normalize(spelling),
	)
}

function is_secret_path(word: string): boolean {
	return spellings_of(word).some((token) => is_secret_token(token))
}

const secret_paths = { is_secret_path }

export { secret_paths }
