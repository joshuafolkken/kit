#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { cli_flags } from '#scripts/lib/cli-flags'
import { lane_capacity, type LimitChoice } from './lane-capacity'
import { lane_limit_override } from './lane-limit-override'

// `josh lane:limit [<limit>] [--reset]` — change a live `backlogrun`'s lane limit without stopping it.
// A running parent keeps the environment it started with, so `JOSH_LANE_LIMIT`
// cannot move under it; this writes an override onto the run's carry record, which
// `lane_capacity.lane_limit` reads first. Bare, it prints the limit, the lanes in use and the free ones.
//
// **Only a raise wakes anyone.** Lowering stops no child — a finished lane is simply not refilled — so
// there is nothing for the parent to do; a raise frees lanes, and its `lane-limit` event is what the
// `--wait` watcher's arrival probe wakes the parent for.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const MAX_POSITIONALS = 1
const NO_LIMIT = 0
const LIMIT_NAME = '<limit>'
const OVERRIDE_SOURCE = 'lane:limit override'
const USAGE = 'Usage: josh lane:limit [<limit>] [--reset]'
const NO_RUN_MESSAGE = `No run is in progress: lane:limit changes a live run's limit. Set ${lane_capacity.LANE_LIMIT_KEY} for the next run.`

const OPTIONS = { reset: { type: 'boolean' } } as const

// `set` with no limit is `--reset`: the override is cleared and the environment's limit stands.
type LimitRequest =
	| { kind: 'show' }
	| { kind: 'set'; limit: number | undefined }
	| { kind: 'refuse'; message: string }

interface LimitPorts {
	read_limit: () => Promise<LimitChoice>
	read_override: () => Promise<number | undefined>
	write_override: (limit: number | undefined) => Promise<boolean>
	emit_raise: (text: string) => Promise<void>
	live_lane_count: () => Promise<number>
}

interface LimitStatus {
	limit: number
	override: number | undefined
	in_use: number
}

const SHOW: LimitRequest = { kind: 'show' }
const RESET: LimitRequest = { kind: 'set', limit: undefined }
const USAGE_REFUSAL: LimitRequest = { kind: 'refuse', message: USAGE }

const DEFAULT_PORTS: LimitPorts = {
	read_limit: async () => await lane_capacity.lane_limit(),
	read_override: lane_limit_override.read_override,
	write_override: lane_limit_override.write_override,
	emit_raise: lane_limit_override.emit_raise,
	live_lane_count: backlog_ready.live_lane_count,
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

// The rule `JOSH_LANE_LIMIT` is read by, so the two refuse alike.
function limit_request(raw: string): LimitRequest {
	const choice = lane_capacity.read_limit(raw, LIMIT_NAME)

	return choice.kind === 'limit'
		? { kind: 'set', limit: choice.limit }
		: { kind: 'refuse', message: choice.problem }
}

function request_of(raw: string | undefined, is_reset: boolean): LimitRequest {
	if (is_reset) return raw === undefined ? RESET : USAGE_REFUSAL

	return raw === undefined ? SHOW : limit_request(raw)
}

function parse_request(argv: ReadonlyArray<string>): LimitRequest {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined || parsed.positionals.length > MAX_POSITIONALS) return USAGE_REFUSAL

	return request_of(parsed.positionals[0], parsed.values.reset === true)
}

// A limit past the port seats is shown at the seats it can actually fill, as `free_lanes` counts it.
function limit_text(limit: number): string {
	const seated = lane_capacity.seated_limit(limit)

	return seated === limit
		? String(limit)
		: `${String(seated)} (${String(limit)} capped at the seats)`
}

function status_line(status: LimitStatus): string {
	const source = status.override === undefined ? lane_capacity.LANE_LIMIT_KEY : OVERRIDE_SOURCE
	const free = lane_capacity.free_lanes(status.limit, status.in_use)

	return `lane limit ${limit_text(status.limit)} (${source}) · in use ${String(status.in_use)} · free ${String(free)}`
}

async function show(ports: LimitPorts): Promise<number> {
	const choice = await ports.read_limit()

	if (choice.kind === 'problem') return refuse(choice.problem)

	const override = await ports.read_override()

	console.info(
		status_line({ limit: choice.limit, override, in_use: await ports.live_lane_count() }),
	)

	return SUCCESS_EXIT_CODE
}

// An unreadable limit counts as none, so a valid one set over it is a raise.
async function seated_now(ports: LimitPorts): Promise<number> {
	const choice = await ports.read_limit()

	return choice.kind === 'limit' ? lane_capacity.seated_limit(choice.limit) : NO_LIMIT
}

// Measured in seats, so a raise past the seats — which frees no lane — wakes nobody.
async function change(limit: number | undefined, ports: LimitPorts): Promise<number> {
	const before = await seated_now(ports)

	if (!(await ports.write_override(limit))) return refuse(NO_RUN_MESSAGE)

	const after = await seated_now(ports)

	if (after > before) await ports.emit_raise(`lane limit ${String(before)} → ${String(after)}`)

	return await show(ports)
}

async function run(
	argv: ReadonlyArray<string>,
	ports: LimitPorts = DEFAULT_PORTS,
): Promise<number> {
	const request = parse_request(argv)

	if (request.kind === 'refuse') return refuse(request.message)

	return request.kind === 'show' ? await show(ports) : await change(request.limit, ports)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_limit_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { LimitPorts }
export { lane_limit_cli }
