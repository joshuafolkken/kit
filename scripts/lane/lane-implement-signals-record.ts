import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_implement_signals } from './lane-implement-signals'
import { lane_plan } from './lane-plan'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// Writes a lane's implement signals (`lane-implement-signals.ts`) once, as its run first reaches the
// gate (joshuafolkken/kit#6983): the counts stand for the implementation, not the review fixes after
// it. Best-effort, as every append to the stream is.

interface SignalsIo {
	read: () => Promise<ReadonlyArray<RunEvent>>
	emit: (kind: string, text: string) => Promise<void>
	calls: (issue: number) => ReadonlyArray<ToolCall>
	planned: (issue: number) => ReadonlyArray<string>
	root: string
}

// Every session of the lane's own transcript directories, from the first.
function lane_calls(issue: number): ReadonlyArray<ToolCall> {
	const directories = lane_breakdown_implement.transcript_directories(issue)

	return lane_transcript_stats.read_calls(directories, { since_ms: 0, until_ms: Date.now() })
}

function planned_paths(issue: number): ReadonlyArray<string> {
	const plan = lane_plan.read(issue, process.cwd())

	return [...(plan?.paths ?? []), ...(plan?.cleared_paths ?? [])]
}

const STREAM_IO: SignalsIo = {
	read: run_event_stream_emit.all_events,
	emit: run_event_stream_emit.emit,
	calls: lane_calls,
	planned: planned_paths,
	root: process.cwd(),
}

async function record(issue: string, io: SignalsIo = STREAM_IO): Promise<void> {
	const number = Number(issue)
	const events = await io.read()

	if (events.some((event) => lane_implement_signals.is_signals_of(event, number))) return

	const signals = lane_implement_signals.counts_of(io.calls(number), io.planned(number), io.root)

	await io.emit(lane_implement_signals.KIND, lane_implement_signals.text_of(issue, signals))
}

const lane_implement_signals_record = { record }

export { lane_implement_signals_record }
export type { SignalsIo }
