#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_pause, type LaneSignalled } from './lane-pause'
import type { LaneProcesses } from './lane-reap'
import { lane_registry } from './lane-registry'
import { lane_state } from './lane-state'

// `josh lane:pause <issue> | --all` and `josh lane:resume <issue> | --all` — one script told apart by
// the verb the registry passes first. A named lane with no child process to signal exits non-zero, so a
// caller never takes a pause that stopped nothing as done — a detached resident signalled alone counts
// as nothing. A lane whose detached processes could not be read exits non-zero too, since a resume
// may have left one of them stopped. A lane whose child was signalled has the change written to its state record and to the
// run's event stream, so who halted it is on record, and to the lane ledger, so `lane:stats` leaves the
// stopped time out of the lane's implement sub-stages (joshuafolkken/kit#5168).

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ALL_FLAG = '--all'
const USAGE = [
	'Usage: josh lane:pause <issue-number> | josh lane:pause --all',
	'       josh lane:resume <issue-number> | josh lane:resume --all',
].join('\n')

const VERBS = {
	pause: { act: 'pause_lane', done: 'paused', state: 'paused' },
	resume: { act: 'resume_lane', done: 'resumed', state: 'running' },
} as const

type Verb = keyof typeof VERBS

function is_verb(value: string | undefined): value is Verb {
	return value === 'pause' || value === 'resume'
}

async function lanes_of(target: ReadonlyArray<string>): Promise<Array<LaneProcesses> | undefined> {
	const [issue, ...rest] = target

	if (issue === undefined || rest.length > 0) return undefined
	if (issue === ALL_FLAG) return await lane_pause.open_lanes()
	if (!issue_number_shape.is_issue_number(issue)) return undefined

	return [await lane_registry.lane_location(issue)]
}

function outcome_of(verb: Verb, result: LaneSignalled): string {
	const { done } = VERBS[verb]
	const count = String(result.signalled.length)

	if (result.signalled.length === 0) return `no child process running — nothing ${done}`

	if (result.child.length === 0) {
		return `no child process running — ${done} ${count} detached process(es), state unchanged`
	}

	return `${done} ${count} process(es)`
}

const UNREAD_NOTE =
	' — could not read the detached processes (lsof or ps failed); any of them was missed'

// One line per lane: how many of its processes were signalled, and whether its residents went unread.
function report(verb: Verb, issue: string, result: LaneSignalled): void {
	const note = result.is_unread ? UNREAD_NOTE : ''

	console.info(`lane:${verb} ${issue_cite.plain(issue)}: ${outcome_of(verb, result)}${note}`)
}

async function record(verb: Verb, issue: string): Promise<void> {
	const command = `lane:${verb}`

	await lane_state.record_change({ issue, state: VERBS[verb].state, command })
	await lane_ledger_write.record_lane_state({ issue: Number(issue), state: VERBS[verb].state })
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.LANE_STATE,
		`${issue_cite.plain(issue)} ${VERBS[verb].done} by ${command}`,
	)
}

async function settle(verb: Verb, lane: LaneProcesses): Promise<LaneSignalled> {
	const result = lane_pause[VERBS[verb].act](lane)

	report(verb, lane.issue, result)
	if (result.child.length > 0) await record(verb, lane.issue)

	return result
}

// A named lane with no child signalled fails; any lane whose residents went unread fails.
function is_failed(result: LaneSignalled, is_named: boolean): boolean {
	return result.is_unread || (is_named && result.child.length === 0)
}

async function apply(
	verb: Verb,
	lanes: ReadonlyArray<LaneProcesses>,
	is_named: boolean,
): Promise<number> {
	const results = await Promise.all(lanes.map(async (lane) => await settle(verb, lane)))

	return results.some((result) => is_failed(result, is_named))
		? FAILURE_EXIT_CODE
		: SUCCESS_EXIT_CODE
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [verb, ...target] = argv
	if (!is_verb(verb)) return report_usage()
	const lanes = await lanes_of(target)

	return lanes === undefined ? report_usage() : await apply(verb, lanes, target[0] !== ALL_FLAG)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_pause_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_pause_cli }
