#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { agent_headless } from '#scripts/agent/agent-headless'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { repo_party } from '#scripts/discovery/repo-party'
import { hook_decision } from '#scripts/josh/hook-decision'
import { session_language } from '#scripts/josh/session-language'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { filing_cap } from '#scripts/rules/filing-cap'
import { lane_background } from '#scripts/rules/lane-background'
import { lane_park } from '#scripts/rules/lane-park'
import { last_prompt } from '#scripts/rules/last-prompt'
import { stop_rules, type StopContext, type StopOutcome } from '#scripts/rules/stop-rules'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_halfrun_resume } from '#scripts/run/run-halfrun-resume'
import { run_headless } from '#scripts/run/run-headless'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_hook_transcript } from '#scripts/time-runtime/time-hook-transcript'

// The `Stop` hook entry: one process that delivers the three stop-time rules.
// It is the stop-time counterpart of `pretool-guard.ts` — a second entry on the same `hook_decision`
// foundation, not a second copy of it.
//
// **Every failure allows the stop.** A missing transcript, an unreadable hold record, a git status
// that will not read — each ends as "no block", for the same reason the PreToolUse guard fails open:
// a hook that failed closed would wedge a run over its own plumbing. The block rules are self-
// resolving (send the notify, release the hold) and `stop_hook_active` is the backstop, so failing
// open here costs at most a missed nudge, never a stuck run.

// The hold record for this working tree is still in place, and whether it is a `prrun` stop's.
// `unreadable` reads as absent: the safe direction for a stop guard is not to
// block, and an unreadable record is not proof a run is holding.
async function hold_facts(): Promise<Pick<StopContext, 'hold_present' | 'prrun_stopped'>> {
	const directory = await run_hold.worktree_directory()
	const hold =
		directory === undefined
			? undefined
			: run_halfrun_resume.hold_of(run_hold.read_hold(run_hold.hold_path(directory)))

	return { hold_present: hold !== undefined, prrun_stopped: hold?.prrun_stop_head !== undefined }
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
		...(await hold_facts()),
		tree_clean: !(await run_hold.is_tree_dirty()),
		notified: lane_park.mentions_confirmation_notify(tail),
		message: payload_tail.message,
		prompt: last_prompt.prompt_text(tail),
		stop_hook_active: payload_tail.stop_hook_active,
		cut_pending: run_cut.carried_cut_sync() !== undefined,
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
// stall needs a backlog driver, which begins one before its plan. A spent (`expired`) or `unreadable`
// record a crashed run left behind is no run either, so it does not re-arm the stall's backlog probe
// on every stop.
// A failed git read — outside a repository, `git rev-parse` exits non-zero — reads as no run, since this
// gate sits ahead of the checks' own swallowing and must not throw into the stop decision either.
async function has_run_record(): Promise<boolean> {
	try {
		const directory = await run_carry.repository_directory()

		if (directory === undefined) return false

		return run_carry.read_carry(run_carry.carry_path(directory)).kind === 'carried'
	} catch {
		return false
	}
}

// The stall check rides the Stop hook because the stop *is* the loop boundary: a run alive but not
// advancing ends turns without dispatching. The strand check rides the same
// boundary and is the step before the stall: it fires when the driver is gone
// — the budget handed off, the owner dead, no supervisor watching. Both only report and swallow their
// own failures, so neither can change the stop decision. An ordinary stop with no run record skips
// both, so it pays one directory read rather than their reads and a stale stream's backlog probe.
async function run_report_checks(): Promise<void> {
	if (!(await has_run_record())) return

	await backlog_stalled_detect.run_stall_check(backlog_ready.DEFAULT_PORTS)
	await run_stranded_detect.run_stranded_check()
}

// Nothing reaches stdout on an ordinary stop, so what the harness parses stays empty unless the stop
// is being held — all three rules block, so a bare `#N` is reported the same way.
async function write_stop_decision(raw_payload: string): Promise<void> {
	hook_decision.load_environment_file()
	await run_report_checks()

	const { reason } = await outcome_of(raw_payload)

	if (reason === undefined) return

	process.stdout.write(`${stop_rules.block_envelope(reason, session_lang())}\n`)
}

const stop_guard = { outcome_of, stop_outcome_for_payload }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('stop:guard')
	else await write_stop_decision(await text(process.stdin))
}

export { stop_guard, write_stop_decision }
