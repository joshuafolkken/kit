import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { author_fields_schema } from '#scripts/git/git-schemas'
import { parse_json } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// Whose words kit acts on: the author of an issue or a comment who can write to the repository. On a
// public repository anyone can file an issue or comment, so a body kit runs (`josh measure:rerun`) or
// copies into the ledger (`review:record`) is taken only from an author with write access — and an
// unknown author is not a trusted one.
//
// **`author_association` alone does not say "can write"** (joshuafolkken/kit#4037). `OWNER` does, so it
// is trusted without a request. `MEMBER` is any member of the owning org, whatever their access to this
// repository, and `COLLABORATOR` includes outside collaborators with read or triage access only — so
// those two are asked of the collaborator-permission endpoint, once per login per process, and trusted
// only on a write role. A lookup that fails is not trust.
const OWNER = 'OWNER'
const ASKED_ASSOCIATIONS: ReadonlySet<string> = new Set(['MEMBER', 'COLLABORATOR'])
const WRITE_ROLES: ReadonlySet<string> = new Set(['admin', 'maintain', 'write'])
// A GitHub user login, an Enterprise Managed User's `name_shortcode` included — it is placed in a REST
// path, so anything else (a `[bot]` login, a slash) is refused before a request is made.
const LOGIN_PATTERN = /^[\da-z](?:[\w-]*[\da-z])?$/iu
const TRUSTED_LIST = 'OWNER, or MEMBER / COLLABORATOR with write access'
// The REST fields that name who wrote an issue, asked beside its body by every reader that decides
// whether to act on that body; `author_fields_schema` is the shape they parse to.
const AUTHOR_FIELDS = 'author_association,user'

const permission_schema = z.looseObject({
	permission: z.string().nullish(),
	role_name: z.string().nullish(),
})

// `timeout_ms` bounds the lookup for a caller inside a hook's own timeout (`issue-watch`).
interface Author {
	login: string | undefined
	association: string | null | undefined
	timeout_ms?: number | undefined
}

interface AuthorFields {
	author_association?: string | null | undefined
	user?: { login: string } | null | undefined
}

const answers = new Map<string, Promise<boolean | undefined>>()

function permission_path(login: string): string {
	return `${git_gh_api_path.repo_api_path()}/collaborators/${login}/permission`
}

// `role_name` names `maintain` exactly; `permission` folds it into `write`, so either answers.
function has_write_role(raw: string): boolean {
	const parsed = parse_json.parse_json_object_or_undefined(raw, permission_schema)
	const roles = [parsed?.role_name, parsed?.permission]

	return roles.some((role) => typeof role === 'string' && WRITE_ROLES.has(role))
}

// `undefined` for a lookup that failed, which is not an answer.
async function ask_permission(login: string, timeout_ms?: number): Promise<boolean | undefined> {
	try {
		const raw = await git_gh_exec.exec_gh_api({ path: permission_path(login), timeout_ms })

		return has_write_role(raw)
	} catch {
		return undefined
	}
}

// A failed lookup is not remembered: the backlog driver keeps one process for hours, so one dropped
// request would otherwise leave that author unanswered until it restarts. Only the caller's own
// request is evicted, never a newer one another caller has stored since.
async function can_write(login: string, timeout_ms?: number): Promise<boolean | undefined> {
	const asked = answers.get(login) ?? ask_permission(login, timeout_ms)

	answers.set(login, asked)

	const has_write = await asked

	if (has_write === undefined && answers.get(login) === asked) answers.delete(login)

	return has_write
}

function is_user_login(login: string | undefined): login is string {
	return login !== undefined && LOGIN_PATTERN.test(login)
}

function is_asked(author: Author): boolean {
	return ASKED_ASSOCIATIONS.has(author.association ?? '') && is_user_login(author.login)
}

// `undefined` when the lookup failed: neither trusted nor refused, for a caller that must not settle a
// permanent answer on it (`review-comment-round`).
async function trust_of(author: Author): Promise<boolean | undefined> {
	if (author.association === OWNER) return true
	if (author.login === undefined || !is_asked(author)) return false

	return await can_write(author.login, author.timeout_ms)
}

// A lookup that failed is not trust.
async function is_trusted(author: Author): Promise<boolean> {
	return (await trust_of(author)) === true
}

// The author of a row read with `AUTHOR_FIELDS`.
function author_of(row: AuthorFields, timeout_ms?: number): Author {
	return { login: row.user?.login, association: row.author_association, timeout_ms }
}

const gh_author_association = {
	AUTHOR_FIELDS,
	TRUSTED_LIST,
	author_fields_schema,
	author_of,
	is_trusted,
	trust_of,
}

export type { Author, AuthorFields }
export { gh_author_association }
