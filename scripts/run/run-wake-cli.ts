#!/usr/bin/env tsx
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import { telegram_notify } from '#scripts/git/telegram-notify'
import { run_carry, type CarryRead } from './run-carry'
import { run_event_stream } from './run-event-stream'
import { run_headless } from './run-headless'
import { run_wake, type RunWake, type WakeStopReason, type WakeTidyResult } from './run-wake'
import { run_wake_describe, type WakeContext } from './run-wake-describe'
import { run_wake_handoff } from './run-wake-handoff'
import { run_wake_loop, type LoopPorts, type LoopStop } from './run-wake-loop'
import { run_wake_session, type LaunchResult } from './run-wake-session'
import { run_wake_work } from './run-wake-work'

// `josh run:wake --start | --list | --stop | --loop` — the supervisor that continues a cut
// `backlogrun` or `queue` without a person retyping the keyword (joshuafolkken/kit#1719,
// joshuafolkken/kit#1774). **Which invocations it may continue is `run-invocation.ts`'s answer**, not
// this file's: nothing here reads the recorded text, it is handed to `wake_argv` and either rebuilt
// from that module's own constants or refused.
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
// Whole and positive. A zero interval is a busy loop against the temp directory, not a faster
// supervisor.
const INTERVAL_PATTERN = /^[1-9]\d*$/u
// **Bounded above as well as below, and for the same reason.** `setTimeout` clamps any delay past
// 2^31−1 ms to *one millisecond*, so a number large enough to look like "poll rarely" produces exactly
// the busy loop the lower bound exists to prevent. An hour is far past any useful polling interval and
// nowhere near the clamp.
const MAX_INTERVAL_SECONDS = 3600
const SCRIPT_PATH = fileURLToPath(import.meta.url)

const STARTED_VERDICT = 'started'
const RUNNING_VERDICT = 'running'
const STOPPED_VERDICT = 'stopped'
const SUPERVISING_VERDICT = 'supervising'
const STALE_VERDICT = 'stale'
const NONE_VERDICT = 'none'
const UNKNOWN_VERDICT = 'unknown'
const FAILED_VERDICT = 'failed'

// **The note covers both ways `wake_argv` answers `undefined`**, because it cannot tell them apart and
// a message that named only the first would accuse a legitimate invocation of carrying unsafe text
// (joshuafolkken/kit#1774). The second is the one a person actually meets: a `queue` whose references
// carry a `owner/repo#` prefix is a grammar this supervisor does not rebuild, and `queue.md` → "The
// session boundary" is why such a queue begins no record in the first place.
const UNSAFE_INVOCATION_NOTE =
	'the carried invocation is not one this supervisor can continue — it is neither a backlogrun nor a queue it can rebuild, or it carries text that may not be passed to a command line'
// The command rather than one entry point: since joshuafolkken/kit#1774 the supervisor continues a
// `queue` as readily as a `backlogrun`, and a warning that named the wrong one would send the reader
// looking at a run that is not the one that stopped.
const WARNING_TITLE = 'run:wake supervisor'
const WARNING_RECOVERY = `Check the wake command, then restart with \`pnpm josh run:wake --start\`.`
// **The stop reasons that reach a person, and what each one tells them** (joshuafolkken/kit#1746). A
// reason absent from this map is one where nothing went wrong: `ended` is the run finishing through
// `run:carry --end`, `stopped` is a person's own `--stop` or a supervisor being superseded, and a
// warning channel that fired on those is one that stops being read.
//
// **`expired` and `unreadable` were silent until joshuafolkken/kit#1746, and that was the defect
// rather than the design.** Both end the supervisor while a carry record is still sitting there handed
// off, so the run is left asleep with nothing anywhere saying so — `run-wake.ts` →
// `is_predecessor_exiting` names the `expired` one as a silent overnight failure in as many words, and
// then only the `failed` reason was wired to the notification.
// **Every reason is listed, and the silent two are listed as `undefined`.** A partial map would let a
// sixth stop reason compile straight past this and reach nobody, which is the defect class this
// section exists to close.
const STOP_BODIES: Record<WakeStopReason, string | undefined> = {
	ended: undefined,
	stopped: undefined,
	failed: 'The supervisor could not continue the run and has stopped.',
	expired:
		'The carried run passed its whole-run bound, so the supervisor stopped without continuing it.',
	unreadable:
		'The carry record could not be read, so the supervisor stopped rather than guess at it.',
}
const SUPERSEDED_RESULT: WakeTidyResult = 'superseded'
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

	const log_target = run_wake.wake_log_path(directory)

	// Every verb reaches this one function, so creating the log here is what makes the path each of
	// them prints a path that exists — including `--list` and the already-running branch of `--start`,
	// neither of which launches anything (joshuafolkken/kit#1759).
	run_wake_session.ensure_log(log_target, note_to_stderr)

	return {
		carry_target: run_carry.carry_path(directory),
		wake_target: run_wake.wake_path(directory),
		log_target,
		event_target: run_event_stream.target_of(directory),
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

function wake_session(
	context: WakeContext,
	invocation: string,
	profile: AgentProfile,
	session_id: string,
): LaunchResult {
	const built = run_wake_session.wake_argv(invocation, profile, context.worktree, session_id)

	if (built === undefined) return { kind: 'failed', note: UNSAFE_INVOCATION_NOTE }
	if (built.kind === 'rejected') return { kind: 'failed', note: built.note }

	// The headless mark is what lets the stop hook hold this session's turn open while its lanes run —
	// under `claude -p` a turn-end is the process's end (`run-headless.ts`, joshuafolkken/kit#2437).
	const environment = run_headless.environment()
	const target = { cwd: context.worktree, env: environment, log_path: context.log_target }

	return run_wake_session.launch({ argv: built.argv, ...target, profile }, note_to_stderr)
}

function ports_for(context: WakeContext, profile: AgentProfile): LoopPorts {
	return {
		read_carry: () => run_carry.read_carry(context.carry_target),
		is_owner_live: (read) => read.kind === 'carried' && run_carry.is_owner_live(read.carry),
		has_work: async (read) => await run_wake_work.has_work(read),
		new_session_id: () => randomUUID(),
		hand_off: () => {
			run_wake_handoff.hand_off(context.carry_target)
		},
		wake: (invocation, session_id) => wake_session(context, invocation, profile, session_id),
		sleep: async (milliseconds) => {
			await new Promise((resolve) => setTimeout(resolve, milliseconds))
		},
		now: () => new Date(),
	}
}

// The log is named in the warning rather than only in `--list`, because the person reading a warning
// at three in the morning is the one who needs to know where to look next.
function log_hint(context: WakeContext): string {
	return `The output of every session this supervisor started is in ${context.log_target}.`
}

async function warn_of_stop(stop: LoopStop, body: string, context: WakeContext): Promise<void> {
	await telegram_notify.warn({
		issue_title: WARNING_TITLE,
		body: [body, stop.note, log_hint(context)].filter(Boolean).join('\n'),
		recovery: WARNING_RECOVERY,
	})
}

// **Only a failed wake exits non-zero, and the two reasons that newly warn do not**
// (joshuafolkken/kit#1746). The verdict-and-exit-code table in `docs/josh-commands.md` is a contract
// callers branch on; what `expired` and `unreadable` were missing is the notification, not a different
// exit code, and changing both at once would break a caller to fix a silence.
function exit_code_of(reason: WakeStopReason): number {
	return reason === run_wake_loop.FAILED_REASON ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

// A failure that reached nobody is the defect, so the Telegram goes out before the verdict is printed.
// Which stops reach a person, and what each one says — `undefined` for the two where nothing went
// wrong. It is a function rather than a bare lookup so the decision can be asserted for every reason
// the loop can end on, which is the contract joshuafolkken/kit#1746 changed.
function stop_body(reason: WakeStopReason): string | undefined {
	return STOP_BODIES[reason]
}

async function finish(stop: LoopStop, context: WakeContext): Promise<number> {
	const body = stop_body(stop.reason)

	if (body === undefined) return report(stop.reason)

	console.error(stop.note ?? body)
	await warn_of_stop(stop, body, context)

	return report(stop.reason, exit_code_of(stop.reason))
}

function spawn_supervisor(context: WakeContext, interval: string | undefined): number {
	const profile = run_wake_session.scheduler_profile()
	if (profile === undefined) return report(FAILED_VERDICT, FAILURE_EXIT_CODE)
	const argv = run_wake_session.supervisor_argv(SCRIPT_PATH, interval)
	// **The supervisor's own output goes to the same file as the sessions it starts.** It is detached
	// with the same call, so before joshuafolkken/kit#1746 its `console.error` — the launch note that
	// says the agent CLI is not on `PATH`, and the stop note behind every warning — went nowhere at all.
	const result = run_wake_session.launch(
		{
			argv,
			cwd: context.worktree,
			log_path: context.log_target,
			env: run_wake_session.supervisor_environment(profile),
		},
		note_to_stderr,
	)

	if (result.kind === 'failed') {
		console.error(`Could not start the supervisor: ${result.note}`)

		return report(FAILED_VERDICT, FAILURE_EXIT_CODE)
	}

	console.error(
		`Supervisor started as process ${String(result.pid)}. Stop it with \`${run_wake_describe.STOP_COMMAND}\`.`,
	)

	return report(STARTED_VERDICT)
}

function start(context: WakeContext, interval: string | undefined): number {
	const read = run_carry.read_carry(context.carry_target)

	if (read.kind !== 'carried') return refuse_without_carry(read.kind)

	const existing = run_wake.read_wake(context.wake_target)

	if (existing !== undefined && run_wake.is_supervisor_live(existing)) {
		console.error(run_wake_describe.describe_wake(existing, context))

		return report(RUNNING_VERDICT)
	}

	return spawn_supervisor(context, interval)
}

// **The loop removes its record on the way out, and only its own** (joshuafolkken/kit#1727). A loop
// that ended after its record was taken over used to delete the *successor's* record here, and the
// run then went on with nobody watching it.
//
// **`superseded` is announced, because the two ways of ending look identical otherwise.** A `--stop`
// and a take-over both leave this loop reporting `stopped` at exit 0, so a supervisor that was
// replaced would leave no trace of that anywhere. Which of the two happened is `tidy_own_wake`'s
// answer rather than a second read taken here — the branch that decides it belongs beside the record,
// where it is tested, not in a CLI that would have to re-derive it.
function tidy_up(target: string): void {
	if (run_wake.tidy_own_wake(target) === SUPERSEDED_RESULT) note_to_stderr(SUPERSEDED_NOTE)
}

async function loop(context: WakeContext, interval_ms: number): Promise<number> {
	const read = run_carry.read_carry(context.carry_target)

	if (read.kind !== 'carried') return refuse_without_carry(read.kind)

	const profile = run_wake_session.scheduler_profile()
	if (profile === undefined) return report(FAILED_VERDICT, FAILURE_EXIT_CODE)

	const claimed = run_wake.claim(context.wake_target, read.carry.invocation, new Date(), profile)

	if (claimed === undefined) return report(RUNNING_VERDICT)

	const stop = await run_wake_loop.run_loop(
		context.wake_target,
		ports_for(context, claimed.profile ?? profile),
		interval_ms,
	)

	tidy_up(context.wake_target)

	return await finish(stop, context)
}

// **The verdict tracks whether the supervisor is actually running, not merely whether a record is
// there.** A crash or a reboot leaves the record behind, and a caller branching on the one stdout token
// — which is the documented way to use this — would read `supervising` for a supervisor that is gone.
function list(context: WakeContext): number {
	const wake = run_wake.read_wake(context.wake_target)

	if (wake === undefined) return report(NONE_VERDICT)

	console.error(run_wake_describe.describe_wake(wake, context))

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
	stop_body,
}

if (process.argv[1] === SCRIPT_PATH) await main(process.argv.slice(ARGV_OFFSET))

export { run_wake_cli }
