import { git_argv } from './git-argv'

// The one reading of a `gh api` segment shared by the rows of `delivered-rules.ts` that judge such a
// call by its spelling: the issue-body-read guard classifies read vs write,
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
// the fields inside the file. A short flag also takes its value attached (`-XPUT`, `-fname=x`), as
// `gh` accepts.
//
// **Read off the argv at flag positions, not the joined line**: a flag spelled inside a field value
// (`-f 'note=a -X GET'`) is that field's value, and reading it as the method would class a POST a
// read (joshuafolkken/kit#4650).
const GH_COMMAND = 'gh'
const METHOD_FLAGS: ReadonlySet<string> = new Set(['-X', '--method'])
const ATTACHED_METHOD = /^(?:-X=?|--method=)([A-Za-z]+)$/u
const FIELD_FLAGS: ReadonlySet<string> = new Set(['-f', '-F', '--field', '--raw-field', '--input'])
const ATTACHED_FIELD = /^(?:-[fF].|--(?:raw-field|field|input)=)/u
const QUOTES = /['"]/gu
const FLAG_PREFIX = '-'
const NEXT = 1
const READ_METHOD = 'GET'
// `gh api`'s flags that take a value as the next word, beside the repository selector — skipped so
// `-X POST` or `-f body=…` is not read as the endpoint, and a value is not read as a flag.
const API_VALUE_TAKING_FLAGS: ReadonlySet<string> = new Set([
	'-R',
	'--repo',
	...METHOD_FLAGS,
	...FIELD_FLAGS,
	'-H',
	'--header',
	'-q',
	'--jq',
	'-t',
	'--template',
	'--hostname',
	'-p',
	'--preview',
	'--cache',
])

// `repos/<owner>/<repo>` from an api path, with both halves captured. The path may carry a leading
// slash, a query string, or further segments (`…/issues/5/comments`), so the owner and repo are taken
// as the two segments after `repos/` and the rest is ignored. A call that names no repository endpoint
// (`gh api user`, `gh api graphql`) matches nothing and is left to the caller as "no target".
const REPO_PATH = /repos\/([^/\s'"?]+)\/([^/\s'"?]+)/u
const OWNER_GROUP = 1
const REPO_GROUP = 2

// The placeholders `gh api` expands to its base repository's owner before it sends the request
//  — `{owner}`, and the legacy `:owner` it still accepts. Which owner that is
// depends on the checkout's remotes, so the caller resolves it rather than this parser.
const OWNER_PLACEHOLDERS: ReadonlySet<string> = new Set(['{owner}', ':owner'])

interface RepoTarget {
	owner: string
	repo: string
}

function is_gh_api(segment: string): boolean {
	return GH_API_COMMAND.test(segment)
}

// Each flag of the call with the word after it — a word that is a value-taking flag's value is not
// a flag itself.
function flags_of(segment: string): Array<[string, string]> {
	const words = git_argv.arguments_of(segment, GH_COMMAND) ?? []

	return words
		.map((word, index): [string, string] => [word, words[index + NEXT] ?? ''])
		.filter(([word], index) => {
			if (!word.startsWith(FLAG_PREFIX)) return false

			return !API_VALUE_TAKING_FLAGS.has(words[index - NEXT] ?? '')
		})
}

function method_value(flag: string, next: string): string | undefined {
	if (METHOD_FLAGS.has(flag)) return next.replaceAll(QUOTES, '')

	return ATTACHED_METHOD.exec(flag)?.[1]
}

// A read is a `GET` — explicit via a method flag, or implicit when no field flag makes it a POST.
// The explicit `-X` / `--method` value, upper-cased, or `undefined` when the call names none; the
// last one wins, as it does in `gh`.
function method_of(segment: string): string | undefined {
	const methods = flags_of(segment).map(([flag, next]) => method_value(flag, next))

	return methods.findLast((method) => method !== undefined)?.toUpperCase()
}

function is_field_flag(flag: string): boolean {
	return FIELD_FLAGS.has(flag) || ATTACHED_FIELD.test(flag)
}

function is_read(segment: string): boolean {
	const method = method_of(segment)

	if (method !== undefined) return method === READ_METHOD

	return flags_of(segment).every(([flag]) => !is_field_flag(flag))
}

function is_write(segment: string): boolean {
	return !is_read(segment)
}

function repo_target(segment: string): RepoTarget | undefined {
	const match = REPO_PATH.exec(segment)

	if (match === null) return undefined

	return { owner: match[OWNER_GROUP] ?? '', repo: match[REPO_GROUP] ?? '' }
}

function is_owner_placeholder(owner: string): boolean {
	return OWNER_PLACEHOLDERS.has(owner)
}

const gh_api = {
	API_VALUE_TAKING_FLAGS,
	GH_FLAGS,
	is_gh_api,
	is_owner_placeholder,
	is_read,
	is_write,
	method_of,
	repo_target,
}

export { gh_api }
