#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type CarryOwner } from '#scripts/run/run-carry'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { backlog_budget } from './backlog-budget'
import { backlog_drive, type DriveState } from './backlog-drive'
import { backlog_drive_ports, type DriveOptions } from './backlog-drive-ports'

// `josh backlog:drive` — run the `backlogrun` parent loop until a judgement branch
// (joshuafolkken/kit#2508). **Standard output is one line**: the branch it stopped at, the issue and a
// detail where there are any — `done`, `stopped <reason>`, `drain`, `over #N`, `park #N`, `failed #N`,
// `human-review #N`, `stop #N`, `environment #N`, `busy #N`, `unresolved #N`, `launch-failed #N`,
// `error <message>` (a port threw), or `only`. Every explanation the reused commands print streams to stderr.
//
// It drives a run that already has a carry record (`run:carry --begin` opened it), so the start, the
// merged count and the 8-hour bound are the record's. A `--only` invocation is refused with `only`: its
// named list is run by the session one issue at a time and the pool is never drained.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ONLY_FLAG = '--only'
const COUNT_PATTERN = /^\d+$/u
const MIN_PID = 1
const NO_IDLE_MINUTES = 0

const USAGE =
	'Usage: josh backlog:drive [--max <n>] [--idle <minutes>] [--stash <message>] [--owner <pid>]'

const OPTIONS = {
	idle: { type: 'string' },
	max: { type: 'string' },
	owner: { type: 'string' },
	stash: { type: 'string' },
} as const

type Values = Partial<Record<keyof typeof OPTIONS, string>>

interface DriveArguments {
	options: DriveOptions
	stash: string | undefined
}

function read_values(argv: ReadonlyArray<string>): Values | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, strict: true }).values
	} catch {
		return undefined
	}
}

// A count flag given but unreadable refuses the invocation, rather than reading as absent.
function is_count(raw: string | undefined): boolean {
	return raw === undefined || (COUNT_PATTERN.test(raw) && Number.isSafeInteger(Number(raw)))
}

function count_of(raw: string | undefined): number | undefined {
	return raw === undefined ? undefined : Number(raw)
}

// The same resolution `backlog:budget` applies: absent is the default watch, `0` turns it off.
function idle_of(minutes: number | undefined): number | undefined {
	if (minutes === undefined) return backlog_budget.DEFAULT_IDLE_MS
	if (minutes === NO_IDLE_MINUTES) return undefined

	return minutes * backlog_budget.MS_PER_MINUTE
}

function owner_of(pid: number | undefined): CarryOwner | undefined {
	if (pid === undefined) return run_carry.NO_OWNER

	return pid < MIN_PID ? undefined : run_carry.owner_of(pid)
}

function to_arguments(values: Values): DriveArguments | undefined {
	if ([values.max, values.idle, values.owner].some((raw) => !is_count(raw))) return undefined

	const owner = owner_of(count_of(values.owner))

	if (owner === undefined) return undefined

	const options = {
		max_issues: count_of(values.max),
		idle_budget_ms: idle_of(count_of(values.idle)),
		owner,
	}

	return { options, stash: values.stash }
}

function parse(argv: ReadonlyArray<string>): DriveArguments | undefined {
	const values = read_values(argv)

	return values === undefined ? undefined : to_arguments(values)
}

function emit(line: string, code: number): number {
	console.info(line)

	return code
}

// The state a (re)started driver resumes from — open lanes and this invocation's events, never memory.
async function restored(stash: string | undefined): Promise<DriveState> {
	const open_lanes = await lane_registry.list_lanes()
	const lanes = open_lanes.map((lane) => lane.issue)
	const events = await run_event_stream_emit.current_events()

	return { ...backlog_drive.restore(lanes, events, Date.now()), stash }
}

async function drive(parsed: DriveArguments): Promise<number> {
	const carry = await backlog_drive_ports.read_record()

	if (carry === undefined) {
		console.error('No carry record: open the run with `pnpm josh run:carry --begin` first.')

		return emit('no-carry', FAILURE_EXIT_CODE)
	}

	if (carry.invocation.split(/\s+/u).includes(ONLY_FLAG)) return emit('only', SUCCESS_EXIT_CODE)

	const ports = backlog_drive_ports.ports_for(carry, parsed.options)
	const stop = await backlog_drive.drive(ports, await restored(parsed.stash))

	return emit(backlog_drive.line_of(stop), SUCCESS_EXIT_CODE)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = parse(argv)

	if (parsed === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await drive(parsed)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_drive_cli = { USAGE, main, parse, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_drive_cli }
