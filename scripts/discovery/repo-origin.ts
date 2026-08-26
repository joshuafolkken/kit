// Normalizing a git `origin` URL into the `owner/repo` that identifies the repository on GitHub.
//
// Kept separate from the map that consumes it (`repo-map-logic.ts`) because the shapes a remote can
// take are the part with real variety: a single machine's siblings were measured carrying SSH,
// an SSH host alias, HTTPS with embedded credentials and a trailing slash, and plain HTTPS — all
// four pointing at the same repository (joshuafolkken/kit#869).

// A repository's identity on GitHub. The `owner` half is what the discovery map filters on, so it is
// derived here from the remote and never from a directory name.
interface RepoIdentity {
	owner: string
	repo: string
}

const GITHUB_HOST = 'github.com'
// An SSH host alias, as written in `~/.ssh/config` (`Host github-work`). Aliases are a local naming
// concept with no dots, and they exist only in the scp-like SSH form — see `is_github_ssh_host`.
const SSH_ALIAS_PATTERN = /^github(?:-\w+)*$/u
const GIT_SUFFIX = '.git'
const PATH_SEPARATOR = '/'
const USER_SEPARATOR = '@'
const HOST_SEPARATOR = ':'
const OWNER_INDEX = 0
const REPO_INDEX = 1
const REPO_PATH_SEGMENTS = 2
const NOT_FOUND = -1
const SECTION_PREFIX = '['
const ORIGIN_SECTION = /^\[remote\s+"origin"\]$/u
const URL_KEY = 'url'

// Whether a URL's hostname is GitHub. Exact, with no alias spelling accepted: an alias is a name
// `~/.ssh/config` resolves, so `https://github-internal/owner/repo` is a real host of somebody
// else's and must not be read as GitHub.
function is_github_hostname(host: string): boolean {
	return host.toLowerCase() === GITHUB_HOST
}

// Whether an SSH remote's host is GitHub: the canonical hostname, or a dotless alias for it as
// written in `~/.ssh/config` (`Host github-work`). A dotted host is a real hostname and has to match
// exactly, which is what keeps `github-enterprise.example.com` out.
function is_github_ssh_host(host: string): boolean {
	const normalized = host.toLowerCase()

	return is_github_hostname(normalized) || SSH_ALIAS_PATTERN.test(normalized)
}

function strip_git_suffix(name: string): string {
	return name.endsWith(GIT_SUFFIX) ? name.slice(0, -GIT_SUFFIX.length) : name
}

// `owner/repo` from a remote's path. Empty segments are dropped, which absorbs a leading and a
// trailing slash without a backtracking pattern. Anything that is not exactly two segments is not a
// repository remote (a gist, a bare host, a nested path) and is rejected rather than guessed.
function to_identity(repository_path: string): RepoIdentity | undefined {
	const segments = repository_path.split(PATH_SEPARATOR).filter((segment) => segment !== '')
	if (segments.length !== REPO_PATH_SEGMENTS) return undefined
	const owner = segments[OWNER_INDEX] ?? ''
	const repo = strip_git_suffix(segments[REPO_INDEX] ?? '')

	return repo === '' ? undefined : { owner, repo }
}

// The `scp`-like SSH form: `git@github.com:owner/repo.git`, and its host-alias variant. Split by
// hand rather than matched: the pattern for this shape is an optional user part followed by a
// host — which backtracks super-linearly on a long non-matching remote.
function parse_scp_like(url: string): RepoIdentity | undefined {
	const user_end = url.indexOf(USER_SEPARATOR)
	const authority = user_end === NOT_FOUND ? url : url.slice(user_end + 1)
	const host_end = authority.indexOf(HOST_SEPARATOR)
	if (host_end === NOT_FOUND) return undefined
	if (!is_github_ssh_host(authority.slice(0, host_end))) return undefined

	return to_identity(authority.slice(host_end + 1))
}

// Any URL form `URL` accepts: `https://user@github.com/owner/repo.git/`, `ssh://git@github.com/…`.
// Embedded credentials land in `username`/`password` and are dropped with the rest of the authority.
function parse_url_like(url: string): RepoIdentity | undefined {
	try {
		const parsed = new URL(url)

		return is_github_hostname(parsed.hostname) ? to_identity(parsed.pathname) : undefined
	} catch {
		return undefined
	}
}

// `owner/repo` for a GitHub remote, or nothing for every other remote. Returning nothing is the
// exclusion the owner restriction depends on: a self-hosted or third-party host never reaches the
// owner comparison at all (joshuafolkken/kit#869).
function parse_origin_url(url: string): RepoIdentity | undefined {
	const trimmed = url.trim()
	if (trimmed === '') return undefined

	return parse_url_like(trimmed) ?? parse_scp_like(trimmed)
}

function is_section_header(line: string): boolean {
	return line.startsWith(SECTION_PREFIX)
}

// The lines belonging to the `[remote "origin"]` section, in order. A section runs until the next
// header, so a `url` declared under a different remote is never read as origin's.
function origin_section_lines(lines: ReadonlyArray<string>): Array<string> {
	const start = lines.findIndex((line) => ORIGIN_SECTION.test(line))
	if (start === NOT_FOUND) return []
	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => is_section_header(line))

	return end === NOT_FOUND ? rest : rest.slice(0, end)
}

// The value of a `key = value` entry, or nothing when the line declares a different key. Split on
// the first separator rather than matched, for the reason `parse_scp_like` is split by hand.
function entry_value(line: string, key: string): string | undefined {
	const separator = line.indexOf('=')
	if (separator === NOT_FOUND) return undefined
	if (line.slice(0, separator).trim() !== key) return undefined

	return line.slice(separator + 1).trim()
}

// The `url` of the `[remote "origin"]` section of a git config, or nothing when the work tree
// declares no `origin`. Parsed from the file rather than asked of `git`, because discovery reads one
// config per sibling directory and spawning a process for each would make `josh doctor` pay a
// process per unrelated repository sharing the parent directory.
function parse_origin_from_config(content: string): string | undefined {
	const lines = content.split('\n').map((line) => line.trim())

	return origin_section_lines(lines)
		.map((line) => entry_value(line, URL_KEY))
		.find((url) => url !== undefined)
}

// The `owner/repo` key a discovery map is keyed by. Lowercased, because GitHub resolves owner and
// repository names case-insensitively: two remotes spelling the same repository differently are the
// same repository, and keying by the spelling would put both in the map — where an override, which
// the caller applies last, would no longer replace the entry it was written to replace.
function format_identity(identity: RepoIdentity): string {
	return `${identity.owner}${PATH_SEPARATOR}${identity.repo}`.toLowerCase()
}

const repo_origin = {
	GITHUB_HOST,
	is_github_hostname,
	is_github_ssh_host,
	parse_origin_from_config,
	parse_origin_url,
	format_identity,
}

export type { RepoIdentity }
export { repo_origin }
