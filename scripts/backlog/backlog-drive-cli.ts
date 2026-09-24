#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_await, type AwaitState } from '#scripts/lane/lane-await'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type RunCarry } from '#scripts/run/run-carry'
import { z } from 'zod'
import {
	backlog_drive,
	type DriveEnd,
	type DriveState,
	type LoopPorts,
	type OfferRead,
} from './backlog-drive'
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
	'Usage: josh backlog:drive --owner <pid> [--active <ISO-8601>] [--max <n>] [--idle <minutes>] [--exclude <n>[,<n>...]] [--await <n>[,<n>...]] [--window <minutes>]'

const OPTIONS = {
	active: { type: 'string' },
	await: { type: 'string' },
	exclude: { type: 'string' },
	idle: { type: 'string' },
	max: { type: 'string' },
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
}

type Values = Partial<Record<keyof typeof OPTIONS, string>>

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

	return { owner, active: values.active, forwarded, exclude, awaited, window_ms }
}

function parse(argv: ReadonlyArray<string>): DriveContext | undefined {
	const values = read_values(argv)
	const owner = owner_of(values)

	return values === undefined || owner === undefined ? undefined : to_context(values, owner)
}

// `--started` and `--merged` are the carry record's, read at every ask so a merge counted by `run:merge`
// reaches the budget on the next one (`backlogrun-steps.md` → "The session cut is inside the invocation").
function offer_argv(
	state: DriveState,
	carry: RunCarry,
	forwarded: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return [
		'backlog:offer',
		'--json',
		'--started',
		carry.started_at,
		'--active',
		state.active,
		'--merged',
		String(carry.merged),
		'--running',
		String(state.in_flight.length),
		'--retries',
		String(state.retries),
		...(state.exclude.length === 0 ? [] : ['--exclude', state.exclude.join(LIST_SEPARATOR)]),
		...forwarded,
	]
}

// The `--json` object `backlog:offer` prints, keyed under its `JSON_KEY`.
const offer_read_schema = z.object({
	verdict: z.string(),
	issues: z.array(z.string()),
	retries: z.number(),
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

	return read.kind === 'carried' ? read.carry : undefined
}

async function read_offer(
	state: DriveState,
	forwarded: ReadonlyArray<string>,
): Promise<OfferRead | undefined> {
	const carry = await read_record()

	if (carry === undefined) return undefined

	const argv = offer_argv(state, carry, forwarded)
	const result = await josh_command.josh_run(argv, should_forward_stderr)

	return result.code === SUCCESS_EXIT_CODE ? to_offer(result.out) : undefined
}

async function output_argv(issue: string): Promise<ReadonlyArray<string>> {
	const output = await josh_command.josh_run(['lane:output', issue])

	return output.code === SUCCESS_EXIT_CODE && output.out !== '' ? ['--output', output.out] : []
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
	const argv = ['run:merge', issue, '--owner', owner, ...(await output_argv(issue))]
	const result = await josh_command.josh_run(argv, should_forward_stderr)

	return merge_token(result.out, result.code)
}

async function launch(issue: string): Promise<boolean> {
	const result = await josh_command.josh_run(['lane:launch', issue], should_forward_stderr)

	return result.code === SUCCESS_EXIT_CODE
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

	return `resume: ${flags.join(' ')}`
}

function end_line(end: DriveEnd): string {
	const token = end.token === undefined || end.token === end.reason ? [] : [end.token]
	const issue = end.issue === undefined ? [] : [`#${end.issue}`]

	return [end.reason, ...token, ...issue].join(' ')
}

function ports_of(
	context: DriveContext,
	seeded: ReadonlyArray<string>,
	last: { state: DriveState },
): LoopPorts {
	return {
		is_finished: finished_checker(seeded),
		merge: async (issue) => await merge(issue, context.owner),
		offer: async (state) => await read_offer(state, context.forwarded),
		launch,
		now: () => new Date(),
		sleep: async (milliseconds) => {
			await sleep(milliseconds)
		},
		on_state: (state) => {
			last.state = state
		},
	}
}

async function drive(context: DriveContext): Promise<number> {
	const seeded = [...new Set([...(await open_lanes()), ...context.awaited])]
	const initial = backlog_drive.initial_state(seeded, context.active ?? new Date().toISOString())
	const last = { state: { ...initial, exclude: [...context.exclude] } }
	const config = { poll_ms: POLL_MS, offer_ms: OFFER_MS, window_ms: context.window_ms }
	const end = await backlog_drive.run_loop(last.state, config, ports_of(context, seeded, last))

	console.info(end_line(end))
	console.info(resume_line(last.state, context))

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const context = parse(argv)

	if (context === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await drive(context)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_drive_cli = {
	USAGE,
	end_line,
	merge_token,
	offer_argv,
	parse,
	resume_line,
	run,
	to_offer,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_drive_cli }
