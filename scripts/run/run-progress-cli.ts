#!/usr/bin/env tsx
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gh_spawn } from '#scripts/gh-spawn'
import { run_progress, type ProgressState } from './run-progress'
import { run_progress_read, type ObservationRead } from './run-progress-read'

// `josh run:progress` — the background watcher that breaks a long silence with one line of
// observations, and `--mark`, which tells its clock that a real report just happened
// (joshuafolkken/kit#1520).
//
// **This is the one josh command that is meant to be started and left running.** Every other one
// answers once and the parent's own loop drives it; that shape was rejected here on purpose, because
// a parent that waits and reports spends one of its own turns per heartbeat — 36 of them in a
// three-hour run, taken at the point its context is largest. So the loop lives here, the parent
// starts it in the background, and all the parent does is relay what appears.
//
// **Standard output carries the progress line and nothing else**, the way `run:liveness` keeps its
// verdict there: a relaying parent should never have to tell a report apart from an explanation.
// Notices go to standard error.
//
// **It cannot send a Telegram.** That is structural rather than a promise — nothing here imports
// `scripts/git/telegram-notify`, which is the only egress there is. A heartbeat every ten minutes on
// a phone is notification fatigue, and it would cheapen the `confirmation` and `completion` messages
// that do need to interrupt someone.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
// How often the loop wakes to look at the clock — not how often it reports. It is short relative to
// the interval so that a `--mark` written by the run is noticed promptly, and long enough that a
// watcher left running overnight costs nothing measurable.
const TICK_SECONDS = 30
// How long a tick that printed nothing waits before it reads again.
//
// **A decline deliberately does not move the report clock** — the first child to appear is reported at
// once rather than waiting out an interval the repository spent idle. Without a cooldown, though, that
// same property re-reads GitHub every 30 seconds for the watcher's whole life: roughly 960 listings
// over eight idle hours, which is secondary-rate-limit territory and would itself start producing the
// unreadable listings this branch exists to handle. Two minutes keeps "reported at once" true to
// within a fraction of the ten-minute interval and takes the call count down with it.
const DECLINE_RETRY_SECONDS = 120
// The clock a fresh loop starts with: nothing has declined yet, so nothing is being waited out.
const NO_RETRY = 0
// A watcher outlives the turn that started it, so something has to end it. Eight hours is `run:hold`'s
// own expiry: longer than any run, short enough that one abandoned by a crashed session is gone by
// the next working day.
const DEFAULT_MAX_HOURS = 8
const MS_PER_HOUR = 3_600_000
const ENVIRONMENT_KEY = 'JOSH_PROGRESS'
const INTERVAL_KEY = 'JOSH_PROGRESS_INTERVAL_MINUTES'
const DISABLED_VALUE = '0'

const USAGE =
	'Usage: josh run:progress [--repo <owner/repo>] [--interval <minutes>] [--output <path>] [--once] [--hours <hours>] | josh run:progress --mark'
const DISABLED_NOTICE = `\`${ENVIRONMENT_KEY}=${DISABLED_VALUE}\` is set, so no progress is reported.`
const MARKED_NOTICE =
	'Recorded a report at this moment. The next progress line waits a full interval from here, so a heartbeat cannot land immediately behind a real report.'
const IDLE_NOTICE =
	'No open issue in this repository carries `in-progress`, so no child is in flight and there is nothing to report.'
const UNREADABLE_NOTICE =
	'The `in-progress` listing could not be read, so nothing is reported. That is not "nothing is running" — check `gh auth status` and ask again.'
const FAILED_TICK_PREFIX =
	'A progress reading failed, so nothing is reported for it. The watcher is still running, and will read again after the cooldown:'
// The repository name is only ever printed, never written against, so the bounded lookup is the right
// one: a `gh` call that hangs would otherwise block the synchronous read at startup and leave the
// watcher neither running nor saying so.
const REPO_LOOKUP_TIMEOUT_MS = 10_000

const DECLINE_NOTICES: Readonly<Record<'idle' | 'unreadable', string>> = {
	idle: IDLE_NOTICE,
	unreadable: UNREADABLE_NOTICE,
}

const DECLINE_EXIT_CODES: Readonly<Record<'idle' | 'unreadable', number>> = {
	// A repository with nothing running is an answer, and the command answered it.
	idle: SUCCESS_EXIT_CODE,
	// Nothing was established, so a caller must not proceed as though it had — the same fail-closed
	// reading `run:hold` and `run:liveness` give an unreadable record.
	unreadable: FAILURE_EXIT_CODE,
}

interface WatchOptions {
	interval_ms: number
	max_ms: number
	output_paths: ReadonlyArray<string>
	repo: string
	tick_ms: number
}

interface EmitContext {
	last_ms: number
	now_ms: number
	state: ProgressState | undefined
}

type DeclineKind = Exclude<ObservationRead['kind'], 'observed'>

// A union rather than an optional field, so a caller that wants the reason has to establish that
// there is one — the reason exists exactly when no line went out.
type EmitResult = { kind: DeclineKind } | { kind: 'observed'; state: ProgressState }

interface WatchLoop {
	// When the run last reported anything. Only a printed line moves it.
	last_ms: number
	// No read is attempted before this instant — the cooldown a declined tick sets.
	retry_at_ms: number
	// The notice already printed for the decline streak in progress, so a repeating condition is said
	// once rather than every cooldown.
	said: string | undefined
	state: ProgressState | undefined
}

const FRESH_LOOP: Omit<WatchLoop, 'last_ms'> = {
	retry_at_ms: NO_RETRY,
	said: undefined,
	state: undefined,
}

function is_disabled(): boolean {
	return process.env[ENVIRONMENT_KEY] === DISABLED_VALUE
}

function report_usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

function report_disabled(): number {
	console.error(DISABLED_NOTICE)

	return SUCCESS_EXIT_CODE
}

function report_decline(kind: DeclineKind): number {
	console.error(DECLINE_NOTICES[kind])

	return DECLINE_EXIT_CODES[kind]
}

/**
 * Read, decide, and print — or say nothing at all.
 *
 * The caller is told which of the three happened rather than only whether a line went out, because
 * the watch loop stays quiet about a repository with nothing running while a hand-typed `--once`
 * deserves an answer.
 */
async function emit(options: WatchOptions, context: EmitContext): Promise<EmitResult> {
	const read = await run_progress_read.read_observations({
		now_ms: context.now_ms,
		output_paths: options.output_paths,
		repo: options.repo,
	})

	if (read.kind !== 'observed') return { kind: read.kind }

	const key = run_progress.observation_key(read.observations)
	const state = run_progress.next_state(context.state, key, context.now_ms)

	console.info(
		run_progress.format_line(read.observations, {
			now_ms: context.now_ms,
			quiet_since_ms: context.last_ms,
			unchanged_since_ms: state.unchanged_since_ms,
		}),
	)

	return { kind: 'observed', state }
}

/**
 * A tick that printed nothing: say why once, and hold off reading again for the cooldown.
 *
 * **The reason reaches standard error even in watch mode.** A listing that could not be read is not
 * "nothing is running", and a watcher that swallowed it would go silent for hours in exactly the way
 * that is indistinguishable from an idle repository — the confident absence the three-way read exists
 * to prevent. It is said once per streak rather than once per cooldown, so a condition that lasts an
 * afternoon costs one line rather than a hundred and forty.
 */
function decline(loop: WatchLoop, now_ms: number, notice: string): WatchLoop {
	if (loop.said !== notice) console.error(notice)

	const cooldown_ms = DECLINE_RETRY_SECONDS * run_progress.MS_PER_SECOND

	return { ...loop, retry_at_ms: now_ms + cooldown_ms, said: notice }
}

// A read that threw is a tick that produced nothing, and it is handled as one rather than being
// allowed to end the watcher. **This is the whole reason the loop has a guard**: every reading below
// it spawns a process or touches the temp directory, so one `git worktree list` that cannot fork
// under load — the very load this command exists to report — would otherwise take the reporting down
// silently for the rest of an unattended run, with the parent not waiting on it and nothing saying why.
function to_notice(error: unknown): string {
	return `${FAILED_TICK_PREFIX} ${error instanceof Error ? error.message : String(error)}`
}

async function attempt(
	options: WatchOptions,
	target: string,
	loop: WatchLoop,
	now_ms: number,
): Promise<WatchLoop> {
	const result = await emit(options, { last_ms: loop.last_ms, now_ms, state: loop.state })

	if (result.kind !== 'observed') return decline(loop, now_ms, DECLINE_NOTICES[result.kind])

	run_progress_read.mark(target, now_ms)

	return { ...FRESH_LOOP, last_ms: now_ms, state: result.state }
}

/**
 * One wake-up.
 *
 * **The record is re-read every time rather than kept in memory**: `--mark` is written by another
 * process, and a watcher that trusted its own copy would go on counting from its last heartbeat and
 * print one straight after the run's real report — which is the single thing this command is built
 * not to do.
 *
 * **A tick that printed nothing does not move the report clock.** Where no child is in flight the
 * silence has not been broken, so the first child to appear is reported at once instead of waiting out
 * an interval it spent idle; what a decline moves instead is the read cooldown.
 */
async function step(options: WatchOptions, target: string, loop: WatchLoop): Promise<WatchLoop> {
	const now_ms = Date.now()

	if (now_ms < loop.retry_at_ms) return loop

	const last_ms = run_progress_read.read_last_report(target) ?? loop.last_ms

	// **A tick that was not due ends the decline streak**, because no read was attempted and so this
	// tick is not part of one. Without that, two unrelated outages either side of a quiet period read
	// as one streak: the first prints its notice, and the second — hours later, and permanent — is
	// deduplicated away against it, leaving the watcher silent in exactly the way the notice exists to
	// prevent.
	if (!run_progress.is_due(last_ms, now_ms, options.interval_ms)) {
		return { ...loop, last_ms, said: undefined }
	}

	try {
		return await attempt(options, target, { ...loop, last_ms }, now_ms)
	} catch (error) {
		return decline({ ...loop, last_ms }, now_ms, to_notice(error))
	}
}

async function watch(options: WatchOptions): Promise<number> {
	const target = await run_progress_read.stamp_target()
	const started_ms = Date.now()
	let loop: WatchLoop = {
		...FRESH_LOOP,
		last_ms: run_progress_read.read_last_report(target) ?? started_ms,
	}

	while (Date.now() - started_ms < options.max_ms) {
		await sleep(options.tick_ms)
		loop = await step(options, target, loop)
	}

	return SUCCESS_EXIT_CODE
}

// The manual form of the same reading: one line now, whatever the clock says. An explicit ask is not
// a heartbeat, so the silence check is not applied to it — but it still records the report, because a
// line the person has just read is one the watcher must not repeat.
async function once(options: WatchOptions): Promise<number> {
	const target = await run_progress_read.stamp_target()
	const now_ms = Date.now()
	const last_ms = run_progress_read.read_last_report(target) ?? now_ms
	const result = await emit(options, { last_ms, now_ms, state: undefined })

	if (result.kind !== 'observed') return report_decline(result.kind)

	run_progress_read.mark(target, now_ms)

	return SUCCESS_EXIT_CODE
}

async function mark_now(): Promise<number> {
	run_progress_read.mark(await run_progress_read.stamp_target(), Date.now())
	console.error(MARKED_NOTICE)

	return SUCCESS_EXIT_CODE
}

const OPTIONS = {
	hours: { type: 'string' },
	interval: { type: 'string' },
	mark: { type: 'boolean' },
	once: { type: 'boolean' },
	output: { type: 'string', multiple: true },
	repo: { type: 'string' },
} as const

interface ParsedValues {
	hours?: string
	interval?: string
	mark?: boolean
	once?: boolean
	output?: Array<string>
	repo?: string
}

function read_arguments(argv: ReadonlyArray<string>): ParsedValues | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS }).values
	} catch {
		return undefined
	}
}

// A hand-typed `--interval` outranks the environment, and the environment outranks the ten-minute
// default. Both go through the same reader, so an unusable value falls back rather than ending an
// unattended run over an optional setting.
function to_interval_ms(raw: string | undefined): number {
	return run_progress.interval_from(raw ?? process.env[INTERVAL_KEY])
}

function to_max_ms(raw: string | undefined): number {
	const hours = Number(raw)
	const is_usable = raw !== undefined && Number.isFinite(hours) && hours > 0

	return (is_usable ? hours : DEFAULT_MAX_HOURS) * MS_PER_HOUR
}

function to_options(values: ParsedValues): WatchOptions | undefined {
	const repo = values.repo ?? gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS)

	if (repo === undefined) return undefined

	return {
		interval_ms: to_interval_ms(values.interval),
		max_ms: to_max_ms(values.hours),
		output_paths: values.output ?? [],
		repo,
		tick_ms: TICK_SECONDS * run_progress.MS_PER_SECOND,
	}
}

async function run_watch(values: ParsedValues): Promise<number> {
	const options = to_options(values)

	if (options === undefined) return report_usage()

	return values.once === true ? await once(options) : await watch(options)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const values = read_arguments(argv)

	if (values === undefined) return report_usage()
	if (values.mark === true) return await mark_now()
	if (is_disabled()) return report_disabled()

	return await run_watch(values)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_progress_cli = {
	DECLINE_RETRY_SECONDS,
	DEFAULT_MAX_HOURS,
	DISABLED_NOTICE,
	FAILED_TICK_PREFIX,
	FRESH_LOOP,
	IDLE_NOTICE,
	MARKED_NOTICE,
	TICK_SECONDS,
	UNREADABLE_NOTICE,
	USAGE,
	main,
	read_arguments,
	report_decline,
	run,
	step,
	to_interval_ms,
	to_max_ms,
	to_options,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export type { EmitContext, EmitResult, WatchLoop, WatchOptions }
export { run_progress_cli }
