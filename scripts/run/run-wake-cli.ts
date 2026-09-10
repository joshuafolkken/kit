#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gh_spawn } from '#scripts/gh-spawn'
import { telegram_notify } from '#scripts/git/telegram-notify'
import { run_carry, type CarryRead } from './run-carry'
import { run_wake, type RunWake } from './run-wake'
import { run_wake_loop, type LoopPorts, type LoopStop } from './run-wake-loop'
import { run_wake_session, type LaunchResult } from './run-wake-session'

// `josh run:wake --start | --list | --stop | --loop` — the supervisor that continues a cut
// `backlogrun` without a person retyping the keyword (joshuafolkken/kit#1719).
//
// The stdout/stderr split is the contract every `run:*` command shares: exactly one verdict token on
// stdout on every path, the reason and the advice on stderr, so a loop branches on one token.
//
// **`--start` and `--loop` are two halves of one thing.** `--start` spawns this same script detached
// with `--loop` and returns immediately, which is what leaves the supervisor outside the conversation;
// `--loop` is the body, and running it in the foreground is how a person watches what it does.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ONE_GROUP = 1
const MS_PER_SECOND = 1000
const DEFAULT_INTERVAL_SECONDS = 60
// Long enough that a stalled `gh` never holds the warning back, short enough that the message still
// names the repository it is about.
const REPO_LOOKUP_TIMEOUT_MS = 5000
// Whole and positive. A zero interval is a busy loop against the temp directory, not a faster
// supervisor.
const INTERVAL_PATTERN = /^[1-9]\d*$/u
// **Bounded above as well as below, and for the same reason.** `setTimeout` clamps any delay past
// 2^31−1 ms to *one millisecond*, so a number large enough to look like "poll rarely" produces exactly
// the busy loop the lower bound exists to prevent. An hour is far past any useful polling interval and
// nowhere near the clamp.
const MAX_INTERVAL_SECONDS = 3600
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const UNKNOWN_CUTS = 'an unreadable number of'

const STARTED_VERDICT = 'started'
const RUNNING_VERDICT = 'running'
const STOPPED_VERDICT = 'stopped'
const SUPERVISING_VERDICT = 'supervising'
const STALE_VERDICT = 'stale'
const NONE_VERDICT = 'none'
const UNKNOWN_VERDICT = 'unknown'
const FAILED_VERDICT = 'failed'

const STOP_COMMAND = 'pnpm josh run:wake --stop'
const UNSAFE_INVOCATION_NOTE =
	'the carried invocation is not text that may be passed to a command line'
const WARNING_TITLE = 'backlogrun supervisor'
const WARNING_BODY = 'The supervisor could not continue the run and has stopped.'
const WARNING_RECOVERY = `Check the wake command, then restart with \`pnpm josh run:wake --start\`.`
const SUPERSEDED_NOTE =
	'another supervisor now holds the record, so it was left alone; this loop is the superseded one'

const USAGE = 'Usage: josh run:wake --start | --list | --stop | --loop [--interval <seconds>]'

const OPTIONS = {
	interval: { type: 'string' },
	list: { type: 'boolean' },
	loop: { type: 'boolean' },
	start: { type: 'boolean' },
	stop: { type: 'boolean' },
} as const

type ParsedValues = Partial<Record<keyof typeof OPTIONS, string | boolean>>

// The three paths every verb needs: the carry record it reads, its own record, and the work tree a
// woken session runs in. The work tree is the common git directory's parent, which is the *primary*
// checkout — a lane must never be where the next session resumes, because a lane belongs to one child.
interface WakeContext {
	carry_target: string
	wake_target: string
	worktree: string
}

function report(verdict: string, exit_code: number = SUCCESS_EXIT_CODE): number {
	console.info(verdict)

	return exit_code
}

function usage(): number {
	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

function note_to_stderr(note: string): void {
	console.error(`wake: ${note}`)
}

function read_arguments(argv: ReadonlyArray<string>): ParsedValues | undefined {
	try {
		return parseArgs({ args: [...argv], options: OPTIONS, strict: true }).values
	} catch {
		return undefined
	}
}

function text_of(value: string | boolean | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function to_interval_ms(value: string | boolean | undefined): number | undefined {
	if (typeof value !== 'string') return DEFAULT_INTERVAL_SECONDS * MS_PER_SECOND
	if (!INTERVAL_PATTERN.test(value)) return undefined

	const seconds = Number(value)

	return seconds > MAX_INTERVAL_SECONDS ? undefined : seconds * MS_PER_SECOND
}

// Exactly one verb, never a guessed order between two.
function group_count(values: ParsedValues): number {
	const verbs = [values.start, values.stop, values.list, values.loop]

	return verbs.filter((flag) => flag === true).length
}

async function resolve_context(): Promise<WakeContext | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	return {
		carry_target: run_carry.carry_path(directory),
		wake_target: run_wake.wake_path(directory),
		worktree: path.dirname(directory),
	}
}

// There is nothing to supervise unless a run is actually carrying a budget. Refusing here rather than
// starting a supervisor that would stop on its first pass is what keeps `--start` honest: a `started`
// that ends a second later is worse than a refusal that says why.
function refuse_without_carry(kind: CarryRead['kind']): number {
	console.error(`No carried run here to supervise — \`pnpm josh run:carry --json\` says ${kind}.`)

	return report(NONE_VERDICT, FAILURE_EXIT_CODE)
}

function carry_cuts(read: CarryRead): string {
	if (read.kind === 'carried') return String(read.carry.cuts)
	if (read.kind === 'expired') return String(read.carry.cuts)

	return UNKNOWN_CUTS
}

// The wake count is printed beside the carry record's `cuts` rather than alone, because the two being
// equal is the property worth being able to check — one wake per cut is the whole invariant.
function describe_wake(wake: RunWake, context: WakeContext): string {
	const live = run_wake.is_supervisor_live(wake) ? 'running' : 'not running'
	const cuts = carry_cuts(run_carry.read_carry(context.carry_target))

	return [
		`invocation: ${wake.invocation}`,
		`supervisor: process ${String(wake.pid)} (${live}), watching since ${wake.started_at}`,
		`woke ${String(wake.woke)} session(s) across ${cuts} cut(s)`,
		`stop it with \`${STOP_COMMAND}\``,
	].join('\n')
}

function wake_session(context: WakeContext, invocation: string): LaunchResult {
	const argv = run_wake_session.wake_argv(invocation)

	if (argv === undefined) return { kind: 'failed', note: UNSAFE_INVOCATION_NOTE }

	return run_wake_session.launch({ argv, cwd: context.worktree }, note_to_stderr)
}

function ports_for(context: WakeContext): LoopPorts {
	return {
		read_carry: () => run_carry.read_carry(context.carry_target),
		is_owner_live: (read) => read.kind === 'carried' && run_carry.is_owner_live(read.carry),
		wake: (invocation) => wake_session(context, invocation),
		sleep: async (milliseconds) => {
			await new Promise((resolve) => setTimeout(resolve, milliseconds))
		},
		now: () => new Date(),
	}
}

async function warn_of_failure(stop: LoopStop): Promise<void> {
	await telegram_notify.send_or_report(
		{
			task_type: 'warning',
			repo_name: gh_spawn.get_repo_name_with_owner_within(REPO_LOOKUP_TIMEOUT_MS),
			issue_title: WARNING_TITLE,
			body: [WARNING_BODY, stop.note].filter(Boolean).join('\n'),
			issue_url: undefined,
			pr_url: undefined,
		},
		WARNING_RECOVERY,
	)
}

// A failure that reached nobody is the defect, so the Telegram goes out before the verdict is printed
// and the command exits non-zero behind it.
async function finish(stop: LoopStop): Promise<number> {
	if (stop.reason !== run_wake_loop.FAILED_REASON) return report(stop.reason)

	console.error(stop.note ?? WARNING_BODY)
	await warn_of_failure(stop)

	return report(stop.reason, FAILURE_EXIT_CODE)
}

function spawn_supervisor(context: WakeContext, interval: string | undefined): number {
	const argv = run_wake_session.supervisor_argv(SCRIPT_PATH, interval)
	const result = run_wake_session.launch({ argv, cwd: context.worktree }, note_to_stderr)

	if (result.kind === 'failed') {
		console.error(`Could not start the supervisor: ${result.note}`)

		return report(FAILED_VERDICT, FAILURE_EXIT_CODE)
	}

	console.error(
		`Supervisor started as process ${String(result.pid)}. Stop it with \`${STOP_COMMAND}\`.`,
	)

	return report(STARTED_VERDICT)
}

function start(context: WakeContext, interval: string | undefined): number {
	const read = run_carry.read_carry(context.carry_target)

	if (read.kind !== 'carried') return refuse_without_carry(read.kind)

	const existing = run_wake.read_wake(context.wake_target)

	if (existing !== undefined && run_wake.is_supervisor_live(existing)) {
		console.error(describe_wake(existing, context))

		return report(RUNNING_VERDICT)
	}

	return spawn_supervisor(context, interval)
}

// **The loop removes its record on the way out, and only its own** (joshuafolkken/kit#1727). A loop
// that ended after its record was taken over used to delete the *successor's* record here, and the
// run then went on with nobody watching it.
//
// **The skip is announced, because the two ways of ending look identical otherwise.** A `--stop` and
// a take-over both leave this loop reporting `stopped` at exit 0, so a supervisor that was superseded
// would leave no trace of that anywhere. The note is written only where a record is still there and
// is somebody else's — after an ordinary `--stop` there is no record at all, and nothing to say.
function tidy_up(target: string): void {
	if (run_wake.remove_own_wake(target)) return
	if (run_wake.read_wake(target) === undefined) return

	note_to_stderr(SUPERSEDED_NOTE)
}

async function loop(context: WakeContext, interval_ms: number): Promise<number> {
	const read = run_carry.read_carry(context.carry_target)

	if (read.kind !== 'carried') return refuse_without_carry(read.kind)

	const claimed = run_wake.claim(context.wake_target, read.carry.invocation, new Date())

	if (claimed === undefined) return report(RUNNING_VERDICT)

	const stop = await run_wake_loop.run_loop(context.wake_target, ports_for(context), interval_ms)

	tidy_up(context.wake_target)

	return await finish(stop)
}

// **The verdict tracks whether the supervisor is actually running, not merely whether a record is
// there.** A crash or a reboot leaves the record behind, and a caller branching on the one stdout token
// — which is the documented way to use this — would read `supervising` for a supervisor that is gone.
function list(context: WakeContext): number {
	const wake = run_wake.read_wake(context.wake_target)

	if (wake === undefined) return report(NONE_VERDICT)

	console.error(describe_wake(wake, context))

	return report(run_wake.is_supervisor_live(wake) ? SUPERVISING_VERDICT : STALE_VERDICT)
}

// **Removing the record is the stop; the signal only shortens the wait.** A pid already gone, or one
// this process may not signal, is not an error — the loop ends at its next pass either way, because it
// re-reads the record it no longer finds and `run_wake.update_wake` refuses to write one back.
function signal_supervisor(wake: RunWake): void {
	if (!run_wake.is_supervisor_live(wake)) return

	try {
		process.kill(wake.pid, 'SIGTERM')
	} catch {
		console.error(
			`Process ${String(wake.pid)} could not be signalled; the record is removed regardless.`,
		)
	}
}

function stop_supervisor(context: WakeContext): number {
	const wake = run_wake.read_wake(context.wake_target)

	if (wake === undefined) return report(NONE_VERDICT)

	run_wake.remove_wake(context.wake_target)
	signal_supervisor(wake)

	return report(STOPPED_VERDICT)
}

async function dispatch(
	values: ParsedValues,
	context: WakeContext,
	interval_ms: number,
): Promise<number> {
	if (values.loop === true) return await loop(context, interval_ms)
	if (values.start === true) return start(context, text_of(values.interval))
	if (values.stop === true) return stop_supervisor(context)

	return list(context)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const values = read_arguments(argv)

	if (values === undefined || group_count(values) !== ONE_GROUP) return usage()

	const interval_ms = to_interval_ms(values.interval)

	if (interval_ms === undefined) return usage()

	const context = await resolve_context()

	if (context === undefined) return report(UNKNOWN_VERDICT, FAILURE_EXIT_CODE)

	return await dispatch(values, context, interval_ms)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_wake_cli = {
	FAILED_VERDICT,
	NONE_VERDICT,
	RUNNING_VERDICT,
	STALE_VERDICT,
	STARTED_VERDICT,
	STOPPED_VERDICT,
	SUPERVISING_VERDICT,
	UNKNOWN_VERDICT,
	USAGE,
	run,
}

if (process.argv[1] === SCRIPT_PATH) await main(process.argv.slice(ARGV_OFFSET))

export { run_wake_cli }
