#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { backlog_ready, type ReadyPorts } from '#scripts/backlog/backlog-ready'
import { backlog_stalled_detect } from '#scripts/backlog/backlog-stalled-detect'
import { repo_party } from '#scripts/discovery/repo-party'
import { hook_decision } from '#scripts/josh/hook-decision'
import { session_language } from '#scripts/josh/session-language'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_reap } from '#scripts/lane/lane-reap'
import { filing_cap } from '#scripts/rules/filing-cap'
import { lane_park } from '#scripts/rules/lane-park'
import { stop_rules, type StopContext, type StopOutcome } from '#scripts/rules/stop-rules'
import { run_cut } from '#scripts/run/run-cut'
import { run_event_stream } from '#scripts/run/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/run-event-stream-emit'
import { run_headless } from '#scripts/run/run-headless'
import { run_hold } from '#scripts/run/run-hold'
import { run_stranded_detect } from '#scripts/run/run-stranded-detect'
import { run_watcher_guard } from '#scripts/run/run-watcher-guard'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_hook_transcript } from '#scripts/time-runtime/time-hook-transcript'

// The `Stop` hook entry: one process that delivers the three stop-time rules (joshuafolkken/kit#2121).
// It is the stop-time counterpart of `pretool-guard.ts` — a second entry on the same `hook_decision`
// foundation, not a second copy of it.
//
// **Every failure allows the stop.** A missing transcript, an unreadable hold record, a git status
// that will not read — each ends as "no block", for the same reason the PreToolUse guard fails open:
// a hook that failed closed would wedge a run over its own plumbing. The block rules are self-
// resolving (send the notify, release the hold) and `stop_hook_active` is the backstop, so failing
// open here costs at most a missed nudge, never a stuck run.

// The hold record for this working tree is still in place. `unreadable` reads as absent: the safe
// direction for a stop guard is not to block, and an unreadable record is not proof a run is holding.
async function is_hold_present(): Promise<boolean> {
	const directory = await run_hold.worktree_directory()

	if (directory === undefined) return false

	const read = run_hold.read_hold(run_hold.hold_path(directory))

	return read.kind === 'held' || read.kind === 'stale'
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

// The pick-up check is read for the driving `backlogrun` parent alone — the carry record is local, so an
// ordinary session pays one file read and never the stream's.
async function owes_offer(tail: string, ready: ReadyPorts): Promise<boolean> {
	if (!(await run_headless.is_backlog_parent())) return false

	const target = await run_event_stream_emit.stream_target()
	const events = target === undefined ? [] : run_event_stream.read_events(target)

	return await backlog_ready.owes_offer(filing_cap.current_turn(tail), events, ready)
}

// The stream position to restart a relay from, when this attached session owes one that is not
// running (joshuafolkken/kit#2480). A headless session reaches nobody and a lane child relays nothing,
// so neither is asked; the ancestry is read only once a run is known to be going.
async function relay_position(): Promise<number | undefined> {
	if (run_headless.is_headless() || lane_child_marker.marked_issue() !== undefined) return undefined

	if (!(await run_watcher_guard.owes_relay_here(lane_reap.own_ancestry))) return undefined

	const target = await run_event_stream_emit.stream_target()

	return target === undefined ? undefined : run_event_stream.read_from(target, 0).next_position
}

// The session language the refusal is written for — `write_stop_decision` has already loaded the `.env`.
function session_lang(): string {
	return session_language.resolve_session_lang().lang
}

async function build_context(
	transcript_path: string,
	payload_tail: { stop_hook_active: boolean; message: string },
	ready: ReadyPorts,
): Promise<StopContext> {
	const tail = transcript_tail(transcript_path)

	return {
		hold_present: await is_hold_present(),
		tree_clean: !(await run_hold.is_tree_dirty()),
		notified: lane_park.mentions_confirmation_notify(tail),
		message: payload_tail.message,
		stop_hook_active: payload_tail.stop_hook_active,
		cut_pending: run_cut.carried_cut_sync() !== undefined,
		filed: was_filed(tail),
		session_owner: repo_party.current_owner(),
		headless_waiting: await run_headless.must_keep_waiting(),
		headless_refusals: stop_rules.count_headless_refusals(tail),
		owes_offer: await owes_offer(tail, ready),
		lane_child: lane_child_marker.is_child_of(process.cwd()),
		relay_position: await relay_position(),
		session_lang: session_lang(),
	}
}

async function stop_outcome_for_payload(
	raw_payload: string,
	ready: ReadyPorts,
): Promise<StopOutcome> {
	const payload = stop_rules.parse_stop_payload(raw_payload)

	if (payload === undefined || !stop_rules.is_enabled()) return stop_rules.NO_OUTCOME

	const context = await build_context(
		payload.transcript_path,
		{
			stop_hook_active: payload.stop_hook_active ?? false,
			message: payload.last_assistant_message ?? '',
		},
		ready,
	)

	return stop_rules.stop_outcome(context)
}

async function outcome_of(
	raw_payload: string,
	ready: ReadyPorts = backlog_ready.DEFAULT_PORTS,
): Promise<StopOutcome> {
	try {
		return await stop_outcome_for_payload(raw_payload, ready)
	} catch {
		return stop_rules.NO_OUTCOME
	}
}

// Nothing reaches stdout on an ordinary stop, so what the harness parses stays empty unless the stop
// is being held — all three rules block, so a bare `#N` is reported the same way (joshuafolkken/kit#2247).
async function write_stop_decision(raw_payload: string): Promise<void> {
	hook_decision.load_environment_file()

	// One backlog reading serves the stall check and the pick-up check below (joshuafolkken/kit#2472).
	const ready = backlog_ready.shared_ports()

	// The stall check rides the Stop hook because the stop *is* the loop boundary: a run alive but not
	// advancing ends turns without dispatching (joshuafolkken/kit#2359). It only reports — leaves a
	// marker, sends a notification — and swallows its own failures, so it can never change the decision
	// below or hold the stop.
	await backlog_stalled_detect.run_stall_check(ready)

	// The strand check rides the same boundary for the same reason, and is the step before the stall
	// (joshuafolkken/kit#2375): the stall detector needs a live driver that could dispatch, and this one
	// fires when that driver is gone — the budget handed off, the owner dead, no supervisor watching. It
	// too only reports and swallows its own failures, so it never touches the stop decision below.
	await run_stranded_detect.run_stranded_check()

	const { reason } = await outcome_of(raw_payload, ready)

	if (reason === undefined) return

	process.stdout.write(`${stop_rules.block_envelope(reason, session_lang())}\n`)
}

const stop_guard = { outcome_of, stop_outcome_for_payload }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('stop:guard')
	else await write_stop_decision(await text(process.stdin))
}

export { stop_guard, write_stop_decision }
