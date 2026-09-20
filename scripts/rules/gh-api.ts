// The one reading of a `gh api` segment shared by the rows of `delivered-rules.ts` that judge such a
// call by its spelling (joshuafolkken/kit#2122): the issue-body-read guard classifies read vs write,
// and the third-party-write guard needs the same classification plus the target `owner/repo`. Two
// copies of the flag regexes would be the clone `CLAUDE.md` prohibits, and the copy that forgot `-F`
// or `--raw-field` would be the one that let a write through.
//
// **The deny list matches globs; this reads the command.** `gh api` sends a POST as soon as any field
// flag appears, and a method flag can override the verb either way, so the read/write line is not a
// literal a glob can key on — parsing the flags is what makes the judgement independent of the
// spelling.

// A `gh api …` invocation. Global flags may precede the subcommand (`gh --repo o/r api …`), so they
// are skipped by the same optional-flag prefix `delivered-rules.ts` uses in front of `issue view`.
const GH_FLAGS = String.raw`(?:-{1,2}[\w-]+(?:[= ][^\s]+)?\s+)*`
const GH_API_COMMAND = new RegExp(String.raw`^gh\s+${GH_FLAGS}api\s`, 'u')

// The method override, and the field flags that turn a bare `gh api` into a POST. **All four field
// spellings**, `-F` included — it is `--field`'s short form and reads as a different flag to a
// pattern that only knows `-f`. A body passed with `--input <file>` counts as a write too: it carries
// the fields inside the file.
const API_METHOD = /(?:^|\s)(?:--method|-X)[= ]([A-Za-z]+)/u
const API_FIELD = /(?:^|\s)(?:--raw-field|--field|--input|-F|-f)(?:[= ]|$)/u
const READ_METHOD = 'GET'

// `repos/<owner>/<repo>` from an api path, with both halves captured. The path may carry a leading
// slash, a query string, or further segments (`…/issues/5/comments`), so the owner and repo are taken
// as the two segments after `repos/` and the rest is ignored. A call that names no repository endpoint
// (`gh api user`, `gh api graphql`) matches nothing and is left to the caller as "no target".
const REPO_PATH = /repos\/([^/\s'"?]+)\/([^/\s'"?]+)/u
const OWNER_GROUP = 1
const REPO_GROUP = 2

interface RepoTarget {
	owner: string
	repo: string
}

function is_gh_api(segment: string): boolean {
	return GH_API_COMMAND.test(segment)
}

// A read is a `GET` — explicit via a method flag, or implicit when no field flag makes it a POST.
function is_read(segment: string): boolean {
	const method = API_METHOD.exec(segment)?.[1]

	if (method !== undefined) return method.toUpperCase() === READ_METHOD

	return !API_FIELD.test(segment)
}

function is_write(segment: string): boolean {
	return !is_read(segment)
}

function repo_target(segment: string): RepoTarget | undefined {
	const match = REPO_PATH.exec(segment)

	if (match === null) return undefined

	return { owner: match[OWNER_GROUP] ?? '', repo: match[REPO_GROUP] ?? '' }
}

const gh_api = { GH_API_COMMAND, GH_FLAGS, is_gh_api, is_read, is_write, repo_target }

export type { RepoTarget }
export { gh_api }
