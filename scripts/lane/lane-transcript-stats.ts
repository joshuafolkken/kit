import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_transcript_calls, type ToolCall } from './lane-transcript-calls'

// The lane speed metrics only the lane sessions' transcripts hold, printed by `josh lane:stats` under the
// ledger's tables so a speed check needs no ad-hoc aggregation (joshuafolkken/kit#4418): tool time per
// session, the verification calls and the share that waited for the core budget, and the medians of
// `lint:related` / `test:related`.
//
// **A chained call is counted apart from a solo one.** One Bash call that runs two verification
// commands (`josh lint:related && josh test:related`) has one duration for both, so it would read as
// either command's time; the per-command medians take solo calls only. **Only a foreground call is
// timed** — `lane_transcript_calls` leaves a backgrounded one's duration out.
//
// **The period is cut at each call's own timestamp**, not a transcript's modification time, so a
// fractional `--period` (since a merge) counts the same calls whichever session they sit in.

const TIMED_COMMANDS: ReadonlyArray<string> = ['lint:related', 'test:related']
// **The verification calls split by what ran them** (joshuafolkken/kit#4442): the scoped checks of the
// implementation loop, a whole `gate` or `metrics` run by hand before the ship, and the `ship` call —
// whose own gate runs inside it and is the ledger's to count — so a hand-run gate is never hidden in the
// loop's volume. A call naming two classes counts in each.
const CALL_CLASSES: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
	['verification calls, scoped checks', new Set([...TIMED_COMMANDS, 'cspell:dot'])],
	['verification calls, gate / metrics by hand', new Set(['gate', 'metrics'])],
	['verification calls, ship', new Set(['ship'])],
]
const VERIFICATION_COMMANDS: ReadonlySet<string> = new Set(
	CALL_CLASSES.flatMap(([, names]) => [...names]),
)
// A command is `josh <name>` at the start of a shell command — after a separator, past env
// assignments, shell keywords and a `pnpm` / `npx` runner — so `josh lint:related; josh test:related`
// and `out=$(pnpm josh gate)` name their commands. A heredoc body or a quoted string only mentions a
// command, so both are cut before matching; a `<<<` here-string opens no body.
const SEPARATOR_PATTERN = /[;&|()\n]/u
const WORD_PATTERN = /\s+/u
const PREFIX_WORDS: ReadonlySet<string> = new Set([
	'pnpm',
	'npx',
	'if',
	'elif',
	'else',
	'then',
	'while',
	'until',
	'do',
	'time',
	'!',
	'{',
])
const HEREDOC_TAG_PATTERN = /(?<!<)<<(?!<)-?\s*['"]?(?<tag>\w+)/u
const QUOTED_PATTERN = /'[^']*'|"(?:[^"\\]|\\.)*"/gu
// `scripts/gate/core-wait.ts` writes this into every wait line it prints.
const CORE_WAIT_PHRASE = 'waits for the core budget'
const PERCENT = 100
const COLUMNS = ['transcript metric', 'value'] as const
const { NOT_MEASURED } = lane_stage_stats

// The heredoc tag still open after `line`, or the one `line` opens.
function next_heredoc_tag(line: string, tag: string | undefined): string | undefined {
	if (tag !== undefined) return line.trim() === tag ? undefined : tag

	return HEREDOC_TAG_PATTERN.exec(line)?.groups?.['tag']
}

function without_heredocs(text: string): string {
	const kept: Array<string> = []
	const open: { tag: string | undefined } = { tag: undefined }

	for (const line of text.split('\n')) {
		if (open.tag === undefined) kept.push(line)
		open.tag = next_heredoc_tag(line, open.tag)
	}

	return kept.join('\n')
}

// The josh command `segment` runs, or `''` when it runs none.
function segment_command(segment: string): string {
	const words = segment.trim().split(WORD_PATTERN)
	const start = words.findIndex((word) => !word.includes('=') && !PREFIX_WORDS.has(word))

	return words[start] === 'josh' ? (words[start + 1] ?? '') : ''
}

function verification_commands(command = ''): Array<string> {
	const spoken = without_heredocs(command).replaceAll(QUOTED_PATTERN, '')
	const named = spoken.split(SEPARATOR_PATTERN).map((segment) => segment_command(segment))

	return named.filter((name) => VERIFICATION_COMMANDS.has(name))
}

function seconds_cell(ms: number | undefined): string {
	return ms === undefined ? NOT_MEASURED : (ms / MS_PER_SECOND).toFixed(1)
}

function is_timed(ms: number | undefined): ms is number {
	return ms !== undefined
}

function durations(calls: ReadonlyArray<ToolCall>): Array<number> {
	return calls.map((call) => call.duration_ms).filter((ms) => is_timed(ms))
}

// Each session's summed foreground tool time, for the sessions that made a call in the period.
function session_times(calls: ReadonlyArray<ToolCall>): Array<number> {
	const sessions = [...new Set(calls.map((call) => call.session_id))]

	return sessions.map((session) =>
		durations(calls.filter((call) => call.session_id === session)).reduce(
			(sum, value) => sum + value,
			0,
		),
	)
}

function share_cell(part: number, whole: number): string {
	if (whole === 0) return NOT_MEASURED

	return `${String(part)} of ${String(whole)} (${((part / whole) * PERCENT).toFixed(1)}%)`
}

function solo_median_row(verifying: ReadonlyArray<ToolCall>, name: string): Array<string> {
	const solo = verifying.filter((call) => {
		const named = verification_commands(call.command)

		return named.length === 1 && named[0] === name
	})

	return [`${name} median, solo (s)`, seconds_cell(lane_stats.median(durations(solo)))]
}

function class_rows(verifying: ReadonlyArray<ToolCall>): Array<Array<string>> {
	return CALL_CLASSES.map(([metric, names]) => {
		const named = verifying.filter((call) =>
			verification_commands(call.command).some((name) => names.has(name)),
		)

		return [metric, String(named.length)]
	})
}

function rows_of(calls: ReadonlyArray<ToolCall>): Array<Array<string>> {
	const times = session_times(calls)
	const verifying = calls.filter((call) => verification_commands(call.command).length > 0)
	const chained = verifying.filter((call) => verification_commands(call.command).length > 1)
	const waited = verifying.filter((call) => call.output.includes(CORE_WAIT_PHRASE))

	return [
		['lane sessions', String(times.length)],
		['tool time per session, median (min)', lane_stage_stats.cell(lane_stats.median(times))],
		['tool time per session, mean (min)', lane_stage_stats.cell(lane_stats.mean(times))],
		['verification calls, solo', String(verifying.length - chained.length)],
		['verification calls, chained', String(chained.length)],
		...class_rows(verifying),
		['waited for the core budget', share_cell(waited.length, verifying.length)],
		...TIMED_COMMANDS.map((name) => solo_median_row(verifying, name)),
	]
}

// The period's table: `calls` is every lane session's calls, filtered here to `window`.
function table(calls: ReadonlyArray<ToolCall>, window: StatsWindow): string {
	const period = calls.filter(
		(call) => call.started_ms >= window.since_ms && call.started_ms <= window.until_ms,
	)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...rows_of(period).map((row) => lane_stats.to_row(row)),
	].join('\n')
}

// The tool calls of every lane session under `directories` that was still written to in `window` — a
// transcript last modified before the period holds no call in it, so it is never read. A delegated
// unit's transcript is not a lane session, and its time is already inside the parent's wait for it.
function read_calls(directories: ReadonlyArray<string>, window: StatsWindow): Array<ToolCall> {
	return cost_transcript
		.list_sessions_across(directories)
		.filter((file) => !file.is_delegated && file.modified_ms >= window.since_ms)
		.flatMap((file) => lane_transcript_calls.parse(file.session_id, cost_transcript.read_raw(file)))
}

const lane_transcript_stats = { read_calls, table, verification_commands }

export { lane_transcript_stats }
