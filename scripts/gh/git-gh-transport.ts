import { shared_cache, type CacheSlot } from '#scripts/josh/shared-cache'
import { error_text } from '#scripts/lib/error-message'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { git_gh_exec } from './git-gh-exec'
import { gh_failure } from './git-gh-failure'
import { gh_rate_limit } from './git-gh-rate-limit'

// Which transport a session's GitHub reads take (joshuafolkken/kit#6784): GraphQL, metered apart
// from the 5,000-per-hour REST core budget, or REST alone where GraphQL is refused (a cloud session
// answers 403). The one place a GraphQL read is sent and its refusal handled — a reader asks `query`
// and reads REST on `undefined`, with no fallback of its own.
//
// `JOSH_GH_TRANSPORT` picks it:
// - `auto` (the default): one `viewer` probe (1 point) per hour, kept in the shared cache under the
//   gh host and login, so every process and lane of the repository reuses it. A later 403 switches
//   the record to `rest` for the rest of the hour.
// - `rest`: no GraphQL request is sent.
// - `graphql`: a refusal is a stop with its reason, never a silent REST read.
//
// A failure other than a refusal (one unresolvable id fails a whole `nodes` document, a timeout) is
// that one read's, so it reads through REST without changing the session's transport.

const TRANSPORT_ENV_VAR = 'JOSH_GH_TRANSPORT'
const GRAPHQL_PATH = 'graphql'
const FORBIDDEN_STATUS = 403
const MS_KEPT = 3_600_000
const DEFAULT_HOST = 'github.com'
const PROBE_QUERY = 'query { viewer { login } }'
const NOT_PROBED = 'not probed'

const TRANSPORT_CACHE: CacheSlot = { prefix: 'josh-gh-transport-', ttl_ms: MS_KEPT }

const REFUSED_MESSAGE = `GitHub refused a GraphQL read, and ${TRANSPORT_ENV_VAR}=graphql forbids reading it through REST — set it to auto or rest to read where GraphQL is refused`

const partial_document_schema = z.looseObject({
	data: z.looseObject({}),
	errors: z.array(z.unknown()).nonempty(),
})

const transport_schema = z.enum(['graphql', 'rest'])
const setting_schema = z.enum(['auto', 'graphql', 'rest'])

type Transport = z.infer<typeof transport_schema>
type TransportSetting = z.infer<typeof setting_schema>

interface GraphqlBody {
	query: string
	variables?: object
}

// One `gh config get` per host and process: the login the cache record is keyed under.
const logins = new Map<string, Promise<string>>()

function parse_setting(raw: string | undefined): TransportSetting | undefined {
	if (raw === undefined || raw === '') return 'auto'

	return setting_schema.safeParse(raw).data
}

function setting(): TransportSetting {
	const raw = process.env[TRANSPORT_ENV_VAR]
	const parsed = parse_setting(raw)

	if (parsed === undefined) {
		throw new Error(`${TRANSPORT_ENV_VAR} must be auto, graphql or rest, not ${String(raw)}`)
	}

	return parsed
}

async function read_login(host: string): Promise<string> {
	try {
		return await git_gh_exec.exec_gh_command(['config', 'get', 'user', '--host', host])
	} catch {
		return ''
	}
}

async function key_of(): Promise<string> {
	const host = process.env['GH_HOST'] ?? DEFAULT_HOST
	const login = logins.get(host) ?? read_login(host)

	logins.set(host, login)

	return `${host}/${await login}`
}

// A 403 that names a rate limit is that one read's throttling, not a refusal of the session.
function is_refused(error: unknown): boolean {
	if (gh_failure.failure_of(error)?.status !== FORBIDDEN_STATUS) return false

	return !gh_rate_limit.is_exhausted(error_text.message_of(error))
}

async function send(body: GraphqlBody): Promise<string> {
	return await git_gh_exec.exec_gh_api({ path: GRAPHQL_PATH, body: JSON.stringify(body) })
}

// `undefined` is a failure that says nothing about the session, which is probed again next time.
async function probe(): Promise<Transport | undefined> {
	try {
		await send({ query: PROBE_QUERY })

		return 'graphql'
	} catch (error) {
		return is_refused(error) ? 'rest' : undefined
	}
}

async function current(now_ms: number = Date.now()): Promise<Transport> {
	const chosen = setting()
	if (chosen !== 'auto') return chosen

	const request = { slot: TRANSPORT_CACHE, key: await key_of(), schema: transport_schema }

	return (await shared_cache.remember(request, probe, now_ms)) ?? 'graphql'
}

async function on_failure(error: unknown, now_ms: number): Promise<void> {
	if (!is_refused(error)) return
	if (setting() === 'graphql') throw new Error(REFUSED_MESSAGE, { cause: error })

	shared_cache.write(TRANSPORT_CACHE, await key_of(), 'rest' satisfies Transport, now_ms)
}

// What a failed read still answers: the partial document `query_partial` keeps; absent, nothing.
type Recovered = (error: unknown) => string | undefined

// A document whose `errors` sit beside answered `data` — one alias that resolved to nothing.
function partial_answer(error: unknown): string | undefined {
	const body = gh_failure.body_of(error)
	if (body === undefined) return undefined

	return json_value.parse_with(body, partial_document_schema) === undefined ? undefined : body
}

async function sent_or_failed(
	body: GraphqlBody,
	now_ms: number,
	recovered?: Recovered,
): Promise<string | undefined> {
	try {
		return await send(body)
	} catch (error) {
		await on_failure(error, now_ms)

		return recovered?.(error)
	}
}

async function answer_of(
	body: GraphqlBody,
	now_ms: number,
	recovered?: Recovered,
): Promise<string | undefined> {
	if ((await current(now_ms)) === 'rest') return undefined

	return await sent_or_failed(body, now_ms, recovered)
}

// The answer's JSON, or `undefined` for the caller to read through REST.
async function query(body: GraphqlBody, now_ms: number = Date.now()): Promise<string | undefined> {
	return await answer_of(body, now_ms)
}

// `query`, but a document with `errors` beside non-null `data` is the answer, for a reader whose
// unanswered aliases are `null` and read through REST one by one (joshuafolkken/kit#6964).
async function query_partial(
	body: GraphqlBody,
	now_ms: number = Date.now(),
): Promise<string | undefined> {
	return await answer_of(body, now_ms, partial_answer)
}

async function kept(now_ms: number): Promise<Transport | undefined> {
	return shared_cache.read(TRANSPORT_CACHE, await key_of(), transport_schema, now_ms)
}

// The session's transport as far as it is known without a probe: the explicit setting, the kept
// answer under `auto`, or `undefined` (not probed this hour, or an invalid setting).
async function known(now_ms: number = Date.now()): Promise<Transport | undefined> {
	const chosen = parse_setting(process.env[TRANSPORT_ENV_VAR])
	if (chosen === undefined) return undefined

	return chosen === 'auto' ? await kept(now_ms) : chosen
}

// The session's transport for a display, read without a probe: `graphql (auto)`, `not probed (auto)`.
async function label(now_ms: number = Date.now()): Promise<string> {
	const chosen = parse_setting(process.env[TRANSPORT_ENV_VAR])
	if (chosen === undefined) return `invalid ${TRANSPORT_ENV_VAR}`
	if (chosen !== 'auto') return chosen

	return `${(await kept(now_ms)) ?? NOT_PROBED} (auto)`
}

function forget_logins(): void {
	logins.clear()
}

const git_gh_transport = {
	current,
	forget_logins,
	known,
	label,
	query,
	query_partial,
	TRANSPORT_CACHE,
}

export type { GraphqlBody, Transport }
export { git_gh_transport, GRAPHQL_PATH, PROBE_QUERY, REFUSED_MESSAGE, TRANSPORT_ENV_VAR }
