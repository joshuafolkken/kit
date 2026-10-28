import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stranded_detect, type WatchedRun } from '#scripts/run/run-stranded-detect'
import type { WakeStopReason } from './run-wake'
import type { WakeContext } from './run-wake-describe'
import { run_wake_loop, type LoopStop } from './run-wake-loop'

// How a `run:wake --loop` supervisor ends: which stops reach a person, what the warning says, the
// `stranded` event it leaves, and the verdict and exit code it ends on. The CLI that runs the loop is
// `run-wake-cli.ts`.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

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

// Which stops reach a person, and what each one says — `undefined` for the two where nothing went
// wrong. It is a function rather than a bare lookup so the decision can be asserted for every reason
// the loop can end on.
function stop_body(reason: WakeStopReason): string | undefined {
	return STOP_BODIES[reason]
}

// `started_at` is the run this supervisor took on — what `record_failure` tells an ended run by once
// the carry record that held it no longer reads.
async function warn_and_record(
	stop: LoopStop,
	body: string,
	context: WakeContext,
	started_at: string,
): Promise<void> {
	console.error(stop.note ?? body)
	const is_warned = await warn_of_stop(stop, body, context)

	await record_failure(stop, { ...context, started_at }, is_warned)
}

// A failure that reached nobody is the defect, so the Telegram goes out before the verdict is printed.
async function finish(stop: LoopStop, context: WakeContext, started_at: string): Promise<number> {
	const body = stop_body(stop.reason)

	if (body !== undefined) await warn_and_record(stop, body, context, started_at)

	console.info(stop.reason)

	return exit_code_of(stop.reason)
}

const run_wake_finish = {
	finish,
	record_failure,
	stop_body,
	warning_body,
}

export { run_wake_finish }
