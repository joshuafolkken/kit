import { gh_core_rate_limit, type CoreAllowance } from '#scripts/gh/gh-core-rate-limit'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'

// GitHub's REST core rate limit, read before and after each `backlog:drive` offer cycle, so the run's
// events carry what the account spent across a cycle (joshuafolkken/kit#6558). The cycle measured is
// the `backlog:offer` read: a named offer answers from the carry record without it, and is left
// unmeasured so a drive with nothing to read spends no `gh` spawn either. `used` is account-wide:
// lanes and other processes on the same account add to it, so a cycle's delta is an upper bound on
// what the cycle itself spent. `gh api rate_limit` spends none of it.
// **A failed read never stops the offer**: the cycle's event is written as missing instead.

const { EVENT_KIND } = run_event_stream

interface CycleRecord {
	used_delta: number
	remaining: number
	reset: string
}

interface MissingRecord {
	is_missing: true
}

// A cycle that crossed the hourly reset counts from the new window's zero, so its delta is the
// later `used` rather than a negative difference.
function used_delta(before: CoreAllowance, after: CoreAllowance): number {
	return before.reset_ms === after.reset_ms ? after.used - before.used : after.used
}

function record_of(
	before: CoreAllowance | undefined,
	after: CoreAllowance | undefined,
): CycleRecord | MissingRecord {
	if (before === undefined || after === undefined) return { is_missing: true }

	return {
		used_delta: used_delta(before, after),
		remaining: after.remaining,
		reset: new Date(after.reset_ms).toISOString(),
	}
}

/** Run one offer cycle and append its `rate-limit` event; the cycle's own answer is returned untouched. */
async function measured<T>(cycle: () => Promise<T>): Promise<T> {
	const before = await gh_core_rate_limit.read_allowance()
	const result = await cycle()
	const after = await gh_core_rate_limit.read_allowance()

	await run_event_stream_emit.emit(EVENT_KIND.RATE_LIMIT, JSON.stringify(record_of(before, after)))

	return result
}

/** The drive's `backlog:offer` read, run as the measured cycle. */
async function offer_run(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await measured(async () => await josh_command.josh_run(argv, true))
}

const backlog_drive_rate = { measured, offer_run }

export { backlog_drive_rate }
