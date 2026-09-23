#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { cost_transcript } from '#scripts/cost-runtime/cost-transcript'
import { transcript_cwd } from '#scripts/cost-runtime/transcript-cwd'
import { time_round_trips } from '#scripts/time-runtime/time-round-trips'
import { time_spans } from '#scripts/time-runtime/time-spans'

// `josh time:density` — how many tool calls a run issued per round trip, aggregated across the recent
// lane sessions (joshuafolkken/kit#2405).
//
// **The number the batching work is measured on had no command.** Every re-measurement of the guard
// (kit#1344, kit#2164, kit#2276) recomputed it with a throwaway `node -e` over
// `~/.claude/projects/*kit-lanes-*/*.jsonl`, hand-counting `tool_use` blocks per assistant message —
// so `josh measure:rerun` could not carry a before/after for it, and every reading had to be trusted
// on a script pasted into the Issue. This prints the same quantity from a command, so the density is
// read the same way twice and the re-measurement kit#2276 promised is a command rather than a paste.
//
// **The density is `time_round_trips`, reused rather than restated.** A second calculation here would
// be the clone `CLAUDE.md` prohibits, and the one that matters most: the guard's floor, the live line
// (`time-density.ts`) and this command must not come to disagree about what a round trip is. So each
// transcript is parsed through `time_spans.parse_timeline` and counted through the very module the
// guard reads — this file only aggregates across lanes, which is the one thing no existing module did.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh time:density [--lanes <n>] [--path <dir>]'

// How many of the most recent qualifying lane sessions to average over. Ten, the count the baseline
// `node -e` took, so the command reproduces the sample the Issue's 1.04 was read from rather than a
// wider or narrower one.
const DEFAULT_LANES = 10
// The fewest round trips a session must hold to be measured at all. A lane that stopped after a
// handful of turns has no density worth quoting and would swing the average, so it is skipped exactly
// as the baseline skipped a transcript of under thirty assistant messages.
const MIN_ROUND_TRIPS = 30
// A round trip that issued more than one call is a batched one — the turns the guard exists to
// produce, counted so the summary says how many of the total actually batched.
const BATCHED_MINIMUM = 1
const NONE = 0

interface Options {
	// The most recent qualifying lane sessions to average over.
	lanes: number
	// The project whose lane transcripts to read, or `undefined` for this process's own checkout. From
	// the kit checkout `--path <dir>` points the read at another project, exactly as `josh time` does.
	path: string | undefined
}

const PARSE_ARGS_OPTIONS = {
	lanes: { type: 'string' },
	path: { type: 'string' },
} as const

// What one transcript contributed, before the lanes are summed. Kept as counts rather than a density
// so the aggregate divides one summed numerator by one summed denominator — averaging per-lane
// densities would weight a short lane the same as a long one.
interface TranscriptStats {
	round_trips: number
	calls: number
	batched: number
}

interface DensitySummary {
	lanes: number
	round_trips: number
	calls: number
	batched: number
	density: number
}

// A misspelled or retired flag is a refusal rather than a default: a run must not read the density as
// though the mistake had been understood, the same reason `josh time` refuses an unknown flag.
function parse_options(argv: ReadonlyArray<string>): Options | undefined {
	try {
		const { values } = parseArgs({ args: [...argv], options: PARSE_ARGS_OPTIONS, strict: true })
		const lanes = values.lanes === undefined ? DEFAULT_LANES : Number(values.lanes)

		if (!Number.isSafeInteger(lanes) || lanes <= NONE) return undefined

		return { lanes, path: values.path }
	} catch {
		return undefined
	}
}

// One transcript's contribution, counted through the guard's own module so the two cannot disagree
// about what a round trip is. `group_round_trips` returns each trip as the calls it carried, so a trip
// longer than one call is a batched turn.
function transcript_stats(text: string): TranscriptStats {
	const { spans } = time_spans.parse_timeline(text)
	const trips = time_round_trips.group_round_trips(spans)

	return {
		round_trips: trips.length,
		calls: time_round_trips.count_calls(spans),
		batched: trips.filter((trip) => trip.length > BATCHED_MINIMUM).length,
	}
}

// The most recent transcripts holding enough round trips to measure, newest first and capped at
// `max_lanes`. A short session is dropped rather than counted, so the cap is reached by qualifying
// lanes rather than by the newest handful whatever their length. The texts arrive newest first, so the
// cap keeps the front of the filtered list.
function qualifying(
	texts: ReadonlyArray<string>,
	min_round_trips: number,
	max_lanes: number,
): Array<TranscriptStats> {
	return texts
		.map((text) => transcript_stats(text))
		.filter((one) => one.round_trips >= min_round_trips)
		.slice(NONE, max_lanes)
}

// A loop rather than `reduce`, which this project's lint config forbids — the same idiom
// `time-round-trips.ts` states its own sums with.
function total(
	stats: ReadonlyArray<TranscriptStats>,
	pick: (one: TranscriptStats) => number,
): number {
	let sum = NONE
	for (const one of stats) sum += pick(one)

	return sum
}

// The aggregate density: one summed numerator over one summed denominator, so a long lane counts for
// more than a short one. Pure over the transcript texts, so a test drives it with fixtures rather than
// a home directory.
function summarize(
	texts: ReadonlyArray<string>,
	min_round_trips: number,
	max_lanes: number,
): DensitySummary {
	const stats = qualifying(texts, min_round_trips, max_lanes)
	const round_trips = total(stats, (one) => one.round_trips)
	const calls = total(stats, (one) => one.calls)

	return {
		lanes: stats.length,
		round_trips,
		calls,
		batched: total(stats, (one) => one.batched),
		density: time_round_trips.per_round_trip(calls, round_trips),
	}
}

function format(summary: DensitySummary): string {
	const density = time_round_trips.format_density(summary.density)

	return (
		`lanes=${String(summary.lanes)} round_trips=${String(summary.round_trips)} ` +
		`tools/turn=${density} batched=${String(summary.batched)}/${String(summary.round_trips)}`
	)
}

// The recent lane sessions' transcripts, newest first. A dispatched lane child writes its own
// transcript under the lane's slug, so the session files — not the delegated units under them — are
// what a run's tool calls sit in; `list_sessions_across` already orders them newest first.
function lane_texts(cwd: string, home: string): Array<string> {
	const directories = cost_transcript.transcript_directories(cwd, home)

	return cost_transcript
		.list_sessions_across(directories)
		.filter((file) => !file.is_delegated)
		.map((file) => cost_transcript.read_raw(file))
}

function run(
	argv: ReadonlyArray<string>,
	cwd: string = process.cwd(),
	home: string = cost_transcript.home_directory(),
): number {
	const options = parse_options(argv)

	if (options === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const texts = lane_texts(transcript_cwd.resolve(options.path, cwd), home)

	console.info(format(summarize(texts, MIN_ROUND_TRIPS, options.lanes)))

	return 0
}

function main(argv: ReadonlyArray<string>): void {
	process.exitCode = run(argv)
}

const time_density_cli = {
	USAGE,
	DEFAULT_LANES,
	MIN_ROUND_TRIPS,
	parse_options,
	transcript_stats,
	summarize,
	format,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(ARGV_OFFSET))

export type { DensitySummary, TranscriptStats }
export { time_density_cli }
