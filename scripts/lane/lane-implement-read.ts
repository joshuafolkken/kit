import { lane_implement_stats, type StagedCall } from './lane-implement-stats'
import type { ImplementLane } from './lane-implement-subagents'
import type { PausedSpans } from './lane-paused-spans'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'

// The implement's `read` sub-stage broken down by what its time went on (joshuafolkken/kit#6188): each
// read call's span is its tool's own run time and the model's turn before it, so a lane's `tool` and
// `thinking` sum to its `read` in `lane-implement-stats.ts` — the medians printed need not. **`files read` counts the distinct paths the read
// calls' `Read` tool opened**, and **`investigator-cited` how many of them an investigator subagent's
// report cited by `path:line`** — the investigation the read went over again.

const READ_STAGE = 'read'
const READ_TOOL = 'Read'
const INVESTIGATOR = 'investigator'
// A report's words are split off at whitespace and the quoting or emphasis around a citation.
const WORD_BOUNDARY = /[\s`'"()[\]{}<>*,;]+/u
const CURRENT_DIRECTORY = './'
// A citation's line, `41` or an approximate `~41`.
const LINE_START = /^~?\d/u
// A cited path ends in a file extension; a time or a port before a `:` does not.
const FILE_NAME = /\.[a-z]+$/iu
const SEPARATOR = '/'
const COLUMNS = [
	'implement read',
	'lanes',
	'tool (min)',
	'thinking (min)',
	'files read',
	'investigator-cited',
] as const

interface ReadBreakdown {
	tool_ms: number
	thinking_ms: number
	files: number
	cited: number
}

function is_investigator(call: ToolCall): boolean {
	return call.subagent?.type.endsWith(INVESTIGATOR) === true
}

// The path a `path:line` word cites — a repository path, `./` dropped, or a bare file name —
// `undefined` for any other word.
function citation_of(word: string): string | undefined {
	const colon = word.indexOf(':')
	const cited = word.slice(0, Math.max(0, colon))
	const path = cited.startsWith(CURRENT_DIRECTORY) ? cited.slice(CURRENT_DIRECTORY.length) : cited

	return FILE_NAME.test(path) && LINE_START.test(word.slice(colon + 1)) ? path : undefined
}

// The path of every `path:line` the lane's investigator reports cite.
function cited_paths(calls: ReadonlyArray<ToolCall>): Array<string> {
	return calls
		.filter((call) => is_investigator(call))
		.flatMap((call) => call.output.split(WORD_BOUNDARY))
		.flatMap((word) => citation_of(word) ?? [])
}

function is_cited(file: string, cited: ReadonlyArray<string>): boolean {
	return cited.some((path) => file === path || file.endsWith(`${SEPARATOR}${path}`))
}

// The distinct paths the read calls' `Read` tool opened.
function files_read(reads: ReadonlyArray<StagedCall>): Array<string> {
	const paths = reads.flatMap(({ call }) => (call.tool === READ_TOOL ? (call.file_path ?? []) : []))

	return [...new Set(paths)]
}

// The tool's own run time inside the span; a backgrounded call's span is all thinking.
function tool_ms(entry: StagedCall): number {
	return Math.min(entry.call.duration_ms ?? 0, entry.active_ms)
}

function sum(values: ReadonlyArray<number>): number {
	return values.reduce((total, value) => total + value, 0)
}

function breakdown(lane: ImplementLane): ReadBreakdown {
	const reads = lane_implement_stats
		.staged(lane.calls, lane.paused)
		.filter((entry) => entry.stage === READ_STAGE)
	const tool = sum(reads.map((entry) => tool_ms(entry)))
	const files = files_read(reads)
	const cited = cited_paths(lane.calls)

	return {
		tool_ms: tool,
		thinking_ms: sum(reads.map((entry) => entry.active_ms)) - tool,
		files: files.length,
		cited: files.filter((file) => is_cited(file, cited)).length,
	}
}

function count_cell(values: ReadonlyArray<number>): string {
	return String(lane_stats.median(values) ?? lane_stats.MISSING)
}

function read_row(breakdowns: ReadonlyArray<ReadBreakdown>): Array<string> {
	return [
		READ_STAGE,
		String(breakdowns.length),
		lane_stage_stats.cell(lane_stats.median(breakdowns.map((lane) => lane.tool_ms))),
		lane_stage_stats.cell(lane_stats.median(breakdowns.map((lane) => lane.thinking_ms))),
		count_cell(breakdowns.map((lane) => lane.files)),
		count_cell(breakdowns.map((lane) => lane.cited)),
	]
}

// The period's table: one row of medians over the lanes that shipped in `window`.
function table(calls: ReadonlyArray<ToolCall>, window: StatsWindow, paused: PausedSpans): string {
	const breakdowns = lane_implement_stats
		.implement_lanes(calls, window, paused)
		.map((lane) => breakdown(lane))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		lane_stats.to_row(read_row(breakdowns)),
	].join('\n')
}

const lane_implement_read = { table }

export { lane_implement_read }
