import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_calls, type CallGroup } from './lane-breakdown-calls'
import { lane_implement_stats } from './lane-implement-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_net_time, type LaneSpan } from './lane-net-time'
import type { Subagent, ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// The implementation stage of a lane's breakdown (joshuafolkken/kit#4995) split by what its tool calls
// spent, read off the lane's transcripts: the main josh commands, the subagents, the reads and the rest
// of Bash, and what no call spent — the edits and the thinking. A backgrounded call has no duration
// (`lane-transcript-calls.ts`), so the wait on its result falls in the remainder; only its count shows.
//
// **The subagents split by the agent dispatched** — `subagent: investigator`, `subagent: reviewer`, …
// — and a backgrounded subagent call still names its kind, at no time, with its count beside it
// (joshuafolkken/kit#5297). `run:review` and `ship` / `ship:wait` count apart from other bash
// (joshuafolkken/kit#5293).

const REMAINDER = 'editing & thinking'
const OTHER_BASH = 'other bash'
const BASH_TOOL = 'Bash'
const READ = 'read'
const EDIT = 'edit'
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])

const TOOL_KINDS: ReadonlyMap<string, string> = new Map([
	['Read', READ],
	['Grep', READ],
	['Glob', READ],
])

// Between two ship stages an edit counts as its own kind (joshuafolkken/kit#5834); inside the
// implementation it stays in the remainder, its editing.
const BETWEEN_TOOL_KINDS: ReadonlyMap<string, string> = new Map([
	...TOOL_KINDS,
	...[...lane_implement_stats.EDIT_TOOLS].map((tool) => [tool, EDIT] as const),
])

const COMMAND_KINDS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bjosh main:merge\b/u, 'main:merge'],
	[/\bjosh check:related\b/u, 'check:related'],
	[/\bjosh gate\b/u, 'gate'],
	// Match each chain's own arguments, so a join flag on another command cannot rename its open.
	[/\bjosh run:chain\b[^;&|\n]*\s--join\b/u, 'run:chain join'],
	[/\bjosh run:chain\b/u, 'run:chain open'],
	[/\bjosh run:review\b/u, 'run:review'],
	// Not `\b`: it holds before the `:` of `ship:evidence`, whose wrapped command is its own kind.
	[/\bjosh ship(?::wait)?(?![\w:-])/u, 'ship / ship:wait'],
	[/\bjosh test(?::[\w-]+)?\b/u, 'test'],
	[/\bjosh (?:lint|cspell)(?::[\w-]+)?\b/u, 'lint / cspell'],
]

interface ImplementDetail {
	// Longest first, the remainder among them.
	kinds: ReadonlyArray<Stage>
	// The calls backgrounded inside the implementation.
	background: number
	// Each subagent kind's backgrounded calls, counted at no time.
	untimed: ReadonlyMap<string, number>
	// Each kind's longest call groups (joshuafolkken/kit#5539).
	calls?: ReadonlyMap<string, ReadonlyArray<CallGroup>>
}

interface PlanOutside {
	ms: number
	background: number
}

function command_kind(command: string): string {
	return COMMAND_KINDS.find(([pattern]) => pattern.test(command))?.[1] ?? OTHER_BASH
}

function subagent_kind(subagent: Subagent): string {
	return `subagent: ${subagent.type}`
}

// The kind a call counts under, `undefined` for one that falls in the remainder (under `TOOL_KINDS`
// an edit included).
function kind_of(call: ToolCall, tool_kinds: ReadonlyMap<string, string>): string | undefined {
	if (call.tool === BASH_TOOL) return command_kind(call.command ?? '')
	if (call.subagent !== undefined) return subagent_kind(call.subagent)

	return tool_kinds.get(call.tool ?? '')
}

interface TimedPart extends Stage {
	from_ms: number
	call: ToolCall
}

function is_untimed_subagent(call: ToolCall): boolean {
	return call.background && call.subagent !== undefined
}

function end_ms(call: ToolCall): number {
	return call.started_ms + (call.duration_ms ?? 0)
}

// A call's own milliseconds, cut at both ends of `span`; a backgrounded subagent call's none.
function timed_part(
	call: ToolCall,
	span: LaneSpan,
	tool_kinds: ReadonlyMap<string, string>,
): ReadonlyArray<TimedPart> {
	const name = kind_of(call, tool_kinds)

	if (name === undefined) return []

	const from_ms = Math.max(call.started_ms, span.from_ms)
	const ms = Math.min(end_ms(call), span.to_ms) - from_ms
	const is_counted = call.duration_ms !== undefined || is_untimed_subagent(call)

	return is_counted ? [{ name, ms, from_ms, call }] : []
}

function untimed_of(placed: ReadonlyArray<readonly [ToolCall, LaneSpan]>): Map<string, number> {
	const counts = new Map<string, number>()
	const kinds = placed
		.filter(([call]) => is_untimed_subagent(call))
		.map(([call]) => kind_of(call, TOOL_KINDS))

	for (const kind of kinds) if (kind !== undefined) counts.set(kind, (counts.get(kind) ?? 0) + 1)

	return counts
}

// What neither a timed call nor a wait covers of `spans`, each millisecond once.
function remainder_ms(
	parts: ReadonlyArray<TimedPart>,
	spans: ReadonlyArray<LaneSpan>,
	waits: ReadonlyArray<LaneSpan>,
): number {
	const busy = parts.map((part) => ({ from_ms: part.from_ms, to_ms: part.from_ms + part.ms }))
	const covering = [...busy, ...waits]
	const idle = spans.map(
		(span) => span.to_ms - span.from_ms - lane_breakdown.covered_ms(span, covering),
	)

	return idle.reduce((sum, ms) => sum + ms, 0)
}

function span_of(call: ToolCall, spans: ReadonlyArray<LaneSpan>): LaneSpan | undefined {
	return spans.find((span) => call.started_ms >= span.from_ms && call.started_ms < span.to_ms)
}

function placed_of(
	calls: ReadonlyArray<ToolCall>,
	spans: ReadonlyArray<LaneSpan>,
): Array<readonly [ToolCall, LaneSpan]> {
	return calls.flatMap((call) => {
		const span = span_of(call, spans)

		return span === undefined ? [] : [[call, span] as const]
	})
}

// Whether `call` ran inside `span` — started in it, or started before and still running at its start.
function is_overlapping(call: ToolCall, span: LaneSpan): boolean {
	return call.started_ms < span.to_ms && Math.max(call.started_ms + 1, end_ms(call)) > span.from_ms
}

// Each span paired with every call that ran inside it, so a call that began before is counted too.
function overlapping_of(
	calls: ReadonlyArray<ToolCall>,
	spans: ReadonlyArray<LaneSpan>,
): Array<readonly [ToolCall, LaneSpan]> {
	return spans.flatMap((span) =>
		calls.filter((call) => is_overlapping(call, span)).map((call) => [call, span] as const),
	)
}

// The implementation split by the calls made inside it — parallel calls each count their own time, so
// the kinds can add up to more — and the remainder, the time no call and no wait covered.
function of(calls: ReadonlyArray<ToolCall>, breakdown: Breakdown): ImplementDetail {
	const placed = placed_of(calls, breakdown.implement)
	const parts = placed.flatMap(([call, span]) => timed_part(call, span, TOOL_KINDS))
	const remainder = {
		name: REMAINDER,
		ms: remainder_ms(parts, breakdown.implement, breakdown.waits),
	}

	return {
		kinds: lane_breakdown.ranked([...parts, remainder]),
		background: placed.filter(([call]) => call.background).length,
		untimed: untimed_of(placed),
		calls: lane_breakdown_calls.by_kind(parts),
	}
}

// The start to plan's timed calls, each cut at its span.
function plan_parts(calls: ReadonlyArray<ToolCall>, breakdown: Breakdown): Array<TimedPart> {
	const placed = placed_of(calls, breakdown.plan ?? [])

	return placed.flatMap(([call, span]) => timed_part(call, span, TOOL_KINDS))
}

// The longest call groups of the start to plan (joshuafolkken/kit#5539), a `lint:related` among them
// with its timing line (joshuafolkken/kit#5712).
function plan_calls(calls: ReadonlyArray<ToolCall>, breakdown: Breakdown): Array<CallGroup> {
	const timed = plan_parts(calls, breakdown)

	return lane_breakdown_calls.with_lint_detail(lane_breakdown_calls.top_of(timed), timed)
}

// The start to plan's time no timed call and no wait covered (joshuafolkken/kit#6119), and the calls
// backgrounded in it, whose waits fall in that time — `undefined` when no calls were read: its time is
// not known to be off-call.
function plan_outside(
	calls: ReadonlyArray<ToolCall>,
	breakdown: Breakdown,
): PlanOutside | undefined {
	if (calls.length === 0) return undefined

	const spans = breakdown.plan ?? []

	return {
		ms: remainder_ms(plan_parts(calls, breakdown), spans, breakdown.waits),
		background: placed_of(calls, spans).filter(([call]) => call.background).length,
	}
}

// The calls run inside `spans`, by the implementation's kinds and an edit's own — the fixes, re-ships,
// checks, reads, edits and subagents a lane child ran between two ship stages, and the `ship:wait`
// begun in the stage before, a backgrounded subagent left out as it spent no known time
// (joshuafolkken/kit#5294, joshuafolkken/kit#5834) — and what neither those
// calls nor `waits` covered as the remainder (joshuafolkken/kit#5755), left out when nothing is left.
// A reader that read no calls (`lane-sinks.ts`) gets no rows: its time is not known to be editing.
function between_kinds(
	calls: ReadonlyArray<ToolCall>,
	spans: ReadonlyArray<LaneSpan>,
	waits: ReadonlyArray<LaneSpan>,
): Array<Stage> {
	if (calls.length === 0) return []
	const timed = calls.filter((call) => !is_untimed_subagent(call))
	const placed = overlapping_of(timed, spans)
	const parts = placed.flatMap(([call, span]) => timed_part(call, span, BETWEEN_TOOL_KINDS))
	const remainder = { name: REMAINDER, ms: remainder_ms(parts, spans, waits) }

	return lane_breakdown.ranked(remainder.ms > 0 ? [...parts, remainder] : parts)
}

// The lane's own transcript directories — `<lane root slug>-<issue>` under `~/.claude/projects`.
function transcript_directories(issue: number): ReadonlyArray<string> {
	const main_cwd = cost_transcript.session_cwd(process.cwd())
	const home = cost_transcript.home_directory()
	const suffix = `-${String(issue)}`

	return cost_transcript
		.lane_transcript_directories(main_cwd, home)
		.filter((directory) => directory.endsWith(suffix))
}

// The tool calls of `issue`'s lane sessions still written to once its start to plan began, up to the
// end of its last ship stage.
function read(issue: number, breakdown: Breakdown): Array<ToolCall> {
	const [first] = [...(breakdown.plan ?? []), ...breakdown.implement]
	const last = breakdown.ship.at(-1) ?? breakdown.implement.at(-1)

	if (first === undefined || last === undefined) return []

	const window = { since_ms: first.from_ms, until_ms: last.to_ms }

	return lane_transcript_stats.read_calls(transcript_directories(issue), window)
}

// When the first of `calls` that edited a file started inside `span`, `undefined` when none did — the
// `edit_ms` `lane_breakdown.of` takes.
function first_edit_ms(calls: ReadonlyArray<ToolCall>, span: LaneSpan): number | undefined {
	const edits = calls
		.filter((call) => EDIT_TOOLS.has(call.tool ?? '') && span_of(call, [span]) !== undefined)
		.map((call) => call.started_ms)

	return edits.length === 0 ? undefined : Math.min(...edits)
}

// The breakdown with its implementation opened at the lane's first edit where no event opened it
// (joshuafolkken/kit#5835), the edit read off the lane's own transcripts.
function breakdown_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent>,
	issue: number,
): Breakdown | undefined {
	const span = lane_net_time.span_of(entries, issue)

	if (span === undefined) return undefined

	const window = { since_ms: span.from_ms, until_ms: span.to_ms }
	const calls = lane_transcript_stats.read_calls(transcript_directories(issue), window)

	return lane_breakdown.of(entries, events, issue, first_edit_ms(calls, span))
}

const lane_breakdown_implement = {
	between_kinds,
	breakdown_of,
	first_edit_ms,
	of,
	plan_calls,
	plan_outside,
	read,
	transcript_directories,
}

export { lane_breakdown_implement }
export type { ImplementDetail, PlanOutside }
