import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { lane_check_stats } from './lane-check-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_ship_lap_stats } from './lane-ship-lap-stats'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// What one call of a recording josh command a lane runs takes, from the lane sessions' transcripts
// (joshuafolkken/kit#7595), printed by `josh lane:stats` under the transcript metrics. The calls are
// timed as `lint:related`'s are: solo calls only — a call running a second josh command is left out —
// and a backgrounded call has no duration. The time includes the launcher's start and a stale `dist`
// rebuild, so the `run:entry` row sets beside it the sum of the ledger's `run:entry › …` step medians.

const RECORDING_COMMANDS: ReadonlyArray<string> = [
	'lane:plan',
	'run:entry',
	'review:record',
	'cost',
	'run:cut',
	'metrics',
]
const ENTRY_COMMAND = 'run:entry'
const ENTRY_STEP_PREFIX = `${ENTRY_COMMAND}${run_ship_lap.PARENT_SEPARATOR}`
const NO_LEDGER_STEPS = '—'
const COLUMNS = [
	'recording command',
	'solo runs',
	'median (s)',
	'max (s)',
	'total (min)',
	'ledger steps, median sum (s)',
] as const

function solo_durations(calls: ReadonlyArray<ToolCall>, name: string): Array<number> {
	const solo = lane_transcript_stats.solo_calls(calls, name, lane_transcript_stats.josh_commands)

	return lane_transcript_stats.durations(solo)
}

function total(values: ReadonlyArray<number>): number | undefined {
	return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0)
}

// A step `run:entry` times itself: a child's own laps (`run:entry › run:hold › …`) are inside its
// parent's step, so summing them too would count that time twice.
function is_entry_step(step: string): boolean {
	return (
		step.startsWith(ENTRY_STEP_PREFIX) &&
		!step.slice(ENTRY_STEP_PREFIX.length).includes(run_ship_lap.PARENT_SEPARATOR)
	)
}

// The sum of the period's `run:entry › <step>` medians, one median per step.
function entry_step_sum(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const laps = lane_stats
		.in_window(entries, window)
		.filter((entry) => lane_ship_lap_stats.is_ship_lap(entry))
		.filter((lap) => is_entry_step(lap.step))
	const steps = [...new Set(laps.map((lap) => lap.step))]
	const medians = steps
		.map((step) =>
			lane_stats.median(laps.filter((lap) => lap.step === step).map((lap) => lap.elapsed_ms)),
		)
		.filter((median) => median !== undefined)
	const sum = total(medians)

	return sum === undefined ? lane_stage_stats.NOT_MEASURED : (sum / MS_PER_SECOND).toFixed(1)
}

function row_of(name: string, times: ReadonlyArray<number>, ledger: string): string {
	return lane_stats.to_row([
		name,
		String(times.length),
		lane_check_stats.cell(lane_stats.median(times)),
		lane_check_stats.cell(lane_stats.peak(times)),
		lane_stage_stats.cell(total(times)),
		name === ENTRY_COMMAND ? ledger : NO_LEDGER_STEPS,
	])
}

// The period's table: `entries` is the whole ledger and `calls` every lane session's calls, both
// filtered here to `window`.
function table(
	entries: ReadonlyArray<LedgerEntry>,
	calls: ReadonlyArray<ToolCall>,
	window: StatsWindow,
): string {
	const period = lane_transcript_stats.in_period(calls, window)
	const ledger = entry_step_sum(entries, window)
	const rows = RECORDING_COMMANDS.map((name) => row_of(name, solo_durations(period, name), ledger))

	return [...lane_check_stats.header(COLUMNS), ...rows].join('\n')
}

const lane_record_command_stats = { RECORDING_COMMANDS, table }

export { lane_record_command_stats }
