import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { json_value } from '#scripts/lib/json-value'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { z } from 'zod'

// GitHub's core REST allowance, read for the `run:board` usage row so a person watching a run sees the
// API running dry before reads start failing (joshuafolkken/kit#6559). `GET /rate_limit` does not count
// against the allowance. A failed, unparseable or misshapen read answers `undefined` and is not retried:
// the next scheduled read asks again.

interface CoreRateLimit {
	remaining: number
	limit: number
	// When the window refills, in epoch milliseconds — GitHub answers epoch seconds.
	reset_ms: number
}

const core_schema = z.object({
	remaining: z.number().int().nonnegative(),
	limit: z.number().int().positive(),
	reset: z.number().int().nonnegative(),
})

const CORE_REQUEST = { path: 'rate_limit', jq_filter: '.resources.core', should_retry: false }

function parse_core(text: string): CoreRateLimit | undefined {
	const core = json_value.parse_with(text, core_schema)
	if (core === undefined) return undefined

	return { remaining: core.remaining, limit: core.limit, reset_ms: core.reset * MS_PER_SECOND }
}

async function read_core(
	exec: typeof git_gh_exec.exec_gh_api = git_gh_exec.exec_gh_api,
): Promise<CoreRateLimit | undefined> {
	try {
		return parse_core(await exec(CORE_REQUEST))
	} catch {
		return undefined
	}
}

const run_board_rate_limit = { read_core }

export { run_board_rate_limit }
export type { CoreRateLimit }
