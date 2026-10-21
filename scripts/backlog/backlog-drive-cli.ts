#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { auto_ok_judge_read, type JudgedCache } from '#scripts/auto-ok/auto-ok-judge-read'
import { issue_cite } from '#scripts/issue/issue-cite'
import { hook_decision } from '#scripts/josh/hook-decision'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_await, type AwaitState } from '#scripts/lane/lane-await'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_sampler } from '#scripts/lane/lane-sampler'
import { error_text } from '#scripts/lib/error-message'
import { json_value } from '#scripts/lib/json-value'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_driver } from '#scripts/run/merge/run-merge-driver'
import { z } from 'zod'
import { backlog_budget } from './backlog-budget'
import {
	backlog_drive,
	type DriveEnd,
	type DriveState,
	type LoopConfig,
	type LoopPorts,
	type OfferRead,
} from './backlog-drive'
import { backlog_drive_adopt } from './backlog-drive-adopt'
import { backlog_drive_args, type DriveContext } from './backlog-drive-args'
import { backlog_drive_carried } from './backlog-drive-carried'
import { backlog_drive_finish } from './backlog-drive-finish'
import { backlog_drive_hold, type HoldRecorder } from './backlog-drive-hold'
import { backlog_drive_idle } from './backlog-drive-idle'
import { backlog_drive_launch } from './backlog-drive-launch'
import { backlog_drive_memory } from './backlog-drive-memory'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
import { backlog_drive_offer_argv } from './backlog-drive-offer-argv'
import { backlog_drive_owner } from './backlog-drive-owner'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_drive_retrospective } from './backlog-drive-retrospective'
import { backlog_drive_seats } from './backlog-drive-seats'
import { backlog_offer_cli } from './backlog-offer-cli'
import { backlog_ready } from './backlog-ready'

// `josh backlog:drive` — the backlogrun parent's loop as one resident wait.
// The parent issues it once, in the background, and is woken only when it exits — with a token the model
// has to read. The loop itself is `backlog-drive.ts`; this file is its ports onto the commands it reuses.
//
// **The contract is the composites': stdout carries the hand-back on its first line** — the reason, then
// the token and child where a command printed one (`merge over #2493`, `launch #2500`, `watch`, `stop`,
// `window`) — and a second line `resume: <flags>` the parent passes back to continue from exactly here.
// The explanations the reused commands print stream through to stderr.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const should_forward_stderr = true
const POLL_MS = 5000
const FIRST_LINE = 0

// The `--json` object `backlog:offer` prints, keyed under its `JSON_KEY`.
const offer_read_schema = z.object({
	verdict: z.string(),
	issues: z.array(z.string()),
	retries: z.number(),
	answer: z.string().optional(),
	reason: z.string().optional(),
	is_finish: z.boolean().optional(),
})
const offer_schema = z.object({ [backlog_offer_cli.JSON_KEY]: offer_read_schema })

function to_offer(out: string): OfferRead | undefined {
	return json_value.parse_with(out, offer_schema)?.[backlog_offer_cli.JSON_KEY]
}

async function read_record(): Promise<RunCarry | undefined> {
	const target = await run_carry.repository_directory()

	if (target === undefined) return undefined

	const read = run_carry.read_carry(run_carry.carry_path(target))

	return read.kind === 'carried' ? read.carry : undefined
}

async function read_offer(
	state: DriveState,
	context: DriveContext,
): Promise<OfferRead | undefined> {
	const carry = await backlog_drive_owner.assert_current(context.owner)
	const named = await backlog_drive_named_offer.read(carry, state, context)
	if (named !== undefined) return named

	const argv = backlog_drive_offer_argv.offer_argv(state, carry, context.forwarded)
	const result = await josh_command.josh_run(argv, should_forward_stderr)

	const offer = result.code === SUCCESS_EXIT_CODE ? to_offer(result.out) : undefined

	return offer === undefined
		? undefined
		: { ...offer, is_retrospective_owed: backlog_drive_retrospective.is_owed(carry) }
}

// A non-zero `run:merge` prints its token first only for a hand-off (`busy`, `stop`, `retry`); any
// other first line — pnpm's `[ELIFECYCLE]` note after a crash — reads as no token, never a collection.
function merge_token(out: string, code: number): string {
	const token = out.split('\n', FIRST_LINE + 1)[FIRST_LINE] ?? ''

	if (code === SUCCESS_EXIT_CODE || backlog_drive.HANDOFF_TOKENS.has(token)) return token

	return ''
}

// A `run:merge` that printed no result — a crash before its verdict — answers no token, which the loop
// never reads as a collection.
function unprinted(code: number): MergeResult {
	return { token: '', code, is_offer: true, outcome: 'unresolved' }
}

// The child's transcript, where its lane recorded one, so `run:merge` can tell an API outage from a
// failure exactly as it does for the parent that passes `--output` by hand. Run as its own process
// (`run-merge-driver.ts`), so a fix merged since this loop started is the code that decides the child.
async function merge(issue: string, owner: string): Promise<MergeResult> {
	await backlog_drive_owner.assert_current(owner)
	const lane = await lane_registry.find_open_lane(issue)
	const argv = run_merge_driver.argv_of({ child: issue, owner, output: lane?.output })
	const ran = await josh_command.josh_run(argv, should_forward_stderr)
	const result = run_merge_driver.read(ran.out) ?? unprinted(ran.code)

	await backlog_drive_named.mark_done(issue, result, owner)

	return result
}

// `lane:await`'s re-confirmed check, one state per child. A child already gone when the loop starts —
// a restart after it ended — is read as having appeared, so it is collected after the re-confirm window
// rather than waited on until the never-appeared timeout. One that never appeared is collected too:
// `run:merge` reads its state rather than this loop guessing.
function finished_checker(seeded: ReadonlySet<string>): (issue: string) => boolean {
	const states = new Map<string, AwaitState>()
	const config = {
		is_running: lane_await.is_process_running_default,
		reconfirm_ms: lane_await.RECONFIRM_MS,
		never_appeared_timeout_ms: lane_await.NEVER_APPEARED_TIMEOUT_MS,
	}

	return (issue: string): boolean => {
		const state = states.get(issue) ?? {
			appeared: seeded.has(issue),
			disappeared_at: undefined,
			first_polled_at: undefined,
		}

		states.set(issue, state)

		try {
			return lane_await.check_issue(issue, state, Date.now(), config) !== undefined
		} catch {
			return true
		}
	}
}

async function open_lanes(): Promise<ReadonlyArray<LaneInfo>> {
	const lanes = await lane_registry.list_lanes()

	return lanes.filter((lane) => !lane.is_stranded)
}

function end_line(end: DriveEnd): string {
	const token = end.token === undefined || end.token === end.reason ? [] : [end.token]
	const issue = end.issue === undefined ? [] : [issue_cite.plain(end.issue)]
	const base = [end.reason, ...token, ...issue].join(' ')

	return end.detail === undefined ? base : `${base} ${end.detail}`
}

// The count of open issues owing an `auto-ok` judgement, over a cache kept for the process so a watch
// minute reads the comments only of the issues that moved (`auto-ok-judge-read.ts`).
function judgement_reader(): () => Promise<number> {
	const cache: JudgedCache = new Map()

	return async () => {
		const owed = await auto_ok_judge_read.owed(cache)

		return owed?.length ?? 0
	}
}

// The two reports an offered pass leaves: why it started nothing, and the idle notice.
function reporters(holds: HoldRecorder): Pick<LoopPorts, 'hold' | 'idle'> {
	return { hold: holds.hold, idle: backlog_drive_idle.notify }
}

// What a launch is weighed against: the free lanes, a kept lane, and the memory for one more.
function room_ports(): Pick<LoopPorts, 'free_lanes' | 'has_lane' | 'limit_room' | 'memory_held'> {
	return {
		free_lanes: backlog_ready.drive_free_lane_count,
		limit_room: backlog_ready.drive_limit_room,
		has_lane: backlog_drive_seats.has_kept_lane,
		memory_held: backlog_drive_memory.gauge(),
	}
}

// The children's ports. An adopted lane was dispatched like a seeded one, so a child already gone is
// collected rather than waited on until the never-appeared timeout.
function child_ports(
	seeded: ReadonlyArray<string>,
	owner: string,
): Pick<LoopPorts, 'adoptable' | 'is_finished' | 'merge'> {
	const known = new Set(seeded)

	return {
		is_finished: finished_checker(known),
		merge: async (issue) => await merge(issue, owner),
		adoptable: async (in_flight) => {
			const adopting = await backlog_drive_adopt.adoptable(in_flight)

			for (const issue of adopting) known.add(issue)

			return adopting
		},
	}
}

function ports_of(
	context: DriveContext,
	seeded: ReadonlyArray<string>,
	last: { state: DriveState },
	holds: HoldRecorder,
): LoopPorts {
	return {
		...child_ports(seeded, context.owner),
		offer: async (state) => await read_offer(state, context),
		launch: async (issue) => await backlog_drive_launch.launch(issue, context.owner),
		...room_ports(),
		judgement_owed: judgement_reader(),
		...reporters(holds),
		now: () => new Date(),
		sleep: async (milliseconds) => {
			await sleep(milliseconds)
		},
		finish: backlog_drive_finish.finish,
		on_state: (state) => {
			last.state = state
		},
	}
}

// The lanes still in flight, and the children this run withdrew: a withdrawal while the drive was
// handed back is never collected by this invocation, so its exclusion is read from the stream
// (joshuafolkken/kit#4365).
interface Seeded {
	lanes: ReadonlyArray<string>
	withdrawn: ReadonlyArray<string>
}

async function seeded_lanes(context: DriveContext): Promise<Seeded | undefined> {
	const carry = await read_record()

	if (carry === undefined) return undefined

	const events = await run_event_stream_emit.current_events()

	await backlog_drive_named.reconcile(carry, events, context.owner)

	const open = await open_lanes()
	const lanes = [...new Set([...open.map((lane) => lane.issue), ...context.awaited])]
	const carried = await backlog_drive_carried.carried(open)
	const dispatched = backlog_drive_named.own_carried(carry, carried, context.is_only)

	return {
		lanes: backlog_drive_restore.restore(lanes, events, carry.merged_issues ?? [], dispatched),
		withdrawn: backlog_drive_restore.withdrawn_issues(events),
	}
}

// The interval between two asks is `backlog:budget`'s own, so the driver keeps the one its reason prints.
function loop_config(window_ms: number | undefined): LoopConfig {
	return { poll_ms: POLL_MS, offer_ms: backlog_budget.OFFER_INTERVAL_MS, window_ms }
}

// The hand-back, the ledger's hold included — the lanes now wait on a session — and the resume line.
async function report_end(
	end: DriveEnd,
	state: DriveState,
	context: DriveContext,
	holds: HoldRecorder,
): Promise<void> {
	await holds.end(end)
	console.info(end_line(end))
	console.info(backlog_drive_args.resume_line(state, context))
}

function seeded_state(seeded: Seeded, context: DriveContext): DriveState {
	const fresh = backlog_drive.initial_state(
		seeded.lanes,
		context.active ?? new Date().toISOString(),
	)
	const initial =
		context.stopped === undefined ? fresh : backlog_drive.merge_stopped(context.stopped, fresh)

	return { ...initial, exclude: [...new Set([...context.exclude, ...seeded.withdrawn])] }
}

async function drive(context: DriveContext): Promise<number> {
	const seeded = await seeded_lanes(context)

	if (seeded === undefined) return FAILURE_EXIT_CODE
	const last = { state: seeded_state(seeded, context) }
	const holds = backlog_drive_hold.recorder()
	const ports = ports_of(context, seeded.lanes, last, holds)
	const end = await backlog_drive.run_loop(last.state, loop_config(context.window_ms), ports)

	await report_end(end, last.state, context, holds)

	return SUCCESS_EXIT_CODE
}

// The machine load is sampled for exactly as long as the drive runs, so a `backlogrun` leaves its own
// load in the lane ledger without a sampler anyone has to start or stop (`lane-sampler.ts`).
async function run_safe(context: DriveContext): Promise<number> {
	const stop_sampling = lane_sampler.start()

	try {
		return await drive(context)
	} catch (error) {
		console.info(`error ${error_text.message_of(error)}`)

		return FAILURE_EXIT_CODE
	} finally {
		stop_sampling()
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const context = backlog_drive_args.parse(argv)

	if (context === undefined) {
		console.error(backlog_drive_args.USAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_safe(context)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	// Load `.env` on the real command path only, so `JOSH_RETROSPECTIVE` set there reaches the offer read.
	hook_decision.load_environment_file()
	process.exitCode = await run(argv)
}

const backlog_drive_cli = {
	end_line,
	finish: backlog_drive_finish.finish,
	loop_config,
	merge,
	merge_token,
	offer_argv: backlog_drive_offer_argv.offer_argv,
	parse: backlog_drive_args.parse,
	read_offer,
	resume_line: backlog_drive_args.resume_line,
	run,
	seeded_state,
	to_offer,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_drive_cli }
