import { lane_implement_read } from './lane-implement-read'
import { lane_implement_stats } from './lane-implement-stats'
import type { ImplementLane } from './lane-implement-subagents'
import type { PausedSpans } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// The implement's `read` sub-stage tool time broken down by call kind (joshuafolkken/kit#7548), so a
// shortening Issue can pick its target: a josh run is `josh <subcommand>`, another Bash command its
// leading word past a `cd`, a subagent `Agent:<type>`, any other call its tool name.

const BASH_TOOL = 'Bash'
const AGENT_TOOL = 'Agent'
const CHANGE_DIRECTORY = 'cd'
const UNKNOWN = 'unknown'
const WORD_PATTERN = /\s+/u
const TOP_KINDS = 10
const COLUMNS = [
	'implement read by call',
	'calls',
	'lanes',
	'median per lane (min)',
	'total (min)',
] as const

interface CallTotal {
	calls: number
	ms: number
}

interface KindRow {
	kind: string
	lanes: ReadonlyArray<CallTotal>
	total_ms: number
}

// The first word of each segment the shell `command` runs, a leading `cd` passed over.
function leading_word(command: string): string {
	const words = lane_transcript_stats
		.command_segments(command)
		.map((segment) => segment.trim().split(WORD_PATTERN)[0] ?? '')
		.filter((word) => word !== '')

	return words.find((word) => word !== CHANGE_DIRECTORY) ?? words[0] ?? UNKNOWN
}

function bash_kind(command = ''): string {
	const josh = lane_transcript_stats.josh_commands(command)

	return josh.length > 0 ? `josh ${josh.join('+')}` : leading_word(command)
}

function agent_kind(call: ToolCall): string {
	return `${AGENT_TOOL}:${call.subagent?.type ?? UNKNOWN}`
}

function kind_of(call: ToolCall): string {
	if (call.tool === BASH_TOOL) return bash_kind(call.command)
	if (call.tool === AGENT_TOOL) return agent_kind(call)

	return call.tool ?? UNKNOWN
}

// One lane's read calls and their tool time, by kind.
function lane_kinds(lane: ImplementLane): Map<string, CallTotal> {
	const totals = new Map<string, CallTotal>()

	for (const entry of lane_implement_read.read_calls(lane)) {
		const kind = kind_of(entry.call)
		const total = totals.get(kind) ?? { calls: 0, ms: 0 }

		totals.set(kind, { calls: total.calls + 1, ms: total.ms + lane_implement_read.tool_ms(entry) })
	}

	return totals
}

// Each kind's per-lane totals, over the lanes that made such a call.
function by_kind(lanes: ReadonlyArray<Map<string, CallTotal>>): Array<KindRow> {
	const kinds = new Map<string, Array<CallTotal>>()
	const entries = lanes.flatMap((totals) => [...totals])

	for (const [kind, total] of entries) {
		kinds.set(kind, [...(kinds.get(kind) ?? []), total])
	}

	return [...kinds].map(([kind, totals]) => ({
		kind,
		lanes: totals,
		total_ms: lane_implement_read.sum(totals.map((total) => total.ms)),
	}))
}

function by_total(left: KindRow, right: KindRow): number {
	return right.total_ms - left.total_ms || left.kind.localeCompare(right.kind)
}

function kind_row({ kind, lanes, total_ms }: KindRow): Array<string> {
	return [
		kind,
		String(lane_implement_read.sum(lanes.map((total) => total.calls))),
		String(lanes.length),
		lane_stage_stats.cell(lane_stats.median(lanes.map((total) => total.ms))),
		lane_stage_stats.cell(total_ms),
	]
}

// The period's table: the kinds that took the most read tool time over the lanes that shipped in `window`.
function table(calls: ReadonlyArray<ToolCall>, window: StatsWindow, paused: PausedSpans): string {
	const lanes = lane_implement_stats
		.implement_lanes(calls, window, paused)
		.map((lane) => lane_kinds(lane))
	const rows = by_kind(lanes).toSorted(by_total).slice(0, TOP_KINDS)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...rows.map((row) => lane_stats.to_row(kind_row(row))),
	].join('\n')
}

const lane_implement_read_calls = { kind_of, table }

export { lane_implement_read_calls }
