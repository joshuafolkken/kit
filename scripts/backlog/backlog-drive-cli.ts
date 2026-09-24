#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_await, type AwaitState } from '#scripts/lane/lane-await'
import { lane_launch_cli } from '#scripts/lane/lane-launch-cli'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type RunCarry } from '#scripts/run/run-carry'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { run_merge_cli } from '#scripts/run/run-merge-cli'
import { z } from 'zod'
import {
	backlog_drive,
	type DriveEnd,
	type DriveState,
	type LoopPorts,
	type OfferRead,
} from './backlog-drive'
import { backlog_drive_finish } from './backlog-drive-finish'
import { backlog_drive_named } from './backlog-drive-named'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
import { backlog_drive_offer_argv } from './backlog-drive-offer-argv'
import { backlog_drive_owner } from './backlog-drive-owner'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_offer_cli } from './backlog-offer-cli'

// `josh backlog:drive` — the backlogrun parent's loop as one resident wait (joshuafolkken/kit#2499).
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
const OFFER_MS = 60_000
const MS_PER_MINUTE = 60_000
const FIRST_LINE = 0
const LIST_SEPARATOR = ','
const COUNT_PATTERN = /^\d+$/u
const ISSUE_PATTERN = /^[1-9]\d*$/u
const USAGE =
	'Usage: josh backlog:drive --owner <pid> [--active <ISO-8601>] [--max <n>] [--idle <minutes>] [--only] [--exclude <n>[,<n>...]] [--await <n>[,<n>...]] [--window <minutes>]'

const OPTIONS = {
	active: { type: 'string' },
	await: { type: 'string' },
	exclude: { type: 'string' },
	idle: { type: 'string' },
	max: { type: 'string' },
	only: { type: 'boolean' },
	owner: { type: 'string' },
	window: { type: 'string' },
} as const

interface DriveContext {
	owner: string
	active: string | undefined
	// Flags forwarded to `backlog:offer` unchanged — the declared budgets.
	forwarded: ReadonlyArray<string>
	exclude: ReadonlyArray<string>
	awaited: ReadonlyArray<string>
	window_ms: number | undefined
	window: string | undefined
	is_only: boolean
}

type Values = Partial<Record<Exclude<keyof typeof OPTIONS, 'only'>, string>> & { only?: boolean }

function read_values(argv: ReadonlyArray<string>): Values | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, strict: true }).values
	} catch {
		return undefined
	}
}

// A comma list of issue numbers; one entry that is not an issue number refuses the whole list.
function to_issues(raw: string | undefined): ReadonlyArray<string> | undefined {
	if (raw === undefined) return []

	const issues = raw.split(LIST_SEPARATOR)

	return issues.some((issue) => !ISSUE_PATTERN.test(issue)) ? undefined : issues
}

function forwarded_of(values: Values): ReadonlyArray<string> | undefined {
	const pairs = (['max', 'idle'] as const).filter((name) => values[name] !== undefined)

	if (pairs.some((name) => !COUNT_PATTERN.test(values[name] ?? ''))) return undefined

	return pairs.flatMap((name) => [`--${name}`, values[name] ?? ''])
}

// An absent window is no bound; a present one must be a count, which `is_valid_window` checks first.
function window_of(raw: string | undefined): number | undefined {
	return raw === undefined ? undefined : Number(raw) * MS_PER_MINUTE
}

function is_valid_window(raw: string | undefined): boolean {
	return raw === undefined || COUNT_PATTERN.test(raw)
}

function owner_of(values: Values | undefined): string | undefined {
	const owner = values?.owner

	return owner !== undefined && COUNT_PATTERN.test(owner) ? owner : undefined
}

function to_context(values: Values, owner: string): DriveContext | undefined {
	if (!is_valid_window(values.window)) return undefined

	const forwarded = forwarded_of(values)
	const exclude = to_issues(values.exclude)
	const awaited = to_issues(values.await)

	if (forwarded === undefined || exclude === undefined || awaited === undefined) return undefined

	const window_ms = window_of(values.window)

	return {
		owner,
		active: values.active,
		forwarded,
		exclude,
		awaited,
		window_ms,
		window: values.window,
		is_only: values.only === true,
	}
}

function parse(argv: ReadonlyArray<string>): DriveContext | undefined {
	const values = read_values(argv)
	const owner = owner_of(values)

	return values === undefined || owner === undefined ? undefined : to_context(values, owner)
}

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
	try {
		const parsed = offer_schema.safeParse(JSON.parse(out))

		return parsed.success ? parsed.data[backlog_offer_cli.JSON_KEY] : undefined
	} catch {
		return undefined
	}
}

async function read_record(): Promise<RunCarry | undefined> {
	const target = await run_carry.repository_directory()

	if (target === undefined) return undefined

	const read = run_carry.read_carry(run_carry.carry_path(target))

	return read.kind === 'carried' || read.kind === 'expired' ? read.carry : undefined
}

async function read_offer(
	state: DriveState,
	context: DriveContext,
): Promise<OfferRead | undefined> {
	await backlog_drive_owner.assert_current(context.owner)
	const carry = await read_record()

	if (carry === undefined) return undefined
	const named = await backlog_drive_named_offer.read(carry, state, context)
	if (named !== undefined) return named

	const argv = backlog_drive_offer_argv.offer_argv(state, carry, context.forwarded)
	const result = await josh_command.josh_run(argv, should_forward_stderr)

	const offer = result.code === SUCCESS_EXIT_CODE ? to_offer(result.out) : undefined

	return offer === undefined
		? undefined
		: { ...offer, is_retrospective_done: carry.retrospective === true }
}

// A non-zero `run:merge` prints its token first only for a hand-off (`busy`, `stop`, `retry`); any
// other first line — pnpm's `[ELIFECYCLE]` note after a crash — reads as no token, never a collection.
function merge_token(out: string, code: number): string {
	const token = out.split('\n', FIRST_LINE + 1)[FIRST_LINE] ?? ''

	if (code === SUCCESS_EXIT_CODE || backlog_drive.HANDOFF_TOKENS.has(token)) return token

	return ''
}

// The child's transcript, where its lane recorded one, so `run:merge` can tell an API outage from a
// failure exactly as it does for the parent that passes `--output` by hand.
async function merge(issue: string, owner: string): Promise<string> {
	await backlog_drive_owner.assert_current(owner)
	const lane = await lane_registry.find_open_lane(issue)
	const result = await run_merge_cli.merge_child({
		child: issue,
		epic: undefined,
		repo: undefined,
		over: CONTEXT_CUT_THRESHOLD,
		owner: run_carry.owner_of(Number(owner)),
		output: lane?.output,
	})

	await backlog_drive_named.mark_done(issue, result, owner)

	return result.token
}

async function launch(issue: string, owner: string): Promise<boolean> {
	await backlog_drive_owner.assert_current(owner)

	return (await lane_launch_cli.launch_lane({ issue, stash: undefined })) !== undefined
}

// `lane:await`'s re-confirmed check, one state per child. A child already gone when the loop starts —
// a restart after it ended — is read as having appeared, so it is collected after the re-confirm window
// rather than waited on until the never-appeared timeout. One that never appeared is collected too:
// `run:merge` reads its state rather than this loop guessing.
function finished_checker(seeded: ReadonlyArray<string>): (issue: string) => boolean {
	const states = new Map<string, AwaitState>()
	const config = {
		is_running: lane_await.is_process_running_default,
		reconfirm_ms: lane_await.RECONFIRM_MS,
		never_appeared_timeout_ms: lane_await.NEVER_APPEARED_TIMEOUT_MS,
	}

	return (issue: string): boolean => {
		const state = states.get(issue) ?? {
			appeared: seeded.includes(issue),
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

async function open_lanes(): Promise<ReadonlyArray<string>> {
	const lanes = await lane_registry.list_lanes()

	return lanes.filter((lane) => !lane.is_stranded).map((lane) => lane.issue)
}

function resume_line(state: DriveState, context: DriveContext): string {
	const exclude = [...new Set([...context.exclude, ...state.exclude])]
	const flags = ['--owner', context.owner, '--active', state.active, ...context.forwarded]

	if (exclude.length > 0) flags.push('--exclude', exclude.join(LIST_SEPARATOR))
	if (context.window !== undefined) flags.push('--window', context.window)

	return `resume: ${flags.join(' ')}`
}

function end_line(end: DriveEnd): string {
	const token = end.token === undefined || end.token === end.reason ? [] : [end.token]
	const issue = end.issue === undefined ? [] : [`#${end.issue}`]
	const base = [end.reason, ...token, ...issue].join(' ')

	return end.detail === undefined ? base : `${base} ${end.detail}`
}

function ports_of(
	context: DriveContext,
	seeded: ReadonlyArray<string>,
	last: { state: DriveState },
): LoopPorts {
	return {
		is_finished: finished_checker(seeded),
		merge: async (issue) => await merge(issue, context.owner),
		offer: async (state) => await read_offer(state, context),
		launch: async (issue) => await launch(issue, context.owner),
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

async function seeded_lanes(context: DriveContext): Promise<ReadonlyArray<string> | undefined> {
	const carry = await read_record()

	if (carry === undefined) return undefined

	const events = await run_event_stream_emit.current_events()

	await backlog_drive_named.reconcile(carry, events, context.owner)

	const lanes = [...new Set([...(await open_lanes()), ...context.awaited])]

	return backlog_drive_restore.restore(lanes, events, carry.merged_issues ?? [])
}

async function drive(context: DriveContext): Promise<number> {
	const seeded = await seeded_lanes(context)

	if (seeded === undefined) return FAILURE_EXIT_CODE
	const initial = backlog_drive.initial_state(seeded, context.active ?? new Date().toISOString())
	const last = { state: { ...initial, exclude: [...context.exclude] } }
	const config = { poll_ms: POLL_MS, offer_ms: OFFER_MS, window_ms: context.window_ms }
	const end = await backlog_drive.run_loop(last.state, config, ports_of(context, seeded, last))

	console.info(end_line(end))
	console.info(resume_line(last.state, context))

	return SUCCESS_EXIT_CODE
}

async function run_safe(context: DriveContext): Promise<number> {
	try {
		return await drive(context)
	} catch (error) {
		console.info(`error ${error instanceof Error ? error.message : String(error)}`)

		return FAILURE_EXIT_CODE
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const context = parse(argv)

	if (context === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await run_safe(context)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_drive_cli = {
	USAGE,
	end_line,
	finish: backlog_drive_finish.finish,
	merge_token,
	offer_argv: backlog_drive_offer_argv.offer_argv,
	parse,
	resume_line,
	run,
	to_offer,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_drive_cli }
