#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { agent_headless } from '#scripts/agent/agent-headless'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { repo_party } from '#scripts/discovery/repo-party'
import { stop_actions } from '#scripts/hooks/stop-actions'
import { hook_decision } from '#scripts/josh/hook-decision'
import { session_language } from '#scripts/josh/session-language'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { filing_cap } from '#scripts/rules/filing-cap'
import { lane_background } from '#scripts/rules/lane-background'
import { lane_park } from '#scripts/rules/lane-park'
import { last_prompt } from '#scripts/rules/last-prompt'
import { pre_gate_cut } from '#scripts/rules/pre-gate-cut'
import { stop_decision } from '#scripts/rules/stop-decision'
import { stop_rules, type StopContext, type StopOutcome } from '#scripts/rules/stop-rules'
import { tail_commands } from '#scripts/rules/tail-commands'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_report } from '#scripts/run/cut/run-cut-report'
import { run_hold, type RunHold } from '#scripts/run/hold/run-hold'
import { run_hold_session } from '#scripts/run/hold/run-hold-session'
import { run_halfrun_resume } from '#scripts/run/run-halfrun-resume'
import { run_headless } from '#scripts/run/run-headless'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_hook_transcript } from '#scripts/time-runtime/time-hook-transcript'

// The `Stop` hook entry: one process that delivers the stop-time rules, running the fixed ones itself
// (`stop-actions.ts`).
// It is the stop-time counterpart of `pretool-guard.ts` — a second entry on the same `hook_decision`
// foundation, not a second copy of it.
//
// **Every failure allows the stop.** A missing transcript, an unreadable hold record, a git status
// that will not read — each ends as "no block", for the same reason the PreToolUse guard fails open:
// a hook that failed closed would wedge a run over its own plumbing. The hook runs the fixed
// operations itself (send the notify, release the hold) and `stop_hook_active` is the backstop, so failing
// open here costs at most a missed nudge, never a stuck run.

// The hold record for this working tree. `unreadable` reads as absent: the safe direction for a stop
// guard is not to act, and an unreadable record is not proof a run is holding.
async function held_record(): Promise<RunHold | undefined> {
	const directory = await run_hold.worktree_directory()
	if (directory === undefined) return undefined

	return run_halfrun_resume.hold_of(run_hold.read_hold(run_hold.hold_path(directory)))
}

// The pause was announced: by a `josh notify` on the tail, or by this hook's own send, recorded on the
// hold since the pause began (joshuafolkken/kit#3961).
function was_notified(hold: RunHold | undefined, tail: string): boolean {
	if (lane_park.mentions_confirmation_notify(tail)) return true

	return (
		hold !== undefined && run_hold_session.is_notified_since(hold, last_prompt.pause_start(tail))
	)
}

// The Issue the hold names, whether it is a `prrun` stop's and this session's own, and whether its
// pause was already announced.
async function hold_facts(
	tail: string,
): Promise<Pick<StopContext, 'hold_issue' | 'hold_owned' | 'notified' | 'prrun_stopped'>> {
	const hold = await held_record()

	return {
		hold_issue: hold?.issue,
		hold_owned: hold === undefined || run_hold_session.is_session_hold(hold),
		notified: was_notified(hold, tail),
		prrun_stopped: hold?.prrun_stop_head !== undefined,
	}
}

// A `confirmation` notify sits on this run's transcript tail. The tail is derived exactly as the
// PreToolUse guards derive it, and the judgement is `lane-park`'s, reused rather than re-spelled.
function transcript_tail(transcript_path: string): string {
	const transcript = time_hook_transcript.transcript_of(transcript_path, undefined)

	return time_density_hook.read_tail(transcript)
}

// An Issue was filed on this turn — the tail from the last prompt on. The count is `filing_cap`'s, so a
// filing a guard refused is not counted, and one an earlier turn made does not stand this turn down.
function was_filed(tail: string): boolean {
	return filing_cap.turn_filing_count(tail) > 0
}

// This turn ended at a cut — a record still `carried`, or this turn's `run:cut` relaunching a successor.
// The second covers the successor's resume clearing the record before this stop (joshuafolkken/kit#3936);
// the held cut outside a lane prints no marker, so its person is still notified.
function is_cut_stop(tail: string): boolean {
	if (run_cut.carried_cut_sync() !== undefined) return true

	return tail_commands.answered(
		filing_cap.current_turn(tail),
		pre_gate_cut.takes_the_cut,
		run_cut_report.RELAUNCHED_CUT_MARKER,
	)
}

// The session language the refusal is written for — `write_stop_decision` has already loaded the `.env`.
function session_lang(): string {
	return session_language.resolve_session_lang().lang
}

// Which session this is — a headless parent, a lane child, a kit-launched agent, the `backlogrun`
// parent — the facts that say whether a person is there to answer.
async function session_role_facts(): Promise<
	Pick<StopContext, 'backlog_parent' | 'headless_agent' | 'headless_waiting' | 'lane_child'>
> {
	return {
		headless_waiting: await run_headless.must_keep_waiting(),
		lane_child: lane_child_marker.is_child_of(process.cwd()),
		headless_agent: agent_headless.is_headless(),
		backlog_parent: await run_headless.is_backlog_parent(),
	}
}

async function build_context(
	transcript_path: string,
	payload_tail: { stop_hook_active: boolean; message: string },
): Promise<StopContext> {
	const tail = transcript_tail(transcript_path)

	return {
		...(await hold_facts(tail)),
		tree_clean: !(await run_hold.is_tree_dirty()),
		message: payload_tail.message,
		prompt: last_prompt.prompt_text(tail),
		answers_question: stop_decision.is_question(last_prompt.turn_prompt(tail)),
		stop_hook_active: payload_tail.stop_hook_active,
		cut_pending: is_cut_stop(tail),
		filed: was_filed(tail),
		session_owner: repo_party.current_owner(),
		...(await session_role_facts()),
		headless_refusals: stop_rules.count_headless_refusals(tail),
		background_pending: lane_background.pending_background_ids(tail).length > 0,
		agent_pending: lane_background.pending_agent_ids(tail).length > 0,
		handed_off: lane_handoff.is_handed_off(process.cwd()),
		session_lang: session_lang(),
	}
}

async function stop_outcome_for_payload(raw_payload: string): Promise<StopOutcome> {
	const payload = stop_rules.parse_stop_payload(raw_payload)

	if (payload === undefined || !stop_rules.is_enabled()) return stop_rules.NO_OUTCOME

	const context = await build_context(payload.transcript_path, {
		stop_hook_active: payload.stop_hook_active ?? false,
		message: payload.last_assistant_message ?? '',
	})

	return stop_rules.stop_outcome(context)
}

async function outcome_of(raw_payload: string): Promise<StopOutcome> {
	try {
		return await stop_outcome_for_payload(raw_payload)
	} catch {
		return stop_rules.NO_OUTCOME
	}
}

// A live carry record is in place — `carried` alone reads as a run. Both report checks below are about
// a carried run: the strand judge reads this very record and returns on anything but `carried`, and a
// stall needs a backlog driver, which begins one before its plan. An `unreadable`
// record a crashed run left behind is no run either.
// The answer is whether that run's owner is still live, and `undefined` where there is no run at all.
// A failed git read — outside a repository, `git rev-parse` exits non-zero — reads as no run, since this
// gate sits ahead of the checks' own swallowing and must not throw into the stop decision either.
async function carried_owner_live(): Promise<boolean | undefined> {
	try {
		const directory = await run_carry.repository_directory()

		if (directory === undefined) return undefined

		const read = run_carry.read_carry(run_carry.carry_path(directory))

		return read.kind === 'carried' ? run_carry.is_owner_live(read.carry) : undefined
	} catch {
		return undefined
	}
}

// The stall check rides the Stop hook because the stop *is* the loop boundary: a run alive but not
// advancing ends turns without dispatching. The strand check rides the same
// boundary and is the step before the stall: it fires when the driver is gone
// — the budget handed off, the owner dead, no supervisor watching. Both only report and swallow their
// own failures, so neither can change the stop decision. An ordinary stop with no run record skips
// both, so it pays one directory read rather than their reads and a stale stream's backlog probe.
//
// **A stall is a live driver not dispatching, so a record whose owner is gone is not asked.** A record
// stands until a person carries or discards it, so a crashed run's would otherwise re-arm the stall's
// `git worktree list` and network backlog probe on every stop in the repository, for a run nobody
// drives. A gone driver is the strand check's question — handed off or not (`run-stranded.ts` →
// `had_driver`) — and that one reads local files only.
async function run_report_checks(): Promise<void> {
	const is_owner_live = await carried_owner_live()

	if (is_owner_live === undefined) return

	if (is_owner_live) await backlog_stalled_detect.run_stall_check(backlog_ready.DEFAULT_PORTS)

	await run_stranded_detect.run_stranded_check()
}

async function decided_envelope(raw_payload: string): Promise<string | undefined> {
	await run_report_checks()

	return await stop_actions.envelope_of(await outcome_of(raw_payload), session_lang())
}

// Nothing reaches stdout on an ordinary stop, so what the harness parses stays empty unless the stop is
// held or the hook acted on it (`stop-actions.ts`). The report checks print too — a strand's skipped
// notify line — and text ahead of the envelope makes the harness drop the refusal, as the #4091 child's
// lane-background block was (joshuafolkken/kit#4101), so everything before the write goes to stderr.
async function write_stop_decision(raw_payload: string): Promise<void> {
	hook_decision.load_environment_file()

	const envelope = await stop_actions.on_stderr(async () => await decided_envelope(raw_payload))

	if (envelope === undefined) return

	process.stdout.write(`${envelope}\n`)
}

const stop_guard = { outcome_of, stop_outcome_for_payload }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('stop:guard')
	else await write_stop_decision(await text(process.stdin))
}

export { stop_guard, write_stop_decision }
