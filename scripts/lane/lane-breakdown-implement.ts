import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_calls, type CallGroup } from './lane-breakdown-calls'
import type { LaneSpan } from './lane-net-time'
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

const TOOL_KINDS: ReadonlyMap<string, string> = new Map([
	['Read', READ],
	['Grep', READ],
	['Glob', READ],
])

const COMMAND_KINDS: ReadonlyArray<readonly [RegExp, string]> = [
	[/\bjosh main:merge\b/u, 'main:merge'],
	[/\bjosh check:related\b/u, 'check:related'],
	[/\bjosh gate\b/u, 'gate'],
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

function command_kind(command: string): string {
	return COMMAND_KINDS.find(([pattern]) => pattern.test(command))?.[1] ?? OTHER_BASH
}

function subagent_kind(subagent: Subagent): string {
	return `subagent: ${subagent.type}`
}

// The kind a call counts under, `undefined` for one that falls in the remainder (an edit included).
function kind_of(call: ToolCall): string | undefined {
	if (call.tool === BASH_TOOL) return command_kind(call.command ?? '')
	if (call.subagent !== undefined) return subagent_kind(call.subagent)

	return TOOL_KINDS.get(call.tool ?? '')
}

interface TimedPart extends Stage {
	from_ms: number
	call: ToolCall
}

function is_untimed_subagent(call: ToolCall): boolean {
	return call.background && call.subagent !== undefined
}

// A call's own milliseconds, cut at the end of the span it started in; a backgrounded subagent call's none.
function timed_part(call: ToolCall, span: LaneSpan): ReadonlyArray<TimedPart> {
	const name = kind_of(call)

	if (name === undefined) return []

	const ms = Math.min(call.duration_ms ?? 0, span.to_ms - call.started_ms)
	const is_counted = call.duration_ms !== undefined || is_untimed_subagent(call)

	return is_counted ? [{ name, ms, from_ms: call.started_ms, call }] : []
}

function untimed_of(placed: ReadonlyArray<readonly [ToolCall, LaneSpan]>): Map<string, number> {
	const counts = new Map<string, number>()
	const kinds = placed.filter(([call]) => is_untimed_subagent(call)).map(([call]) => kind_of(call))

	for (const kind of kinds) if (kind !== undefined) counts.set(kind, (counts.get(kind) ?? 0) + 1)

	return counts
}

// What neither a timed call nor a wait covers of the implementation's spans, each millisecond once.
function remainder_ms(parts: ReadonlyArray<TimedPart>, breakdown: Breakdown): number {
	const busy = parts.map((part) => ({ from_ms: part.from_ms, to_ms: part.from_ms + part.ms }))
	const covering = [...busy, ...breakdown.waits]
	const idle = breakdown.implement.map(
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

// The implementation split by the calls made inside it — parallel calls each count their own time, so
// the kinds can add up to more — and the remainder, the time no call and no wait covered.
function of(calls: ReadonlyArray<ToolCall>, breakdown: Breakdown): ImplementDetail {
	const placed = placed_of(calls, breakdown.implement)
	const parts = placed.flatMap(([call, span]) => timed_part(call, span))
	const remainder = { name: REMAINDER, ms: remainder_ms(parts, breakdown) }

	return {
		kinds: lane_breakdown.ranked([...parts, remainder]),
		background: placed.filter(([call]) => call.background).length,
		untimed: untimed_of(placed),
		calls: lane_breakdown_calls.by_kind(parts),
	}
}

// The longest call groups of the start to plan (joshuafolkken/kit#5539).
function plan_calls(calls: ReadonlyArray<ToolCall>, breakdown: Breakdown): Array<CallGroup> {
	const placed = placed_of(calls, breakdown.plan ?? [])

	return lane_breakdown_calls.top_of(placed.flatMap(([call, span]) => timed_part(call, span)))
}

// The Bash calls started inside `spans`, by the implementation's kinds — the fixes, re-ships and checks
// a lane child ran between two ship stages (joshuafolkken/kit#5294).
function bash_kinds(calls: ReadonlyArray<ToolCall>, spans: ReadonlyArray<LaneSpan>): Array<Stage> {
	const placed = placed_of(
		calls.filter((call) => call.tool === BASH_TOOL),
		spans,
	)

	return lane_breakdown.ranked(placed.flatMap(([call, span]) => timed_part(call, span)))
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

const lane_breakdown_implement = { bash_kinds, of, plan_calls, read, transcript_directories }

export { lane_breakdown_implement }
export type { ImplementDetail }
