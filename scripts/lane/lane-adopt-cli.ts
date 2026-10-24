#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_adopt, type Adoption } from './lane-adopt'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_state, type LaneRecords } from './lane-state'

// `josh lane:adopt <issue> | --all` — write a state record for each open lane that lost its own
// (`lane-adopt.ts`), one line per lane. A named lane left unknown exits non-zero; under `--all` a lane
// left unknown, or one already recorded, is no failure.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ALL_FLAG = '--all'
const USAGE = 'Usage: josh lane:adopt <issue-number> | josh lane:adopt --all'

async function named_lane(issue: string): Promise<Array<LaneInfo> | undefined> {
	if (!issue_number_shape.is_issue_number(issue)) return undefined

	const lane = await lane_registry.find_open_lane(issue)

	return lane === undefined ? [] : [lane]
}

async function lanes_of(target: ReadonlyArray<string>): Promise<Array<LaneInfo> | undefined> {
	const [issue, ...rest] = target

	if (issue === undefined || rest.length > 0) return undefined

	return issue === ALL_FLAG ? await lane_registry.list_lanes() : await named_lane(issue)
}

function outcome_text(adoption: Adoption): string {
	if (adoption.kind === 'left') return `left unknown — ${adoption.reason}`

	return `recorded open — ${lane_adopt.facts_text(adoption.facts)}`
}

// Adopt one lane, report it, and put an adoption on the run's event stream as `lane:pause` puts a pause.
async function settle(lane: LaneInfo, records: LaneRecords): Promise<Adoption> {
	const adoption = await lane_adopt.adopt(lane, records)
	const { ADOPT_COMMAND } = lane_adopt

	console.info(`${ADOPT_COMMAND} ${session_cite.issue(lane.issue)}: ${outcome_text(adoption)}`)
	if (adoption.kind !== 'adopted') return adoption

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.LANE_STATE,
		`${issue_cite.plain(lane.issue)} adopted by ${ADOPT_COMMAND}`,
	)

	return adoption
}

async function apply(lanes: ReadonlyArray<LaneInfo>, is_named: boolean): Promise<number> {
	const records = await lane_state.read_states(lanes.map((lane) => lane.issue))
	const adoptions = await Promise.all(lanes.map(async (lane) => await settle(lane, records)))

	return is_named && adoptions.some((adoption) => adoption.kind === 'left')
		? FAILURE_EXIT_CODE
		: SUCCESS_EXIT_CODE
}

function report(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const lanes = await lanes_of(argv)

	if (lanes === undefined) return report(USAGE)

	if (lanes.length === 0 && argv[0] !== ALL_FLAG) {
		return report(`No open lane for ${session_cite.issue(argv[0] ?? '')}`)
	}

	return await apply(lanes, argv[0] !== ALL_FLAG)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_adopt_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_adopt_cli }
