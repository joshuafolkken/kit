import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#8704: a lane child's fixed prefix grew by a third and no `lane:stats` row showed
// it. The table reads each lane session's first request — the context every later request re-reads —
// as a per-model median, beside the share of those sessions that loaded a deferred tool.

interface SessionPrefix {
	session_id: string
	model: string
	at_ms: number
	// The first request's input with its cache reads and writes (`cost_usage.billed_input`).
	tokens: number
}

const COLUMNS = [
	'first request model',
	'sessions',
	'median context (tokens)',
	'ToolSearch sessions',
	'ToolSearch share (%)',
]
const ALL_MODELS = 'all'
const TOOL_SEARCH = 'ToolSearch'
const PERCENT = 100

// Each cell a bare number, so `lane:value cell` reads it; no session reads the missing mark.
function share_cell(part: number, whole: number): string {
	if (whole === 0) return lane_stats.MISSING

	return ((part / whole) * PERCENT).toFixed(1)
}

function records_of(raw: string): Array<UsageRecord> {
	return raw.split('\n').flatMap((line) => {
		const outcome = cost_usage.parse_line(line)

		return outcome.kind === 'record' ? [outcome.record] : []
	})
}

// The session's first priced request, `undefined` when the transcript holds none — a session cut
// before its first answer has no prefix to measure.
function first_request(session_id: string, raw: string): SessionPrefix | undefined {
	const [first] = cost_usage.dedupe(records_of(raw))

	if (first?.at_ms === undefined) return undefined

	const tokens = cost_usage.billed_input(first.totals)

	return { session_id, model: first.model, at_ms: first.at_ms, tokens }
}

// The first request of every lane session under `directories` written to in `window`; a delegated
// unit is not a lane child, so its transcript is skipped as `read_calls` skips it.
function read_prefixes(
	directories: ReadonlyArray<string>,
	window: StatsWindow,
): Array<SessionPrefix> {
	return cost_transcript
		.list_sessions_across(directories)
		.filter((file) => !file.is_delegated && file.modified_ms >= window.since_ms)
		.flatMap((file) => first_request(file.session_id, cost_transcript.read_raw(file)) ?? [])
}

function searched_sessions(calls: ReadonlyArray<ToolCall>): Set<string> {
	return new Set(calls.filter((call) => call.tool === TOOL_SEARCH).map((call) => call.session_id))
}

function row_of(
	label: string,
	prefixes: ReadonlyArray<SessionPrefix>,
	searched: ReadonlySet<string>,
): Array<string> {
	const median = lane_stats.median(prefixes.map((prefix) => prefix.tokens))
	const used = prefixes.filter((prefix) => searched.has(prefix.session_id)).length

	return [
		label,
		String(prefixes.length),
		median === undefined ? lane_stats.MISSING : String(Math.round(median)),
		String(used),
		share_cell(used, prefixes.length),
	]
}

// One row per model whose first request fell in `window`, then every model together; `calls` names
// the sessions that called `ToolSearch` at least once.
function table(
	prefixes: ReadonlyArray<SessionPrefix>,
	calls: ReadonlyArray<ToolCall>,
	window: StatsWindow,
): string {
	const period = prefixes.filter(
		(prefix) => prefix.at_ms >= window.since_ms && prefix.at_ms <= window.until_ms,
	)
	const searched = searched_sessions(calls)
	const models = [...new Set(period.map((prefix) => prefix.model))].toSorted((left, right) =>
		left.localeCompare(right),
	)
	const rows = models.map((model) =>
		row_of(
			model,
			period.filter((prefix) => prefix.model === model),
			searched,
		),
	)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...[...rows, row_of(ALL_MODELS, period, searched)].map((row) => lane_stats.to_row(row)),
	].join('\n')
}

const lane_prefix_stats = { first_request, read_prefixes, table }

export type { SessionPrefix }
export { lane_prefix_stats }
