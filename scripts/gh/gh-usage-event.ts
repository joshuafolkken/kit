import { error_text } from '#scripts/lib/error-message'
import { run_carry } from '#scripts/run/carry/run-carry'
import { gh_request_tally, type CallCount } from './gh-request-tally'
import { gh_usage_log } from './gh-usage-log'

// One line per josh process with its GitHub usage, written as the process ends (joshuafolkken/kit#6695):
// the command, the issue it ran for, the request tally's calls and 304 answers, the core `used`
// difference and the run time. A process that sent no `gh` call writes nothing. A process may reach
// its end on more than one path, so only the first `write` writes. The write never fails the
// command it records: a failed reading leaves the difference out, and a failed append is dropped.
// The line goes to `gh-usage-log.ts`'s file, not the run's event stream (joshuafolkken/kit#6707).

interface GhUsageContext {
	command: string
	issue?: number | undefined
	// When the process started, in epoch milliseconds.
	started_ms: number
}

// One process's line. `JSON.stringify` leaves out an absent issue or difference rather than writing
// it as null.
interface GhUsageLine {
	at: string
	command: string
	issue?: number | undefined
	calls: number
	not_modified: number
	core_used_delta?: number | undefined
	elapsed_ms: number
	// The calls and 304s per call kind (`gh-call-kind.ts`); a line written before
	// joshuafolkken/kit#6867 has none.
	endpoints: Record<string, CallCount>
}

type UsageAppend = (line: GhUsageLine) => Promise<void>

const state = { is_written: false }

// Outside a git repository there is no run state to key on, and no log.
async function append_to_log(line: GhUsageLine): Promise<void> {
	const repository = await run_carry.repository_directory()

	if (repository !== undefined) gh_usage_log.append(gh_usage_log.target_of(repository), line)
}

async function append_usage(context: GhUsageContext, append: UsageAppend): Promise<void> {
	const core_used_delta = await gh_request_tally.core_delta()
	const { calls, not_modified, endpoints } = gh_request_tally.snapshot()
	const ended_ms = Date.now()

	await append({
		at: new Date(ended_ms).toISOString(),
		command: context.command,
		issue: context.issue,
		calls,
		not_modified,
		core_used_delta,
		elapsed_ms: ended_ms - context.started_ms,
		endpoints,
	})
}

async function write(context: GhUsageContext, append: UsageAppend = append_to_log): Promise<void> {
	if (state.is_written || gh_request_tally.snapshot().calls === 0) return
	state.is_written = true

	try {
		await append_usage(context, append)
	} catch (error) {
		error_text.trace_swallowed('gh_usage_event.write', error)
	}
}

// For tests: the one write belongs to the process, so each test starts it unwritten.
function reset(): void {
	state.is_written = false
}

const gh_usage_event = { write, reset }

export type { GhUsageContext, GhUsageLine }
export { gh_usage_event }
