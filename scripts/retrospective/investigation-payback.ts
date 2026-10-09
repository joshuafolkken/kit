import { cost_format } from '#scripts/cost-runtime/cost-format'
import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage } from '#scripts/cost-runtime/cost-usage'
import { cost_run_nodes, type RunNode } from '#scripts/cost/cost-run-nodes'
import { investigation_reads } from '#scripts/delegation/investigation-reads'
import { json_value } from '#scripts/lib/json-value'
import {
	time_transcript_line,
	type Block,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'
import { guard_friction, type SessionTranscript } from './guard-friction'

// Whether the investigation guard's forced delegation pays its way.
//
// The run's main-line sessions — parent, wakes, lane children — are split by whether they dispatched
// an investigator. Each group reports the context its requests carried, which delegating is meant to
// keep down, against what the guard cost: its refusals' round trips plus the investigator units' own
// spend. **A unit is matched to its dispatch by time** — a subagent of the session whose first
// request falls inside an investigator call's span — because no line of the parent names the unit's
// transcript; a second unit of another kind running inside that span would be counted with it.

// The guard's label, read off its own reason the way every refusal's is, so the two cannot drift.
const INVESTIGATION_GUARD = time_transcript_line.guard_from_refusal(investigation_reads.REASON)
const AGENT_PREFIX_SEPARATOR = ':'

interface CallWindow {
	start_ms: number
	end_ms: number
}

interface PaybackGroup {
	sessions: number
	mean_context: number
	mean_peak_context: number
	refusals: number
	guard_usd: number
}

interface SessionPayback {
	is_delegated: boolean
	mean_context: number
	peak_context: number
	refusals: number
	guard_usd: number
}

interface TimedBlock {
	block: Block
	at_ms: number
}

function subagent_type_of(input: unknown): string {
	const type = json_value.is_record(input) ? input['subagent_type'] : undefined

	return typeof type === 'string' ? type : ''
}

// `investigator` here, `kit:investigator` in a consumer, so the name is read after any plugin prefix.
function is_investigator_call(block: Block): boolean {
	if (!investigation_reads.DELEGATION_TOOLS.has(block.name)) return false

	const type = subagent_type_of(block.input).split(AGENT_PREFIX_SEPARATOR).at(-1)

	return type === investigation_reads.INVESTIGATOR_AGENT
}

function timed_blocks(lines: ReadonlyArray<TranscriptLine>): Array<TimedBlock> {
	return lines.flatMap((line) => line.blocks.map((block) => ({ block, at_ms: line.timestamp_ms })))
}

// A call with no result yet is still running, so its window stays open.
function call_windows(lines: ReadonlyArray<TranscriptLine>): Array<CallWindow> {
	const blocks = timed_blocks(lines)
	const calls = blocks.filter((one) => is_investigator_call(one.block))

	return calls.map((call) => ({
		start_ms: call.at_ms,
		end_ms: blocks.find((one) => one.block.result_id === call.block.id)?.at_ms ?? Infinity,
	}))
}

function is_inside(windows: ReadonlyArray<CallWindow>, at_ms: number): boolean {
	return windows.some((window) => at_ms >= window.start_ms && at_ms <= window.end_ms)
}

function units_usd(
	session_id: string,
	windows: ReadonlyArray<CallWindow>,
	nodes: ReadonlyArray<RunNode>,
): number {
	const units = nodes.filter(
		(node) =>
			node.role === 'subagent' &&
			node.parent_id === session_id &&
			is_inside(windows, cost_run_nodes.started_ms(node.records)),
	)

	return cost_pricing.cost_of(units.flatMap((unit) => unit.records))
}

function mean(values: ReadonlyArray<number>): number {
	return values.length === 0 ? 0 : values.reduce((total, one) => total + one, 0) / values.length
}

function session_payback(
	session: SessionTranscript,
	nodes: ReadonlyArray<RunNode>,
): SessionPayback {
	const contexts = session.node.records.map((record) => cost_usage.billed_input(record.totals))
	const windows = call_windows(session.lines)
	const guard = guard_friction
		.guard_rows([session])
		.find((row) => row.guard === INVESTIGATION_GUARD)

	return {
		is_delegated: windows.length > 0,
		mean_context: mean(contexts),
		peak_context: Math.max(0, ...contexts),
		refusals: guard?.refusals ?? 0,
		guard_usd: (guard?.usd ?? 0) + units_usd(session.node.session_id, windows, nodes),
	}
}

function to_group(rows: ReadonlyArray<SessionPayback>): PaybackGroup {
	return {
		sessions: rows.length,
		mean_context: mean(rows.map((row) => row.mean_context)),
		mean_peak_context: mean(rows.map((row) => row.peak_context)),
		refusals: rows.reduce((total, row) => total + row.refusals, 0),
		guard_usd: rows.reduce((total, row) => total + row.guard_usd, 0),
	}
}

// The main-line sessions with any request, split into those that delegated and those that did not.
function groups(sessions: ReadonlyArray<SessionTranscript>): {
	delegated: PaybackGroup
	kept: PaybackGroup
} {
	const nodes = sessions.map((session) => session.node)
	const rows = sessions
		.filter((session) => session.node.role !== 'subagent' && session.node.records.length > 0)
		.map((session) => session_payback(session, nodes))

	return {
		delegated: to_group(rows.filter((row) => row.is_delegated)),
		kept: to_group(rows.filter((row) => !row.is_delegated)),
	}
}

function tokens(count: number): string {
	return cost_format.format_tokens(Math.round(count))
}

function group_line(name: string, group: PaybackGroup): string {
	const context = `mean context ${tokens(group.mean_context)}, mean peak ${tokens(group.mean_peak_context)}`
	const cost = `${String(group.refusals)} refusal(s), guard cost ${cost_format.format_usd(group.guard_usd)}`

	return `  ${name}: ${String(group.sessions)} session(s), ${context}, ${cost}`
}

function report_lines(sessions: ReadonlyArray<SessionTranscript>): Array<string> {
	const { delegated, kept } = groups(sessions)

	return [
		'Investigation guard payback (main-line sessions):',
		group_line('delegated', delegated),
		group_line('not delegated', kept),
	]
}

const investigation_payback = { INVESTIGATION_GUARD, groups, report_lines }

export type { PaybackGroup }
export { investigation_payback }
