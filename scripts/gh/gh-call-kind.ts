import { gh_api } from '#scripts/rules/gh-api'

// The kind of one `gh` call, the key `gh:usage` counts endpoints by (joshuafolkken/kit#6867): a REST
// call is its method and normalized path (`GET repos/{o}/{r}/issues/{n}`), GraphQL is the one kind
// `graphql`, and any other subcommand is its name (`gh issue view`). Normalizing folds the owner,
// repository, numbers, SHAs and the ref, branch and label names into placeholders, so one endpoint
// is one row whatever it was called for.
//
// `GET rate_limit` is free — GitHub does not bill it to the core allowance — so `class_of` keeps it
// out of the REST total.

type CallClass = 'rest' | 'graphql' | 'gh' | 'free'

const API = 'api'
const GRAPHQL = 'graphql'
const RATE_LIMIT = 'GET rate_limit'
const GH_PREFIX = 'gh '
const DEFAULT_METHOD = 'GET'
const BODY_METHOD = 'POST'
const OWNER_REPO = ['repos', '{o}', '{r}'] as const
const NUMBER = /^\d+$/u
const SHA = /^[\da-f]{7,40}$/u
const { METHOD_FLAGS, FIELD_FLAGS: BODY_FLAGS, API_VALUE_TAKING_FLAGS: VALUE_FLAGS } = gh_api
const NAME_AFTER = new Map([
	['commits', '{ref}'],
	['branches', '{branch}'],
	['heads', '{branch}'],
	['labels', '{label}'],
	['compare', '{range}'],
])

function placeholder_of(segment: string, previous = ''): string {
	const named = NAME_AFTER.get(previous)
	if (named !== undefined) return named
	if (NUMBER.test(segment)) return '{n}'

	return SHA.test(segment) ? '{sha}' : segment
}

function normalized(path: string): string {
	const [bare = ''] = path.replace(/^\//u, '').split('?', 1)
	const segments = bare.split('/')
	const is_repo = segments[0] === OWNER_REPO[0]

	return segments
		.map((segment, index) =>
			is_repo && index < OWNER_REPO.length
				? OWNER_REPO[index]
				: placeholder_of(segment, segments[index - 1]),
		)
		.join('/')
}

function of_api(path: string, method: string = DEFAULT_METHOD): string {
	const bare = normalized(path)

	return bare === GRAPHQL ? GRAPHQL : `${method.toUpperCase()} ${bare}`
}

// The first argument after `api` that is neither a flag nor a flag's value.
function path_of(arguments_: ReadonlyArray<string>): string {
	const rest = arguments_.slice(1)

	return (
		rest.find(
			(argument, index) => !argument.startsWith('-') && !VALUE_FLAGS.has(rest[index - 1] ?? ''),
		) ?? ''
	)
}

// `gh api` sends GET, or POST once a body flag is present, unless `--method` names one.
function method_of(arguments_: ReadonlyArray<string>): string {
	const flag = arguments_.findIndex((argument) => METHOD_FLAGS.has(argument))
	if (flag !== -1) return arguments_[flag + 1] ?? DEFAULT_METHOD

	return arguments_.some((argument) => BODY_FLAGS.has(argument)) ? BODY_METHOD : DEFAULT_METHOD
}

function of(arguments_: ReadonlyArray<string>): string {
	const [subcommand = '', action = ''] = arguments_
	if (subcommand === API) return of_api(path_of(arguments_), method_of(arguments_))
	const named = action.startsWith('-') ? [subcommand] : [subcommand, action]

	return `${GH_PREFIX}${named.join(' ')}`.trimEnd()
}

function class_of(kind: string): CallClass {
	if (kind === GRAPHQL) return 'graphql'
	if (kind === RATE_LIMIT) return 'free'

	return kind.startsWith(GH_PREFIX) ? 'gh' : 'rest'
}

const gh_call_kind = { of, of_api, class_of }

export type { CallClass }
export { gh_call_kind }
