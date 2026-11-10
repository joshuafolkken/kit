import { json_value } from '#scripts/lib/json-value'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { z } from 'zod'
import type { CoreUsage } from './gh-request-tally'
import { git_gh_exec, type GhApiRequest } from './git-gh-exec'

// GitHub's core REST allowance. `run:board` reads it for its usage row, so a person watching a run
// sees the API running dry before reads start failing (joshuafolkken/kit#6559). The request tally
// reads `used` around a process's calls (joshuafolkken/kit#6697). `GET /rate_limit` does not count
// against the allowance. A failed, unparseable or misshapen read answers `undefined` and is not
// retried: the next read asks again.

interface CoreRateLimit {
	remaining: number
	limit: number
	// When the window refills, in epoch milliseconds — GitHub answers epoch seconds.
	reset_ms: number
}

// The REST core allowance beside the GraphQL one, which has its own limit and reset
// (joshuafolkken/kit#6822); a misshapen GraphQL resource reads as none and leaves the core.
interface RateLimitResources {
	core: CoreRateLimit
	graphql: CoreRateLimit | undefined
}

interface CoreAllowance extends CoreUsage {
	remaining: number
}

type CoreExec = (request: GhApiRequest) => Promise<string>

type KeptReader<T> = (exec: CoreExec) => Promise<T | undefined>

interface Kept<T> {
	at_ms: number
	value: T
}

// joshuafolkken/kit#7150: one process reads the allowance again and again (the `run:board` row,
// `backlog:drive`'s floor, `run:merge`'s reset), and it moves little within a few seconds, so a
// counted read answered under `FRESH_MS` ago is answered again. A failed read is not kept.
const FRESH_MS = 30_000

const core_schema = z.object({
	used: z.number().int().nonnegative(),
	remaining: z.number().int().nonnegative(),
	limit: z.number().int().positive(),
	reset: z.number().int().nonnegative(),
})

// jq answers `null` for a resource the reply lacks, which reads as none like a misshapen one.
const resources_schema = z.object({
	core: core_schema,
	graphql: core_schema.optional().catch(undefined),
})

type Core = z.infer<typeof core_schema>

const CORE_REQUEST = { path: 'rate_limit', jq_filter: '.resources.core', should_retry: false }
const RESOURCES_REQUEST = {
	path: 'rate_limit',
	jq_filter: '.resources | {core, graphql}',
	should_retry: false,
}

async function read_with<T>(
	exec: CoreExec,
	request: GhApiRequest,
	schema: z.ZodType<T>,
): Promise<T | undefined> {
	try {
		return json_value.parse_with(await exec(request), schema)
	} catch {
		return undefined
	}
}

// Kept per exec, so an injected one never answers from the live one's reading.
function kept_reader<T>(request: GhApiRequest, schema: z.ZodType<T>): KeptReader<T> {
	const kept = new Map<CoreExec, Kept<T>>()

	return async function read(exec: CoreExec): Promise<T | undefined> {
		const now_ms = Date.now()
		const entry = kept.get(exec)
		if (entry !== undefined && now_ms - entry.at_ms < FRESH_MS) return entry.value

		const value = await read_with(exec, request, schema)

		if (value !== undefined) kept.set(exec, { at_ms: now_ms, value })

		return value
	}
}

const read_kept_core = kept_reader(CORE_REQUEST, core_schema)
const read_kept_resources = kept_reader(RESOURCES_REQUEST, resources_schema)

async function read_parsed(exec: CoreExec): Promise<Core | undefined> {
	return await read_with(exec, CORE_REQUEST, core_schema)
}

function limit_of(core: Core): CoreRateLimit {
	return { remaining: core.remaining, limit: core.limit, reset_ms: core.reset * MS_PER_SECOND }
}

async function read_core(
	exec: CoreExec = git_gh_exec.exec_gh_api,
): Promise<CoreRateLimit | undefined> {
	const core = await read_kept_core(exec)

	return core === undefined ? undefined : limit_of(core)
}

// Both allowances off the one `rate_limit` reply, so the GraphQL one costs no further request.
async function read_resources(
	exec: CoreExec = git_gh_exec.exec_gh_api,
): Promise<RateLimitResources | undefined> {
	const resources = await read_kept_resources(exec)
	if (resources === undefined) return undefined

	const { core, graphql } = resources

	return { core: limit_of(core), graphql: graphql === undefined ? undefined : limit_of(graphql) }
}

// The tally's reading goes through the uncounted spawn: it is the measurement, not a measured call.
async function read_usage(
	exec: CoreExec = git_gh_exec.exec_gh_api_uncounted,
): Promise<CoreUsage | undefined> {
	const core = await read_parsed(exec)
	if (core === undefined) return undefined

	return { used: core.used, reset_ms: core.reset * MS_PER_SECOND }
}

// `backlog:drive`'s per-offer reading (joshuafolkken/kit#6558): the usage with what is left, uncounted
// for the same reason as `read_usage`.
async function read_allowance(
	exec: CoreExec = git_gh_exec.exec_gh_api_uncounted,
): Promise<CoreAllowance | undefined> {
	const core = await read_parsed(exec)
	if (core === undefined) return undefined

	return { used: core.used, remaining: core.remaining, reset_ms: core.reset * MS_PER_SECOND }
}

const gh_core_rate_limit = { read_allowance, read_core, read_resources, read_usage }

export { gh_core_rate_limit }
export type { CoreAllowance, CoreRateLimit, RateLimitResources }
