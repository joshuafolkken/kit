import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { shared_cache, type CacheSlot } from '#scripts/josh/shared-cache'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { z } from 'zod'
import { backlog_next } from './backlog-next'

// One `josh backlog:next` answer shared by every reader that asks it within a minute
// (joshuafolkken/kit#4550).
//
// **The drive's assignment and the arrival probe each ask every minute, and since a lane waiting on its
// merge frees its slot (joshuafolkken/kit#4483) a free slot is the usual state** — so both read the
// whole pool from GitHub every minute, for the same answer.
//
// **The key carries the newest event on the run's stream**, so a launch, a merge or a park — anything
// that can change what may start — is never answered from before it: the first ask after it reads
// again. Only an answer that read is kept; a failure or a `retry` is asked again by the next reader.

const SUCCESS_EXIT_CODE = 0

const NEXT_CACHE: CacheSlot = { prefix: 'josh-backlog-next-', ttl_ms: 60_000 }

const result_schema = z.object({
	code: z.number(),
	out: z.string(),
	err: z.string().exactOptional(),
})

// The key a shared plan read is kept under: what was asked, and the newest event on the run's stream.
// `run:board`'s plan read keys by it too (joshuafolkken/kit#4558).
async function stream_key(scope: unknown): Promise<string> {
	const target = await run_event_stream_emit.stream_target()
	const last = target === undefined ? undefined : run_event_stream.read_last(target)

	return JSON.stringify({ argv: scope, last })
}

function is_kept(result: JoshResult): boolean {
	if (result.code !== SUCCESS_EXIT_CODE) return false

	return !result.out.split('\n').includes(backlog_next.VERDICT_TOKENS.retry)
}

// A kept answer replays its explanation where the live one would have streamed it.
function replay(result: JoshResult, should_forward_stderr: boolean): JoshResult {
	if (should_forward_stderr && result.err !== undefined && result.err !== '') {
		console.error(result.err)
	}

	return result
}

async function read(
	argv: ReadonlyArray<string>,
	should_forward_stderr = false,
	timeout_ms?: number,
): Promise<JoshResult> {
	const key = await stream_key(argv)
	const now_ms = Date.now()
	const kept = shared_cache.read(NEXT_CACHE, key, result_schema, now_ms)

	if (kept !== undefined) return replay(kept, should_forward_stderr)

	const result = await josh_command.josh_run(argv, should_forward_stderr, timeout_ms)

	if (is_kept(result)) shared_cache.write(NEXT_CACHE, key, result, now_ms)

	return result
}

const backlog_next_shared = { NEXT_CACHE, read, stream_key }

export { backlog_next_shared }
