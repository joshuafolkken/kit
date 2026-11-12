import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_breakdown } from './lane-breakdown'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_net_time, type LaneSpan } from './lane-net-time'
import { lane_stage_budget } from './lane-stage-budget'
import type { ToolCall } from './lane-transcript-calls'

// Wall-clock accounting, separate from legacy lane net. Human wait wins over automatic wait;
// automatic wait wins over off-tool work. Parallel tool durations remain a separate cumulative value.
interface ElapsedTime {
	total_ms: number
	human_ms: number
	automatic_ms: number
	work_ms: number
	unclassified_ms: number
	tool_ms: number
	within_target: boolean
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])
const AUTOMATIC_STAGES: ReadonlySet<string> = new Set([
	'gate',
	'pre-detach',
	'followup',
	lane_ledger.CI_WAIT_STAGE,
])

function tool_spans(calls: ReadonlyArray<ToolCall>): Array<LaneSpan> {
	return calls.flatMap((call) =>
		call.duration_ms === undefined || EDIT_TOOLS.has(call.tool ?? '')
			? []
			: { from_ms: call.started_ms, to_ms: call.started_ms + call.duration_ms },
	)
}

function stage_spans(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<LaneSpan> {
	return entries.flatMap((entry) =>
		entry.kind === lane_ledger.KIND.STAGE &&
		entry.issue === issue &&
		AUTOMATIC_STAGES.has(entry.stage)
			? { from_ms: Date.parse(entry.at) - entry.elapsed_ms, to_ms: Date.parse(entry.at) }
			: [],
	)
}

function human_spans(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	span: LaneSpan,
): ReadonlyArray<LaneSpan> {
	return lane_net_time.hold_waits(
		entries,
		events.filter((event) => event.kind === 'park'),
		issue,
		span,
	)
}

function tool_ms(span: LaneSpan, calls: ReadonlyArray<ToolCall>): number {
	return tool_spans(calls).reduce((sum, call) => sum + lane_breakdown.covered_ms(span, [call]), 0)
}

function partition(
	span: LaneSpan,
	human: ReadonlyArray<LaneSpan>,
	automatic: ReadonlyArray<LaneSpan>,
	calls: ReadonlyArray<ToolCall>,
): ElapsedTime {
	const total_ms = span.to_ms - span.from_ms
	const human_ms = lane_breakdown.covered_ms(span, human)
	const occupied_ms = lane_breakdown.covered_ms(span, [...human, ...automatic])
	const remainder_ms = total_ms - occupied_ms

	return {
		total_ms,
		human_ms,
		automatic_ms: occupied_ms - human_ms,
		work_ms: calls.length > 0 ? remainder_ms : 0,
		unclassified_ms: calls.length > 0 ? 0 : remainder_ms,
		tool_ms: tool_ms(span, calls),
		within_target: total_ms <= lane_stage_budget.TARGET_MINUTES * MS_PER_MINUTE,
	}
}

function of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
	calls: ReadonlyArray<ToolCall>,
): ElapsedTime | undefined {
	const span = lane_net_time.span_of(entries, issue)
	if (span === undefined) return undefined
	const human = human_spans(entries, events, issue, span)
	const automatic = [
		...lane_net_time.automatic_waits(entries, events, issue, span),
		...stage_spans(entries, issue),
		...tool_spans(calls),
	]

	return partition(span, human, automatic, calls)
}

function text(timing: ElapsedTime): string {
	const minutes = lane_breakdown.minutes_text
	const status = timing.within_target ? 'within target' : 'over target'

	return [
		`End-to-end ${minutes(timing.total_ms)} (${status}); ${lane_stage_budget.DESCRIPTION}`,
		`Exclusive wall clock: off-tool work ${minutes(timing.work_ms)}; automatic wait ${minutes(timing.automatic_ms)}; human wait ${minutes(timing.human_ms)}; unclassified (missing transcripts) ${minutes(timing.unclassified_ms)}`,
		`Tool cumulative ${minutes(timing.tool_ms)} (parallel calls overlap; not additive to wall clock). Off-tool work includes unrecorded activity; automatic wait includes tool responses, gate, CI, yield, outage and sleep. Legacy net excludes more than human wait.`,
	].join('\n')
}

const lane_elapsed_time = { of, text }

export { lane_elapsed_time }
