import { hook_decision, type GuardRun } from '#scripts/josh/hook-decision'
import { run_progress } from '#scripts/run/run-progress'
import { run_progress_clock } from '#scripts/run/run-progress-clock'
import { run_progress_config } from '#scripts/run/run-progress-config'
import type { GuardedCall } from '#scripts/time/time-batch-guard'
import { time_shell } from '#scripts/time/time-shell'
import { shell_segments } from './shell-segments'

// The trigger and the decision behind the `early-heartbeat` row of `delivered-rules.ts`
// (joshuafolkken/kit#1570).
//
// **The promise was kept and the interval was not.** `josh run:progress --mark` was called at every
// real report exactly as `epicrun.md` requires, and reports still arrived 3–5 minutes apart on a
// 15-minute setting. The clock was never the problem: the parent armed a wait timer of its own on the
// turn a timer fired **and** on the turn a delegated child's completion woke it, so two timers ran at
// once and each produced a report the other knew nothing about. Nothing read the marked clock before
// writing — `run:progress` refuses its own early lines, and there was no such refusal in front of the
// parent's own prose.
//
// **So the refusal is put in front of the arm, not in front of the report.** A report is written in
// prose and no hook can see it coming; the `Bash` call that sleeps is a call, and a call can be
// refused — the same reading joshuafolkken/kit#1556 took for a verification behind a pipe.
//
// **An explicit ask is not a heartbeat, and it is exempt by construction rather than by exception.**
// What is refused here is arming a *timer*; a person asking "how is it going" arrives as a turn with
// no timer in front of it, and `pnpm josh run:progress --once` prints one line whatever the clock says
// (`run-progress-cli.ts` → `once`). There is no rule to write for it, and so no rule to get wrong.

const ARM_PREFIX = 'josh-heartbeat-arm-'

// A shell line carries several commands, and each is judged on its own — the same separators
// `delivered-rules.ts` cuts an Issue read on, plus the two spellings an arm actually reaches for:
// `sleep 1200 || true`, and `sleep 1200 &` sent to the background. `&&` is listed before `&` so the pair is
// never cut in half. A bare `|` is deliberately absent: a sleep is never piped into anything.
const SEGMENT_SEPARATOR = /&&|\|\||;|&|\n/u
// `sleep 600`, `sleep 10m`, `sleep 1.5`. The whole segment has to be the sleep: a `sleep` carrying
// arguments this does not model is not something to guess the duration of.
// cspell:ignore smhd
const SLEEP_SEGMENT = /^sleep\s+(\d+(?:\.\d+)?)([smhd]?)$/u
// What may stand beside the sleep without making the call something other than a wait — the marker a
// waking turn prints for itself. Anything that does work is not a wait timer.
const INERT_SEGMENT = /^(?::|true|(?:echo|printf|date)\b.*)$/u
// **A loop is not an arm.** `until <condition>; do sleep 30; done` ends on the condition and reports
// the condition; refusing it would take polling away from a run that is waiting on a thing rather
// than on a clock, which is the opposite of what this rule is for.
const LOOP_KEYWORD = /\b(?:while|until|for|do|done)\b/u

// GNU `sleep` takes a suffix and BSD `sleep` does not, so both spellings are read. A bare number is
// seconds, which is the one every shell agrees on.
const SECONDS_PER_UNIT: Readonly<Record<string, number>> = { d: 86_400, h: 3600, m: 60, s: 1 }
const BARE_NUMBER_SECONDS = 1

const AMOUNT_GROUP = 1
const UNIT_GROUP = 2

const NO_SECONDS = 0

// **The record holds the instant the armed timer expires**, and it is read through the shared refusal
// stamp because that shell already answers `NEVER_MS` for a record that is absent, unreadable or
// someone else's — which is exactly "no timer is live". Its field is named `refused_at_ms` for the
// refusals it was written for; a second implementation of the same read-parse-fallback path would be
// the clone `CLAUDE.md` prohibits, and this record is a temporary file nobody else reads.
const ARM_RECORD = hook_decision.create_refusal_stamp(ARM_PREFIX)

function segments_of(command: string): Array<string> {
	return command
		.split(SEGMENT_SEPARATOR)
		.map((segment) => segment.trim())
		.filter((segment) => segment !== '')
}

function sleep_seconds(segment: string): number | undefined {
	const matched = SLEEP_SEGMENT.exec(segment)

	if (matched === null) return undefined

	const unit = matched[UNIT_GROUP] ?? ''

	return Number(matched[AMOUNT_GROUP]) * (SECONDS_PER_UNIT[unit] ?? BARE_NUMBER_SECONDS)
}

function is_wait_or_inert(segment: string): boolean {
	return sleep_seconds(segment) !== undefined || INERT_SEGMENT.test(segment)
}

/**
 * Whether this call's whole purpose is to wait.
 *
 * **The shape is the discriminator, because the intent is not visible.** A call that sleeps and then
 * does work is waiting *for* that work; a call that only sleeps is arming a timer, and the turn it
 * wakes is the one that writes the report. Judged from the call alone, so nothing is read before the
 * cheap answer is available.
 */
function is_wait_timer(command: string): boolean {
	if (LOOP_KEYWORD.test(command)) return false

	const segments = segments_of(command)

	if (segments.every((segment) => sleep_seconds(segment) === undefined)) return false

	return segments.every((segment) => is_wait_or_inert(segment))
}

/** How long the armed timer runs — the sum, because `sleep 60 && sleep 60` waits for two minutes. */
function wait_duration_ms(command: string): number {
	const seconds = segments_of(command).reduce(
		(total, segment) => total + (sleep_seconds(segment) ?? NO_SECONDS),
		NO_SECONDS,
	)

	return seconds * run_progress.MS_PER_SECOND
}

function is_armed(target: string, now_ms: number): boolean {
	return now_ms < ARM_RECORD.last_ms(target)
}

/**
 * Where the report this timer produces would land, or `undefined` when the arm must be refused.
 *
 * **A timer longer than the interval is refused rather than trimmed.** The watcher reports on its own
 * every interval, so nothing legitimate waits longer than one — and the alternative, recording a
 * shorter expiry than the timer really has, would let a second timer be armed while the first was
 * still running, which is the defect this rule exists to prevent. Refusing instead keeps every record
 * exact **and** bounds a record that turns out to be wrong to one interval, since no arm can reach
 * further than that.
 *
 * **The rest is applied to where the report lands, not to where the arm is made.** A timer armed the
 * moment a real report went out is legitimate exactly when it runs the full interval, and a rule that
 * measured the arm would refuse the one arm that is always right.
 */
function landing_ms(command: string, now_ms: number, last_report_ms: number): number | undefined {
	const interval_ms = run_progress_config.configured_interval_ms()
	const duration_ms = wait_duration_ms(command)

	if (duration_ms > interval_ms) return undefined

	const lands_ms = now_ms + duration_ms

	return run_progress.is_due(last_report_ms, lands_ms, interval_ms) ? lands_ms : undefined
}

/**
 * The two conditions the Issue names, and one that scopes the rule to the runs it was written for.
 *
 * **No progress record means no clock, and no clock means no rule.** An ordinary conversational
 * session never starts the watcher and never marks, so it reads `undefined` here and nothing is
 * refused — the scope joshuafolkken/kit#1570 set out of bounds, held by the absence of a record rather
 * than by a second judgement about what kind of session this is.
 *
 * **A live timer is counted from the record this function writes, never from the processes on the
 * machine.** A process count cannot tell a heartbeat timer from a build step that sleeps, and a timer
 * killed with its shell would leave the count wrong for the rest of the run; a record that expires at
 * the instant the timer fires cannot.
 *
 * **`can_record` is false where the call may never run.** The record is written at `PreToolUse`,
 * before the sleep starts, and nothing runs it back — so a call another hook is about to refuse would
 * leave a timer recorded as live that never existed, and lock out the legitimate arm that follows.
 * The caller answers that question, because it is the one that knows what the other hooks are doing.
 * **Refusing is unaffected**: a rule that also stayed silent there would be silent on exactly the lone
 * `Bash` call an arm always is. What it costs is the other direction — an arm that *was* allowed and
 * did run inside that window is not recorded, so a second one before it fires is not caught. That is
 * the lesser of the two, because a missing record loses one detection while a wrong one blocks every
 * arm until it expires.
 */
function decide(call: GuardedCall, run: GuardRun, can_record: boolean): boolean {
	const last_report_ms = run_progress_clock.read_last_report_sync()

	if (last_report_ms === undefined) return false

	const target = ARM_RECORD.path(run.transcript)

	if (is_armed(target, run.now_ms)) return true

	const lands_ms = landing_ms(time_shell.bash_command(call.input), run.now_ms, last_report_ms)

	if (lands_ms === undefined) return true
	if (can_record) ARM_RECORD.record(target, lands_ms)

	return false
}

// The instruction in the shape a refusal can carry: what the call is about to do, what already does it
// properly, and the one command an explicit ask is answered with. The measurement is named because it
// is the half that makes the rule believable — the promise was kept and the interval was not.
const EARLY_HEARTBEAT_REASON =
	'⛔ early heartbeat: this call arms a wait timer of its own, and the progress clock is not yours ' +
	'to keep. `pnpm josh run:progress --wait` waits the interval out for you ' +
	'(`JOSH_PROGRESS_INTERVAL_MINUTES`, or `josh.progress_interval_minutes` in `package.json`, ' +
	'default 20 minutes), prints one line and exits — start it in the background, relay the line it ' +
	'printed when it exits, and start the next one. Two timers armed at ' +
	'once is what produced reports 3–5 minutes apart on a 15-minute setting ' +
	'(joshuafolkken/kit#1570): a new one was armed on the turn a timer fired and again on the turn a ' +
	"child's completion woke the run, and `--mark` recorded each report without anything refusing the " +
	'early ones. **An explicit ask is not a heartbeat**: if the person asked for progress now, run ' +
	'`pnpm josh run:progress --once`, which prints one line whatever the clock says. If you are ' +
	'waiting on something rather than on a clock, wait on the thing itself — `pnpm josh followup` ' +
	'waits for CI. The procedure is `.claude/skills/workflow-commands/epicrun.md` → "Progress while ' +
	'the run is quiet". **This rule fires on every early arm, not once per run**, so reissuing the ' +
	'same sleep will be refused again.'

// **Keeping this rule is letting the watcher hold the clock** — `pnpm josh run:progress --wait` waits
// the interval out, and `--once` answers an explicit ask. `--mark` is neither: it records a report
// that has already gone out rather than waiting for the next one, and crediting it would score every
// run that reported at all as having kept a rule about waiting.
// Both spellings, derived from the alias table by the same helper `piped-verification.ts` uses.
const PROGRESS_NAMES: ReadonlySet<string> = shell_segments.josh_names(['run:progress'])
const WATCH_FLAG = /(?:^|\s)--(?:wait|once)(?=\s|$)/u

function is_progress_watch_segment(segment: string): boolean {
	return shell_segments.is_josh_command(segment, PROGRESS_NAMES) && WATCH_FLAG.test(segment)
}

// The quoted spans are blanked first: this separator set cuts on `\n`, so a notify body carrying the
// watcher's own command on a line of its own would otherwise be credited as the watcher running.
function is_progress_watch(command: string): boolean {
	return segments_of(time_shell.unquoted(command)).some((segment) =>
		is_progress_watch_segment(segment),
	)
}

// **The occasion this rule governs: waiting for the run's next progress report**, in either spelling
// (joshuafolkken/kit#1643). The trigger fires only on the hand-armed timer, so a run that always let
// the watcher wait would never appear in the reading at all.
function waits_for_progress(command: string): boolean {
	return is_wait_timer(command) || is_progress_watch(command)
}

const early_heartbeat = {
	ARM_PREFIX,
	EARLY_HEARTBEAT_REASON,
	decide,
	is_progress_watch,
	is_wait_timer,
	wait_duration_ms,
	waits_for_progress,
}

export { early_heartbeat }
