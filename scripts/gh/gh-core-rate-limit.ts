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

interface CoreAllowance extends CoreUsage {
	remaining: number
}

type CoreExec = (request: GhApiRequest) => Promise<string>

const core_schema = z.object({
	used: z.number().int().nonnegative(),
	remaining: z.number().int().nonnegative(),
	limit: z.number().int().positive(),
	reset: z.number().int().nonnegative(),
})

type Core = z.infer<typeof core_schema>

const CORE_REQUEST = { path: 'rate_limit', jq_filter: '.resources.core', should_retry: false }

async function read_parsed(exec: CoreExec): Promise<Core | undefined> {
	try {
		return json_value.parse_with(await exec(CORE_REQUEST), core_schema)
	} catch {
		return undefined
	}
}

async function read_core(
	exec: CoreExec = git_gh_exec.exec_gh_api,
): Promise<CoreRateLimit | undefined> {
	const core = await read_parsed(exec)
	if (core === undefined) return undefined

	return { remaining: core.remaining, limit: core.limit, reset_ms: core.reset * MS_PER_SECOND }
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

const gh_core_rate_limit = { read_allowance, read_core, read_usage }

export { gh_core_rate_limit }
export type { CoreAllowance, CoreRateLimit }
