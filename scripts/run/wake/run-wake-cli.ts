import { fileURLToPath } from 'node:url'
import type { AgentProfile, AgentProvider } from '#scripts/agent/agent-role-profile'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { cli_flags } from '#scripts/lib/cli-flags'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stranded_detect, type WatchedRun } from '#scripts/run/run-stranded-detect'
import { run_wake, type WakeStopReason, type WakeTidyResult } from './run-wake'
import { run_wake_await } from './run-wake-await'
import { run_wake_code } from './run-wake-code'
import { run_wake_describe, type WakeContext } from './run-wake-describe'
import { run_wake_loop, type LoopStop } from './run-wake-loop'
import { run_wake_ports } from './run-wake-ports'
import { run_wake_session, type LaunchResult } from './run-wake-session'
import { run_wake_stop } from './run-wake-stop'
import { run_wake_supervise } from './run-wake-supervise'
import { run_wake_takeover, type TakeoverResult } from './run-wake-takeover'

// `josh run:wake --start | --list | --stop | --loop` — the supervisor that continues a cut
// `backlogrun` or `queue` without a person retyping the keyword. **Which invocations it may continue
// is `run-invocation.ts`'s answer**, not this file's: nothing here reads the recorded text, it is
// handed to `wake_argv` and either rebuilt from that module's own constants or refused.
//
// The stdout/stderr split is the contract every `run:*` command shares: exactly one verdict token on
// stdout on every path, the reason and the advice on stderr, so a loop branches on one token.
//
// **`--start` and `--loop` are two halves of one thing.** `--start` spawns the command's entry detached
// with `--loop` and returns immediately, which is what leaves the supervisor outside the conversation;
// `--loop` is the body, and running it in the foreground is how a person watches what it does.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ONE_GROUP = 1
// The interval is whole and positive (`cli_flags.to_positive`): a zero interval is a busy loop against
// the temp directory, not a faster supervisor.
// **Bounded above as well as below, and for the same reason.** `setTimeout` clamps any delay past
// 2^31−1 ms to *one millisecond*, so a number large enough to look like "poll rarely" produces exactly
// the busy loop the lower bound exists to prevent. An hour is far past any useful polling interval and
// nowhere near the clamp.
const MAX_INTERVAL_SECONDS = 3600
// The command's entry, not this module: the guard that runs `main` lives in `run-wake-main.ts`.
const SCRIPT_PATH = fileURLToPath(new URL('run-wake-main.ts', import.meta.url))

const STARTED_VERDICT = 'started'
const RUNNING_VERDICT = 'running'
const STOPPED_VERDICT = 'stopped'
const SUPERVISING_VERDICT = 'supervising'
const STALE_VERDICT = 'stale'
const NONE_VERDICT = 'none'
const UNKNOWN_VERDICT = 'unknown'
const FAILED_VERDICT = 'failed'

// The command rather than one entry point: the supervisor continues a `queue` as readily as a
// `backlogrun`, and a warning that named the wrong one would send the reader looking at a run that is
// not the one that stopped.
const WARNING_TITLE = 'run:wake supervisor'
const WARNING_RECOVERY = `Check the wake command, then restart with \`pnpm josh run:wake --start\`.`
// **The stop reasons that reach a person, and what each one tells them.** A reason mapped to
// `undefined` is one where nothing went wrong: `ended` is the run finishing through `run:carry --end`,
// `stopped` is a person's own `--stop` or a supervisor being superseded, and a warning channel that
// fired on those is one that stops being read.
//
// **`unreadable` warns**, because it ends the supervisor while a carry record is still sitting there
// handed off, so the run would otherwise be left asleep with nothing anywhere saying so.
// **Every reason is listed, and the silent two are listed as `undefined`.** A partial map would let a
// fifth stop reason compile straight past this and reach nobody, which is the defect class this
// section exists to close.
const STOP_BODIES: Record<WakeStopReason, string | undefined> = {
	ended: undefined,
	stopped: undefined,
	reload: undefined,
	failed: 'The supervisor could not continue the run and has stopped.',
	unreadable:
		'The carry record could not be read, so the supervisor stopped rather than guess at it.',
}
const NO_PROFILE_NOTE = 'the scheduler profile could not be resolved'
const RELOAD_FAILED_NOTE =
	"The supervisor's code changed, but the supervisor to replace it did not start"
const TAKEOVER_NOTES: Record<Exclude<TakeoverResult, 'taken'>, string> = {
	died: 'it exited before it claimed the run',
	unclaimed: 'it did not claim the run in time, so it was stopped',
}
const SUPERSEDED_RESULT: WakeTidyResult = 'superseded'
const REMOVED_RESULT: WakeTidyResult = 'removed'
const STOPPED_STOP: LoopStop = { reason: 'stopped', note: undefined }
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

const { note_to_stderr } = run_wake_ports

function to_interval_ms(value: string | boolean | undefined): number | undefined {
	if (typeof value !== 'string') return backlog_budget.OFFER_INTERVAL_MS
	const seconds = cli_flags.to_positive(value)

	return seconds === undefined || seconds > MAX_INTERVAL_SECONDS
		? undefined
		: seconds * MS_PER_SECOND
}

// Exactly one verb, never a guessed order between two.
function group_count(values: ParsedValues): number {
	const verbs = [values.start, values.stop, values.list, values.loop]

	return verbs.filter((flag) => flag === true).length
}

function context_of(directory: string): WakeContext {
	return run_wake_describe.context_of(directory, note_to_stderr)
}

async function resolve_context(): Promise<WakeContext | undefined> {
	const directory = await run_carry.repository_directory()

	return directory === undefined ? undefined : context_of(directory)
}

// There is nothing to supervise unless a run is actually carrying a budget. Refusing here rather than
// starting a supervisor that would stop on its first pass is what keeps `--start` honest: a `started`
// that ends a second later is worse than a refusal that says why.
function refuse_without_carry(kind: CarryRead['kind']): number {
	console.error(`No carried run here to supervise — \`pnpm josh run:carry --json\` says ${kind}.`)

	return report(NONE_VERDICT, FAILURE_EXIT_CODE)
}

// The log is named in the warning rather than only in `--list`, because the person reading a warning
// at three in the morning is the one who needs to know where to look next.
function log_hint(context: WakeContext): string {
	return `The output of every session this supervisor started is in ${context.log_target}.`
}

// The log hint goes ahead of the note: the Telegram length limit cuts the tail, and a long failure note
// (stdout tail plus stderr tail) would otherwise take the one line that says where to look next.
function warning_body(stop: LoopStop, body: string, context: WakeContext): string {
	return [body, log_hint(context), stop.note].filter(Boolean).join('\n')
}

// Whether the warning reached a person — the answer `record_failure` leaves its marker on.
async function warn_of_stop(stop: LoopStop, body: string, context: WakeContext): Promise<boolean> {
	return await telegram_notify.warn({
		issue_title: WARNING_TITLE,
		body: warning_body(stop, body, context),
		recovery: WARNING_RECOVERY,
	})
}

// **A failed supervisor that leaves the run stranded says so on the stream, with its cause.** Nothing
// else writes there when the supervisor gives up, so a reader of the events would see the last merge
// and a run that looks as if it were still watching. The cause is the note's first line — the
// driver's own `error …` — because the rest is a stderr tail the log already holds.
//
// **Only a strand, and only one a person was told of.** A `failed` stop is not always a strand: a
// `run:carry --end` under a live driver fails it too, and that run ended cleanly. And the event is the
// marker `run_stranded_detect` holds its own notification back on, so it is left only when the warning
// was sent — after a failed send the stop-time detector still finds no marker, and notifies.
function is_strand_told(stop: LoopStop, watched: WatchedRun, is_warned: boolean): boolean {
	if (!is_warned || stop.reason !== run_wake_loop.FAILED_REASON) return false

	return run_stranded_detect.is_left_stranded(watched)
}

async function record_failure(
	stop: LoopStop,
	watched: WatchedRun,
	is_warned: boolean,
): Promise<void> {
	if (!is_strand_told(stop, watched, is_warned)) return

	const [cause = ''] = (stop.note ?? '').split('\n', 1)

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.STRANDED,
		`The supervisor failed and stopped watching the run — ${cause}`,
	)
}

// **Only a failed wake exits non-zero; `unreadable` warns but exits zero.** The
// verdict-and-exit-code table in `docs/josh-commands-run.md` → `run:wake` is a contract callers branch on,
// and what that one needs is the notification, not a different exit code.
function exit_code_of(reason: WakeStopReason): number {
	return reason === run_wake_loop.FAILED_REASON ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

// A failure that reached nobody is the defect, so the Telegram goes out before the verdict is printed.
// Which stops reach a person, and what each one says — `undefined` for the two where nothing went
// wrong. It is a function rather than a bare lookup so the decision can be asserted for every reason
// the loop can end on.
function stop_body(reason: WakeStopReason): string | undefined {
	return STOP_BODIES[reason]
}

// `started_at` is the run this supervisor took on — what `record_failure` tells an ended run by once
// the carry record that held it no longer reads.
async function finish(stop: LoopStop, context: WakeContext, started_at: string): Promise<number> {
	const body = stop_body(stop.reason)

	if (body === undefined) return report(stop.reason)

	console.error(stop.note ?? body)
	const is_warned = await warn_of_stop(stop, body, context)

	await record_failure(stop, { ...context, started_at }, is_warned)

	return report(stop.reason, exit_code_of(stop.reason))
}

function launch_supervisor(
	context: WakeContext,
	interval: string | undefined,
	profile: AgentProfile | undefined,
): LaunchResult {
	if (profile === undefined) return { kind: 'failed', note: NO_PROFILE_NOTE }
	const argv = run_wake_session.supervisor_argv(SCRIPT_PATH, interval)

	// **The supervisor's own output goes to the same file as the sessions it starts.** It is detached
	// with the same call, so otherwise its `console.error` — the launch note that says the agent CLI is
	// not on `PATH`, and the stop note behind every warning — would go nowhere at all.
	return run_wake_session.launch(
		{
			argv,
			cwd: context.worktree,
			log_path: context.log_target,
			env: run_wake_session.supervisor_environment(profile),
		},
		note_to_stderr,
	)
}

// The supervisor `josh backlogrun` starts beside its launched parent, on the parent's provider, from its
// own process so it inherits the credential the parent's Bash tool does not pass on (kit#3804). No carry
// record stands yet, so `start`'s check is skipped; its `--loop` waits for the parent to claim one.
function start_for_launch(git_directory: string, provider: AgentProvider): LaunchResult {
	const resolved = run_wake_session.chosen_profile(provider)
	if (resolved.kind === 'rejected') return { kind: 'failed', note: resolved.note }

	return launch_supervisor(context_of(git_directory), undefined, resolved.profile)
}

function spawn_supervisor(
	context: WakeContext,
	interval: string | undefined,
	profile: AgentProfile | undefined,
): number {
	const result = launch_supervisor(context, interval, profile)

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
		console.error(run_wake_describe.describe_wake_cited(existing, context))

		return report(RUNNING_VERDICT)
	}

	return spawn_supervisor(context, interval, run_wake_session.scheduler_profile())
}

// The supervisor `josh backlogrun --restart` starts in place of the one it stopped, on that one's
// profile, so the shell the restart was typed in does not choose it; the shell's where none was running.
function restart_supervisor(git_directory: string, profile: AgentProfile | undefined): number {
	const chosen = profile ?? run_wake_session.scheduler_profile()

	return spawn_supervisor(context_of(git_directory), undefined, chosen)
}

// **The loop removes its record on the way out, and only its own.** A loop that ended after its record
// was taken over must not delete the *successor's* record, or the run goes on with nobody watching it.
//
// **`superseded` is announced, because the two ways of ending look identical otherwise.** A `--stop`
// and a take-over both leave this loop reporting `stopped` at exit 0, so a supervisor that was
// replaced would leave no trace of that anywhere. Which of the two happened is `tidy_own_wake`'s
// answer rather than a second read taken here — the branch that decides it belongs beside the record,
// where it is tested, not in a CLI that would have to re-derive it.
function tidy_up(target: string): WakeTidyResult {
	const tidied = run_wake.tidy_own_wake(target)

	if (tidied === SUPERSEDED_RESULT) note_to_stderr(SUPERSEDED_NOTE)

	return tidied
}

// **No reload while a lane's request is being answered**: ending the broker closes every lane's server
// but waits out the slowest request, a review up to its limit, leaving the run unwatched and the other
// lanes unserved meanwhile. The check is skipped, not taken, so the moved commit is still read as
// stale at the first idle pass.
function code_check(is_stale: () => Promise<boolean>): () => Promise<boolean> {
	return async () => !lane_session_broker.is_answering() && (await is_stale())
}

function reload_failed(note: string): LoopStop {
	return { reason: run_wake_loop.FAILED_REASON, note: `${RELOAD_FAILED_NOTE}: ${note}` }
}

// A record removed by `--stop` or taken over while the loop ended is not this loop's to hand on.
function as_not_handed_on(stop: LoopStop): LoopStop {
	return stop.reason === run_wake_loop.RELOAD_REASON ? STOPPED_STOP : stop
}

// **The successor starts only once this supervisor's broker has closed and its record is gone**
// (joshuafolkken/kit#4509): two brokers for one lane overwrite each other's response
// (`claude-lane-broker.ts`), and a record still held by a live process refuses the successor's claim.
// The lanes and the carry record are left as `backlogrun --restart` leaves them: untouched, for the
// successor to adopt. A successor that did not start leaves the run unwatched, so it fails as a warning.
async function reload(
	context: WakeContext,
	interval_ms: number,
	profile: AgentProfile,
): Promise<LoopStop> {
	const interval = String(Math.round(interval_ms / MS_PER_SECOND))
	const result = launch_supervisor(context, interval, profile)

	if (result.kind === 'failed') return reload_failed(result.note)

	const ports = run_wake_takeover.ports_of(context.wake_target)
	const takeover = await run_wake_takeover.await_takeover(result.pid, ports)

	if (takeover !== 'taken') return reload_failed(TAKEOVER_NOTES[takeover])

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.NOTE,
		`The supervisor's code changed on main, so process ${String(process.pid)} handed the run to process ${String(result.pid)} on the new code.`,
	)

	return { reason: run_wake_loop.RELOAD_REASON, note: undefined }
}

async function supervised(
	context: WakeContext,
	interval_ms: number,
	profile: AgentProfile,
): Promise<LoopStop> {
	const source = run_wake_code.source_of(context.worktree, SCRIPT_PATH)
	const is_stale = code_check(await run_wake_code.watch(source, lane_session_broker.take_refusal))
	const ports = run_wake_ports.ports_for(context, profile, is_stale)
	const stop = await run_wake_supervise.supervise({
		context,
		ports,
		interval_ms,
		note: note_to_stderr,
	})

	if (tidy_up(context.wake_target) !== REMOVED_RESULT) return as_not_handed_on(stop)
	if (stop.reason !== run_wake_loop.RELOAD_REASON) return stop

	return await reload(context, interval_ms, profile)
}

// A failed pass is restarted while the carry record is still resumable (`run-wake-restart.ts`), so
// only a failure past the restart bound reaches `finish` and its warning; the Claude lanes are brokered
// for as long as it supervises (`run-wake-supervise.ts`).
// **The record is claimed once and held across every restart**, so a `--stop` landing in the pause
// between two passes still finds it, signals this process, and the next pass reads the removal as the
// person's stop rather than claiming a fresh record and resuming.
async function loop(context: WakeContext, interval_ms: number): Promise<number> {
	const profile = run_wake_session.scheduler_profile()
	if (profile === undefined) return report(FAILED_VERDICT, FAILURE_EXIT_CODE)

	const claimed = await run_wake_await.claim_run(context, profile, interval_ms)

	if (claimed.kind === 'running') return report(RUNNING_VERDICT)
	if (claimed.kind === 'refused') return refuse_without_carry(claimed.carry_kind)

	run_wake_session.keep_awake(process.pid)

	const stop = await supervised(context, interval_ms, claimed.wake.profile ?? profile)

	return await finish(stop, context, claimed.carry.started_at)
}

// **The verdict tracks whether the supervisor is actually running, not merely whether a record is
// there.** A crash or a reboot leaves the record behind, and a caller branching on the one stdout token
// — which is the documented way to use this — would read `supervising` for a supervisor that is gone.
function list(context: WakeContext): number {
	const wake = run_wake.read_wake(context.wake_target)

	if (wake === undefined) return report(NONE_VERDICT)

	console.error(run_wake_describe.describe_wake_cited(wake, context))

	return report(run_wake.is_supervisor_live(wake) ? SUPERVISING_VERDICT : STALE_VERDICT)
}

function stop_supervisor(context: WakeContext): number {
	const stopped = run_wake_stop.stop(context.wake_target)

	return report(stopped === undefined ? NONE_VERDICT : STOPPED_VERDICT)
}

async function dispatch(
	values: ParsedValues,
	context: WakeContext,
	interval_ms: number,
): Promise<number> {
	if (values.loop === true) return await loop(context, interval_ms)
	if (values.start === true) return start(context, cli_flags.string_of(values.interval))
	if (values.stop === true) return stop_supervisor(context)

	return list(context)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const values = cli_flags.values_of(argv, OPTIONS)

	if (values === undefined || group_count(values) !== ONE_GROUP) return usage()

	const interval_ms = to_interval_ms(values.interval)

	if (interval_ms === undefined) return usage()

	const context = await resolve_context()

	if (context === undefined) return report(UNKNOWN_VERDICT, FAILURE_EXIT_CODE)

	return await dispatch(values, context, interval_ms)
}

const run_wake_cli = {
	FAILED_VERDICT,
	NONE_VERDICT,
	RUNNING_VERDICT,
	SCRIPT_PATH,
	STALE_VERDICT,
	STOPPED_VERDICT,
	SUPERVISING_VERDICT,
	UNKNOWN_VERDICT,
	USAGE,
	finish,
	RELOAD_FAILED_NOTE,
	record_failure,
	reload,
	restart_supervisor,
	run,
	start_for_launch,
	stop_body,
	supervised,
	warning_body,
}

export { run_wake_cli }
