import { error_text } from '#scripts/lib/error-message'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { gh_request_tally } from './gh-request-tally'

// One event per josh process with its GitHub usage, written as the process ends (joshuafolkken/kit#6695):
// the command, the issue it ran for, the request tally's calls and 304 answers, the core `used`
// difference and the run time. A process that sent no `gh` call writes nothing. A process may reach
// its end on more than one path, so only the first `write` writes. The write never fails the
// command it records: a failed reading leaves the difference out, and a failed append is dropped.

interface GhUsageContext {
	command: string
	issue?: number
	// When the process started, in epoch milliseconds.
	started_ms: number
}

type UsageAppend = (event: Omit<RunEvent, 'pos'>) => Promise<void>

const state = { is_written: false }

async function append_to_stream(event: Omit<RunEvent, 'pos'>): Promise<void> {
	const target = await run_event_stream_emit.stream_target()

	if (target !== undefined) run_event_stream.append_event(target, event)
}

// `JSON.stringify` leaves out an absent issue or difference rather than writing it as null.
async function usage_text(context: GhUsageContext): Promise<string> {
	const core_used_delta = await gh_request_tally.core_delta()
	const { calls, not_modified } = gh_request_tally.snapshot()

	return JSON.stringify({
		command: context.command,
		issue: context.issue,
		calls,
		not_modified,
		core_used_delta,
	})
}

async function append_usage(context: GhUsageContext, append: UsageAppend): Promise<void> {
	const text = await usage_text(context)
	const ended_ms = Date.now()

	await append({
		at: new Date(ended_ms).toISOString(),
		kind: run_event_stream.EVENT_KIND.GH_USAGE,
		text,
		elapsed_ms: ended_ms - context.started_ms,
	})
}

async function write(
	context: GhUsageContext,
	append: UsageAppend = append_to_stream,
): Promise<void> {
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

export type { GhUsageContext }
export { gh_usage_event }
