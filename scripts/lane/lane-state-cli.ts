#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_paused, type PausedProbes } from './lane-paused'
import { lane_process_table } from './lane-process-table'
import { lane_reap } from './lane-reap'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_state, type LaneState } from './lane-state'

// `josh lane:state --backfill` — the one-off migration that gives every lane opened before the state
// record existed a record of its own (joshuafolkken/kit#4268), so no reader has to fall back to
// guessing. A lane that already has one is left as it is. It is removed once the readers have moved
// to the record (joshuafolkken/kit#4270).
//
// **The state is read off what the lane is doing now**: a child whose every process is stopped is
// `paused`, one with a process `running`, one with none `open` — the state a later dispatch or close
// moves on from. The launch time of a live child is its `.env`'s, the one the registry already reads.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const BACKFILL_FLAG = '--backfill'
const COMMAND = 'lane:state --backfill'
const USAGE = 'Usage: josh lane:state --backfill'

function observed_state(issue: string, probes: PausedProbes | undefined): LaneState {
	if (probes === undefined || lane_reap.lane_tree(issue, probes).length === 0) return 'open'

	return lane_paused.is_lane_paused(issue, probes) ? 'paused' : 'running'
}

function launch_time(lane: LaneInfo, state: LaneState): Date | undefined {
	if (state === 'open' || lane.dispatched_ms === undefined) return undefined

	return new Date(lane.dispatched_ms)
}

async function backfill_lane(
	lane: LaneInfo,
	probes: PausedProbes | undefined,
	directory?: string,
): Promise<string> {
	const existing = await lane_state.read_state(lane.issue, directory)

	if (existing !== undefined) return `kept its ${existing.state} record`
	const state = observed_state(lane.issue, probes)
	const change = {
		issue: lane.issue,
		state,
		command: COMMAND,
		launched_at: launch_time(lane, state),
	}
	const outcome = await lane_state.record_change(change, { directory })

	return outcome.kind === 'written' ? `recorded ${state}` : `not recorded — ${outcome.reason}`
}

/** One line per lane: the record it was given, or the one it already had. */
async function backfill(
	lanes: ReadonlyArray<LaneInfo>,
	probes: PausedProbes | undefined,
	directory?: string,
): Promise<Array<string>> {
	return await Promise.all(
		lanes.map(async (lane) => {
			const result = await backfill_lane(lane, probes, directory)

			return `${COMMAND} ${session_cite.issue(lane.issue)}: ${result}`
		}),
	)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	if (argv.length !== 1 || argv[0] !== BACKFILL_FLAG) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const probes = await lane_process_table.probes_from(lane_process_table.read_table)
	const lines = await backfill(await lane_registry.list_lanes(), probes)

	for (const line of lines) console.info(line)

	return SUCCESS_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_state_cli = { backfill, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_state_cli }
